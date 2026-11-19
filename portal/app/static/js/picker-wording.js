(() => {
  function withEditionProductName(entries) {
    const keys = Array.from(entries.keys());
    if (keys.some(key => key.toLowerCase() === "windows")) return entries;
    const productName = "Microsoft Windows";
    const sourceKey = entries.has(productName)
      ? productName : keys.find(key => key.toLowerCase() === productName.toLowerCase());
    if (!sourceKey) return entries;
    const pickerEntries = new Map(entries);
    pickerEntries.set("Windows", entries.get(sourceKey));
    return pickerEntries;
  }

  if (typeof module === "object" && module.exports) module.exports = withEditionProductName;
  if (typeof document === "undefined") return;
  const panel = document.querySelector("#picker-wording");
  if (!panel) return;
  const file = panel.querySelector("input");
  const clear = panel.querySelector("[data-wording-clear]");
  const status = panel.querySelector("[data-wording-status]");
  const outcomes = Object.fromEntries(["empty", "applied", "invalid"].map(kind => [
    kind, panel.querySelector(`[data-wording-${kind}]`).content.textContent.trim()
  ]));
  const wording = window.TempDeskWording;
  const expires = Date.now() + Number(panel.dataset.wordingSeconds) * 1000;
  const labels = [];
  for (const label of document.querySelectorAll("[data-picker-wording]")) {
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) labels.push([walker.currentNode, walker.currentNode.data]);
  }
  let translate = null;
  let operation = 0;
  const schoolMode = () => document.cookie.split(";").some(part => part.trim() === "td_school=1");
  const render = (kind, next = translate) => {
    const message = next ? next(outcomes[kind]) : outcomes[kind];
    const text = labels.map(([, original]) => next ? next(original) : original);
    labels.forEach(([node], index) => { node.data = text[index]; });
    translate = next;
    status.textContent = message;
    clear.disabled = next === null;
  };
  const reset = () => {
    operation++;
    window.TD?.actionSounds?.cancel();
    file.value = "";
    render("empty", null);
  };
  const reconcileAccess = () => {
    const unavailable = schoolMode() || Date.now() >= expires;
    if (unavailable && !panel.hidden) reset();
    panel.hidden = unavailable;
  };
  file.addEventListener("change", async (event) => {
    const sounds = window.TD?.actionSounds;
    sounds?.cancel();
    const id = ++operation;
    const selected = file.files[0];
    if (!selected) return;
    const current = () => id === operation && file.files[0] === selected && panel.isConnected &&
      !panel.hidden && !schoolMode() && Date.now() < expires;
    if (!current()) return;
    const cue = sounds?.prepare(event);
    try {
      if (selected.size > wording.MAX_BYTES) throw new Error("File size");
      const entries = wording.validate(new Uint8Array(await selected.arrayBuffer()));
      if (!current()) return;
      render("applied", wording.buildTranslator(withEditionProductName(entries)));
    } catch {
      if (current()) {
        render("invalid");
        void sounds?.play(cue, "rejected", current);
      }
      return;
    }
    void sounds?.play(cue, "applied", current);
  });
  clear.addEventListener("click", reset);
  window.addEventListener("pagehide", reset);
  window.addEventListener("td:school", reconcileAccess);
  document.addEventListener("visibilitychange", reconcileAccess);
  window.addEventListener("storage", event => {
    if (event.key === "td.schoolPin" || event.key === null) reconcileAccess();
  });
  setTimeout(reconcileAccess, Math.max(0, expires - Date.now()));
  reset();
  reconcileAccess();
})();
