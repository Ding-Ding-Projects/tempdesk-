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
  const wording = window.TempDeskWording;
  const expires = Date.now() + Number(panel.dataset.wordingSeconds) * 1000;
  const labels = [];
  for (const label of document.querySelectorAll("[data-picker-wording]")) {
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) labels.push([walker.currentNode, walker.currentNode.data]);
  }
  const show = (state) => {
    status.textContent = panel.querySelector(`[data-wording-${state}]`).content.textContent.trim();
  };
  const apply = (translate) => {
    for (const [node, original] of labels) node.data = translate ? translate(original) : original;
    clear.disabled = !translate;
  };
  const reset = () => {
    file.value = "";
    apply(null);
    show("empty");
  };
  file.addEventListener("change", async () => {
    const selected = file.files[0];
    if (!selected) return;
    try {
      if (selected.size > wording.MAX_BYTES) throw new Error("File size");
      const entries = wording.validate(new Uint8Array(await selected.arrayBuffer()));
      if (file.files[0] !== selected || Date.now() >= expires) return;
      apply(wording.buildTranslator(withEditionProductName(entries)));
      show("applied");
    } catch {
      if (file.files[0] === selected) show("invalid");
    }
  });
  clear.addEventListener("click", reset);
  window.addEventListener("pagehide", reset);
  setTimeout(() => {
    reset();
    panel.hidden = true;
  }, Math.max(0, expires - Date.now()));
  reset();
})();
