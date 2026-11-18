// Shared portal toasts. Only the signed-in management centre stores history.
(() => {
  const td = window.TD;
  const box = document.querySelector("[data-toasts]");
  if (!td || !box) return;

  const scope = document.documentElement.dataset.noticeScope || "";
  const historyEnabled = !!document.querySelector("[data-notif-list]") && /^[a-f0-9]{64}$/.test(scope);
  const storagePrefix = "td.notifications.v2." + scope + ".";
  const recordPrefix = storagePrefix + "entry.";
  const readPrefix = storagePrefix + "read.";
  const maximum = 100;
  const kinds = new Set(["info", "success", "warning", "error", "progress"]);
  const placeholders = /(\{[a-zA-Z][a-zA-Z0-9_]*\})/g;
  const listeners = new Set();
  const active = new Map();
  let transient = [];
  let sequence = 0;

  function normalize(message) {
    if (typeof message === "string" && message.trim()) return { text: message };
    if (!message || typeof message.key !== "string" || !message.key.trim()) return null;
    if (!td.isCopyKey(message.key)) return { text: message.key };
    const args = {};
    for (const [name, value] of Object.entries(message.args || {}).slice(0, 20)) {
      if (/^[A-Za-z][A-Za-z0-9_]*$/.test(name) &&
          (typeof value === "string" || typeof value === "boolean" || Number.isFinite(value))) {
        args[name] = value;
      }
    }
    return { key: message.key, args, ...(typeof message.detail === "string" && message.detail ? { detail: message.detail } : {}) };
  }

  function isStorable(message) {
    return !!message.key && !message.detail && Object.values(message.args).every(value =>
      typeof value === "number" || typeof value === "boolean"
    );
  }

  function wording(text, original) {
    return original || !td.wordingText ? text : td.wordingText(text);
  }

  function renderMessage(message, original = false) {
    if (!message.key) return message.text;
    const copy = td.t(message.key).split(placeholders).map((part, index) => {
      if (index % 2 === 0) return wording(part, original);
      const name = part.slice(1, -1);
      return Object.hasOwn(message.args, name) ? String(message.args[name]) : part;
    }).join("");
    return message.detail ? copy + " " + message.detail : copy;
  }

  function loadHistory() {
    if (!historyEnabled) return [];
    const records = [];
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(recordPrefix)) continue;
        try {
          const value = JSON.parse(localStorage.getItem(key));
          if (!value || key !== recordPrefix + value.id || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id) ||
              !Number.isSafeInteger(value.time) || value.time < 0 || value.time > 8640000000000000) continue;
          const message = normalize(value.message);
          if (!message || !isStorable(message)) continue;
          records.push({ id: value.id, message, kind: kinds.has(value.kind) ? value.kind : "info",
            time: value.time, read: localStorage.getItem(readPrefix + value.id) === "1" });
        } catch { /* A malformed entry does not affect the rest of the account history. */ }
      }
    } catch { return []; }
    return records.sort((first, second) => second.time - first.time);
  }

  function snapshot() {
    return loadHistory().slice(0, maximum).concat(transient).sort((first, second) => second.time - first.time);
  }

  function broadcast() {
    for (const listener of listeners) listener();
  }

  function nextId() {
    return "notice-" + Date.now().toString(36) + "-" + (++sequence).toString(36) + "-" +
      crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  }

  function removeStored(id) {
    try {
      localStorage.removeItem(recordPrefix + id);
    } catch { return false; }
    // The read marker cannot recreate a deleted record if another tab is marking it read.
    td.store.del(readPrefix + id);
    return true;
  }

  function saveNew(record) {
    if (historyEnabled) {
      if (isStorable(record.message) && td.store.set(recordPrefix + record.id, JSON.stringify(record))) {
        for (const expired of loadHistory().slice(maximum)) removeStored(expired.id);
      } else {
        transient = transient.concat(record).slice(-maximum);
      }
    }
    broadcast();
  }

  function markRead(ids) {
    const chosen = new Set(ids);
    let failed = false;
    for (const row of loadHistory()) {
      if (chosen.has(row.id) && !row.read && !td.store.set(readPrefix + row.id, "1")) failed = true;
    }
    transient = transient.map(row => chosen.has(row.id) ? { ...row, read: true } : row);
    broadcast();
    return !failed;
  }

  function remove(ids) {
    const chosen = new Set(ids);
    const removed = new Set();
    let failed = false;
    for (const row of loadHistory()) {
      if (!chosen.has(row.id)) continue;
      if (removeStored(row.id)) removed.add(row.id);
      else failed = true;
    }
    transient = transient.filter(row => {
      if (!chosen.has(row.id)) return true;
      removed.add(row.id);
      return false;
    });
    for (const id of removed) active.get(id)?.dismiss();
    broadcast();
    return { count: removed.size, failed };
  }

  function updateToast(toast) {
    const { record, element, body, close } = toast;
    body.textContent = renderMessage(record.message);
    close.textContent = wording(td.t("Close"));
    for (const action of element.querySelectorAll("[data-notice-label]")) {
      action.textContent = wording(td.t(action.dataset.noticeLabel));
    }
  }

  function announce(record) {
    const urgent = record.kind === "error" || record.kind === "warning";
    const region = document.querySelector(urgent ? "[data-notice-urgent]" : "[data-notice-live]");
    if (!region) return;
    // Replace the text node so repeated outcomes are announced as separate events.
    region.replaceChildren(document.createTextNode(renderMessage(record.message)));
  }

  function show(message, kind) {
    const normalized = normalize(message);
    if (!normalized) return null;
    const record = { id: nextId(), message: normalized, kind: kinds.has(kind) ? kind : "info", time: Date.now(), read: false };
    const origin = document.activeElement;
    const element = document.createElement("div");
    element.className = "toast " + record.kind;
    const body = document.createElement("span");
    body.className = "toast-message";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn text toast-close";
    element.append(body, close);

    let timer, started;
    let remaining = 5000;
    const persistent = record.kind === "error" || record.kind === "warning";
    function pause() {
      if (!timer) return;
      clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - (performance.now() - started));
    }

    function schedule() {
      if (persistent || timer || element.matches(":hover, :focus-within")) return;
      started = performance.now();
      timer = setTimeout(dismiss, remaining);
    }

    function dismiss() {
      if (!active.delete(record.id)) return;
      pause();
      const focusWasInside = element.contains(document.activeElement);
      element.remove();
      if (focusWasInside && origin?.isConnected && origin !== document.body) origin.focus();
      broadcast();
    }

    close.addEventListener("click", dismiss);
    element.addEventListener("mouseenter", pause);
    element.addEventListener("mouseleave", schedule);
    element.addEventListener("focusin", pause);
    element.addEventListener("focusout", () => queueMicrotask(schedule));
    const toast = { record, element, body, close, dismiss };
    active.set(record.id, toast);
    updateToast(toast);
    box.append(element);
    announce(record);
    saveNew(record);
    schedule();
    return element;
  }

  td.notifications = {
    show,
    snapshot,
    renderMessage,
    markRead,
    remove,
    isStorable,
    hasLegacy: () => historyEnabled && td.store.get("td.notifications") !== null,
    isActive: id => active.has(id),
    dismiss(ids) { for (const id of ids) active.get(id)?.dismiss(); },
    listen(callback) { listeners.add(callback); },
    fromResponse(response) {
      return td.isCopyKey(response?.notice?.key) ? response.notice : response?.message;
    }
  };

  const flashes = new Map();
  window.addEventListener("td:wording-change", () => {
    for (const toast of active.values()) updateToast(toast);
    for (const [node, message] of flashes) node.textContent = renderMessage(message);
    for (const region of document.querySelectorAll("[data-notice-live], [data-notice-urgent]")) region.replaceChildren();
    broadcast();
  });
  window.addEventListener("storage", event => {
    if (event.key === null || event.key === "td.notifications" || event.key.startsWith(storagePrefix)) broadcast();
  });

  document.addEventListener("DOMContentLoaded", () => {
    for (const node of document.querySelectorAll("[data-notify]")) {
      let copy;
      try { copy = JSON.parse(node.dataset.noticeCopy || "null"); } catch { /* Older flashes carry only literal text. */ }
      if (td.isCopyKey(copy?.key)) {
        const normalized = normalize(copy);
        flashes.set(node, normalized);
        node.textContent = renderMessage(normalized);
      }
      show(flashes.get(node) || node.textContent.trim(), node.dataset.notify);
    }
  });
})();
