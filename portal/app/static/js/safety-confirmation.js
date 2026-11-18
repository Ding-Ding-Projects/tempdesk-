(() => {
  "use strict";
  for (const panel of document.querySelectorAll("[data-safety-confirm]")) {
    if (panel.dataset.ready) continue;
    panel.dataset.ready = "true";
    const form = panel.closest("form");
    if (!form) continue;
    const target = panel.querySelector("[data-expect]");
    const review = panel.querySelector("[data-review]");
    const slider = panel.querySelector("[data-progress]");
    const token = panel.querySelector("[data-token]");
    const commit = panel.querySelector("[data-commit]");
    const bulk = form.querySelector("select[name=bulk]");
    function update(resetSlider) {
      const enabled = target.value.trim() === target.dataset.expect && review.checked
        && (!bulk || bulk.value === "delete");
      slider.disabled = !enabled;
      if (!enabled || resetSlider) slider.value = "0";
      commit.disabled = !enabled || slider.value !== slider.max;
      token.value = commit.disabled ? "" : token.dataset.token;
    }
    function reset() {
      target.value = "";
      review.checked = false;
      update(true);
    }
    function exit() {
      reset();
      const details = panel.closest("details");
      if (details) {
        details.open = false;
        details.querySelector("summary")?.focus();
      } else {
        const cancel = form.querySelector("a.btn[href]");
        if (cancel) cancel.focus();
        else target.focus();
      }
    }
    target.addEventListener("input", () => update(true));
    review.addEventListener("change", () => update(true));
    slider.addEventListener("input", () => update(false));
    form.addEventListener("change", event => {
      if (event.target === bulk || event.target.matches("[name=sel], [data-select-all]")) reset();
    });
    panel.querySelector("[data-exit]").addEventListener("click", exit);
    form.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        exit();
      }
    });
    form.addEventListener("submit", event => {
      if (bulk && bulk.value !== "delete") return;
      if (event.submitter && event.submitter !== commit && !event.submitter.hasAttribute("data-bulk-apply")) return;
      update(false);
      if (commit.disabled) {
        event.preventDefault();
        const details = panel.closest("details");
        if (details) details.open = true;
        target.focus();
      }
    });
    window.addEventListener("pageshow", reset);
    reset();
  }
})();
