// Files page: upload with a live progress bar using XMLHttpRequest so the
// person sees bytes move for large files. The form still works without JS
// (a plain multipart POST); this only adds the progress indication.
(function () {
  "use strict";

  function init() {
    var form = document.getElementById("srv-upload-form");
    if (!form) { return; }
    var input = form.querySelector('input[type="file"]');
    var bar = document.getElementById("srv-upload-bar");
    var barFill = bar ? bar.querySelector("span") : null;
    var status = document.getElementById("srv-upload-status");

    form.addEventListener("submit", function (e) {
      if (!input || !input.files || input.files.length === 0) { return; }
      // Progressive: use XHR for progress, fall back to normal submit on error.
      e.preventDefault();
      var fd = new FormData(form);
      var xhr = new XMLHttpRequest();
      xhr.open("POST", form.getAttribute("action"), true);
      xhr.upload.addEventListener("progress", function (ev) {
        if (ev.lengthComputable && barFill) {
          var pct = Math.round((ev.loaded / ev.total) * 100);
          bar.hidden = false;
          barFill.style.width = pct + "%";
          if (status) { status.textContent = pct + "%"; }
        }
      });
      xhr.addEventListener("load", function () {
        if (xhr.status >= 200 && xhr.status < 400) {
          var loc = xhr.responseURL || window.location.href;
          window.location.href = loc;
        } else if (status) {
          status.textContent = "Upload failed (" + xhr.status + ")";
        }
      });
      xhr.addEventListener("error", function () {
        if (status) { status.textContent = "Upload failed"; }
      });
      xhr.send(fd);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
}());
