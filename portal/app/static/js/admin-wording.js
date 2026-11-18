// Local import for the authenticated management console.
(() => {
  const root = document.documentElement;
  const cacheKey = "td.admin-wording.file.v1";
  const cacheScopeKey = "td.admin-wording.file-scope.v1";
  const ownerKey = "td.admin-wording.owner.v1";
  const scope = root.dataset.wordingScope;

  function removeCache() {
    sessionStorage.removeItem(cacheKey);
    sessionStorage.removeItem(cacheScopeKey);
  }

  if (!scope) {
    if (root.hasAttribute("data-wording-reset")) {
      try {
        revokeScope(sessionStorage.getItem(cacheScopeKey));
        removeCache();
      } catch { /* The cache is inaccessible. */ }
    }
    return;
  }

  const issued = Number(root.dataset.wordingIssued);
  const expires = Number(root.dataset.wordingExpires);
  const wording = window.TempDeskWording;
  const td = window.TD;
  if (!wording || !td) return;
  const card = document.querySelector("#wording");
  const fileInput = document.querySelector("[data-wording-file]");
  const applyButton = document.querySelector("[data-wording-apply]");
  const clearButton = document.querySelector("[data-wording-clear]");
  const status = document.querySelector("[data-wording-status]");
  const live = document.querySelector("[data-live]");
  const overlay = document.querySelector("[data-drop-overlay]");
  const textNodes = new Map();
  const labels = [];
  let translate = null;
  let operation = 0;
  let dragDepth = 0;
  let suspended = false;
  let parked = false;
  let pausedForSchool = false;
  let printing = false;
  let celebration = null;
  let celebrationTimer;
  let state = "empty";

  const messages = {
    empty: "No file loaded. The original wording is used.",
    loaded: "Personal wording is active in this browser tab.",
    invalid: "This file was not applied",
    size: "The personal wording file is larger than 256 KiB.",
    corrupt: "The saved wording could not be read. The original wording is used.",
    storage: "This browser could not save the personal wording.",
    clearFailed: "Original wording is shown. This browser could not clear its saved wording.",
    cleared: "Personal wording cleared. The original wording is back.",
  };
  const school = () => document.cookie.split(";").some(part => part.trim() === "td_school=1");

  function readOwner() {
    const owner = JSON.parse(localStorage.getItem(ownerKey) || "null");
    if (!owner || !/^[0-9a-f]{64}$/.test(owner.scope) || !Number.isSafeInteger(owner.issued)) return null;
    return owner;
  }

  function revokeScope(id) {
    try {
      const current = readOwner();
      if (current && current.scope === id) {
        localStorage.setItem(ownerKey, JSON.stringify({ scope: current.scope, issued: current.issued, revoked: true }));
      }
    } catch { /* A local cache clear still applies in this tab. */ }
  }

  function ownsPage() {
    if (suspended || parked || Date.now() >= expires || school()) return false;
    try {
      const owner = readOwner();
      return owner?.scope === scope && !owner.revoked;
    } catch {
      return false;
    }
  }

  function claimPage() {
    if (!/^[0-9a-f]{64}$/.test(scope) || !Number.isSafeInteger(issued) ||
        !Number.isSafeInteger(expires) || Date.now() >= expires || school()) return false;

    const owner = readOwner();
    if (owner && (owner.scope === scope ? owner.revoked : owner.issued >= issued)) return false;
    if (owner?.scope !== scope) localStorage.setItem(ownerKey, JSON.stringify({ scope, issued }));
    return true;
  }

  const copy = text => translate && !printing ? translate(text) : text;
  td.wordingText = copy;

  function collectCopy() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
    while (walker.nextNode()) {
      const start = walker.currentNode;
      const text = start.nextSibling;
      if (start.data === "td-wording" && text?.nodeType === Node.TEXT_NODE &&
          text.nextSibling?.nodeType === Node.COMMENT_NODE && text.nextSibling.data === "/td-wording") {
        textNodes.set(text, text.data);
      }
    }
    for (const name of ["aria-label", "aria-description", "aria-valuetext", "placeholder", "title", "data-search-label"]) {
      for (const node of document.querySelectorAll("[data-td-copy-" + name + "]")) {
        labels.push([node, name, node.getAttribute(name)]);
      }
    }
  }

  function render() {
    for (const [node, original] of textNodes) node.data = copy(original);
    for (const [node, name, original] of labels) if (original !== null) node.setAttribute(name, copy(original));
    if (status) status.textContent = copy(td.t(messages[state]));
    if (applyButton) {
      applyButton.textContent = copy(td.t(translate ? "Replace wording" : "Apply wording"));
      applyButton.disabled = !fileInput.files.length || !ownsPage();
    }
    if (clearButton) clearButton.disabled = !translate && state !== "corrupt";
    window.dispatchEvent(new Event("td:wording-change"));
  }

  function show(next, announce = true) {
    state = next;
    render();
    if (announce && live) live.textContent = copy(td.t(messages[next]));
  }

  function endCelebration() {
    clearTimeout(celebrationTimer);
    celebration?.remove();
    celebration = null;
  }

  function celebrate(entries) {
    endCelebration();
    const headline = entries.get("private vocabulary") || td.t("Personal wording applied");
    if (live) live.textContent = headline;
    celebration = document.createElement("div");
    celebration.className = "celebrate";
    celebration.setAttribute("aria-hidden", "true");
    const heading = document.createElement("div");
    heading.className = "headline";
    heading.textContent = headline;
    celebration.append(heading);
    document.body.append(celebration);
    const reduced = td.motionOff();
    if (reduced) celebration.classList.add("in");
    else requestAnimationFrame(() => celebration?.classList.add("in"));
    celebrationTimer = setTimeout(() => {
      if (reduced) endCelebration();
      else {
        celebration?.classList.add("out");
        celebrationTimer = setTimeout(endCelebration, 450);
      }
    }, 3000);
  }

  function restoreOriginal(purge) {
    operation++;
    translate = null;
    endCelebration();
    if (live) live.textContent = "";
    if (fileInput) fileInput.value = "";
    if (purge) {
      try { removeCache(); } catch { /* The cache is inaccessible. */ }
    }
    show("empty", false);
  }

  function loadCache() {
    if (sessionStorage.getItem(cacheScopeKey) !== scope) {
      removeCache();
      return;
    }
    const raw = sessionStorage.getItem(cacheKey);
    if (raw !== null) {
      const entries = wording.validate(raw);
      translate = wording.buildTranslator(entries);
      show("loaded", false);
    }
  }

  async function importFile(file) {
    if (!file || !ownsPage()) return;
    const id = ++operation;
    if (file.size > wording.MAX_BYTES) {
      show("size");
      return;
    }
    let raw, entries, next;
    try {
      raw = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      entries = wording.validate(raw);
      next = wording.buildTranslator(entries);
    } catch {
      if (id === operation && ownsPage()) show("invalid");
      return;
    }
    if (id !== operation || !ownsPage()) return;
    try {
      if (sessionStorage.getItem(cacheScopeKey) !== scope) {
        removeCache();
        sessionStorage.setItem(cacheScopeKey, scope);
      }
      sessionStorage.setItem(cacheKey, raw);
    } catch {
      show("storage");
      return;
    }
    translate = next;
    if (fileInput) fileInput.value = "";
    show("loaded", false);
    celebrate(entries);
  }

  function clearWording() {
    if (!ownsPage()) return;
    try {
      removeCache();
    } catch {
      restoreOriginal(false);
      show("clearFailed");
      return;
    }
    restoreOriginal(false);
    show("cleared");
    fileInput?.focus();
  }

  function reconcile() {
    if (parked) return;
    if (ownsPage()) {
      if (pausedForSchool) {
        pausedForSchool = false;
        if (card) card.hidden = false;
        try { loadCache(); } catch { restoreOriginal(true); show("corrupt", false); }
      }
      return;
    }
    pausedForSchool = !suspended && Date.now() < expires && school();
    restoreOriginal(!pausedForSchool);
    if (card) card.hidden = pausedForSchool;
    overlay?.classList.remove("show");
  }

  collectCopy();
  try {
    if (!claimPage()) {
      restoreOriginal(true);
      return;
    }
    try {
      loadCache();
    } catch {
      restoreOriginal(true);
      show("corrupt", false);
    }
  } catch {
    show("storage", false);
    return;
  }
  render();

  fileInput?.addEventListener("change", () => { operation++; render(); });
  applyButton?.addEventListener("click", () => importFile(fileInput.files[0]));
  clearButton?.addEventListener("click", clearWording);

  const filesAt = event => event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files");
  const hasOwnControl = event => event.target.closest?.("input[type='file'], [data-b64-app]");
  document.addEventListener("dragenter", event => {
    if (!ownsPage() || !filesAt(event) || hasOwnControl(event)) return;
    dragDepth++;
    overlay?.classList.add("show");
  });
  document.addEventListener("dragleave", event => {
    if (filesAt(event)) dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay?.classList.remove("show");
  });
  document.addEventListener("dragover", event => {
    if (ownsPage() && filesAt(event) && !hasOwnControl(event)) event.preventDefault();
  });
  document.addEventListener("drop", event => {
    if (!ownsPage() || !filesAt(event) || hasOwnControl(event)) return;
    event.preventDefault();
    dragDepth = 0;
    overlay?.classList.remove("show");
    if (event.dataTransfer.files.length === 1) importFile(event.dataTransfer.files[0]);
    else show("invalid");
  });

  document.addEventListener("submit", event => {
    if (!event.target.matches("[data-logout-form]")) return;
    revokeScope(scope);
    suspended = true;
    restoreOriginal(true);
  });
  window.addEventListener("storage", event => {
    if (event.key === ownerKey || event.key === "td.schoolPin" || event.key === null) reconcile();
  });
  window.addEventListener("td:school", reconcile);
  window.addEventListener("focus", reconcile);
  document.addEventListener("visibilitychange", reconcile);
  window.addEventListener("pagehide", () => {
    parked = true;
    restoreOriginal(false);
  });
  window.addEventListener("beforeprint", () => { printing = true; endCelebration(); render(); });
  window.addEventListener("afterprint", () => { printing = false; reconcile(); render(); });
  setTimeout(() => { suspended = true; reconcile(); }, Math.max(0, expires - Date.now()));
})();
