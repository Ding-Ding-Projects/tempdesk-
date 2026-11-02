// Job progress view. Polls /server/jobs/{id}/status until the job reaches a
// terminal state, updating a progress bar and the output / error log. Used by
// the roles-and-features and Windows Update install flows.
(function () {
  "use strict";

  function init() {
    var root = document.getElementById("srv-job-root");
    if (!root) { return; }
    var jobId = root.getAttribute("data-job-id");
    var url = root.getAttribute("data-status-url") || ("/server/jobs/" + encodeURIComponent(jobId) + "/status");
    var barFill = document.querySelector("#srv-job-bar span");
    var stateEl = document.getElementById("srv-job-state");
    var outEl = document.getElementById("srv-job-output");
    var errEl = document.getElementById("srv-job-errors");

    function render(d) {
      if (stateEl) { stateEl.textContent = d.state || ""; }
      if (barFill) { barFill.style.width = (Number(d.progress) || 0) + "%"; }
      if (outEl && d.output) { outEl.textContent = (d.output || []).join("\n"); }
      if (errEl && d.errors) {
        errEl.textContent = (d.errors || []).join("\n");
        errEl.hidden = !(d.errors && d.errors.length);
      }
    }

    function poll() {
      fetch(url, { headers: { "Accept": "application/json" }, credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d) { return; }
          render(d);
          if (d.state === "Running") {
            window.setTimeout(poll, 1500);
          }
        })
        .catch(function () { window.setTimeout(poll, 3000); });
    }
    poll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
}());
