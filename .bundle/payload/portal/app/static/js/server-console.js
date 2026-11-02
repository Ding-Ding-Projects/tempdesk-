// PowerShell console page. Opens a session on the agent, runs commands in it,
// keeps a command history navigable with the up and down arrow keys, shows a
// session idle timer, and warns that commands run as SYSTEM on the domain
// controller. All requests carry the CSRF token from the page. Commands run
// only while the elevation is fresh; a 403 sends the person back to confirm.
(function () {
  "use strict";

  function init() {
    var root = document.getElementById("srv-console-root");
    if (!root) { return; }
    var out = document.getElementById("srv-console-out");
    var input = document.getElementById("srv-console-input");
    var timerEl = document.getElementById("srv-console-timer");
    var csrf = root.getAttribute("data-csrf") || "";
    var base = "/server/console";

    var sessionId = null;
    var history = [];
    var historyIdx = -1;
    var IDLE_LIMIT = 20 * 60; // seconds, matches the agent
    var idleSeconds = 0;
    var timer = null;

    function headers(json) {
      var h = { "x-csrf-token": csrf };
      if (json) { h["Content-Type"] = "application/json"; }
      return h;
    }

    function append(cls, textContent) {
      var span = document.createElement("div");
      if (cls) { span.className = cls; }
      span.textContent = textContent;
      out.appendChild(span);
      out.scrollTop = out.scrollHeight;
    }

    function resetIdle() {
      idleSeconds = 0;
    }

    function fmt(sec) {
      var m = Math.floor(sec / 60), s = sec % 60;
      return m + ":" + (s < 10 ? "0" : "") + s;
    }

    function startTimer() {
      if (timer) { return; }
      timer = window.setInterval(function () {
        idleSeconds++;
        var left = IDLE_LIMIT - idleSeconds;
        if (timerEl) {
          timerEl.textContent = left > 0 ? ("Session idle timeout in " + fmt(left)) : "Session expired";
        }
        if (left <= 0) {
          window.clearInterval(timer); timer = null;
          append("err", "Session expired after 20 minutes idle. Reload to start a new one.");
          if (input) { input.disabled = true; }
        }
      }, 1000);
    }

    function openSession() {
      fetch(base + "/sessions", { method: "POST", headers: headers(false), credentials: "same-origin" })
        .then(function (r) {
          if (r.status === 403) { window.location.href = "/auth/elevate?next=" + encodeURIComponent("/server/console"); return null; }
          return r.ok ? r.json() : null;
        })
        .then(function (d) {
          if (!d) { return; }
          sessionId = d.sessionId;
          append("", "Session ready. Commands run as SYSTEM on the domain controller.");
          startTimer();
          if (input) { input.disabled = false; input.focus(); }
        })
        .catch(function () { append("err", "Could not open a console session."); });
    }

    function run(cmd) {
      if (!sessionId) { return; }
      append("cmd", "PS> " + cmd);
      resetIdle();
      fetch(base + "/sessions/" + encodeURIComponent(sessionId) + "/run", {
        method: "POST", headers: headers(true), credentials: "same-origin",
        body: JSON.stringify({ command: cmd })
      })
        .then(function (r) {
          if (r.status === 403) { window.location.href = "/auth/elevate?next=" + encodeURIComponent("/server/console"); return null; }
          return r.ok ? r.json() : r.json().catch(function () { return null; });
        })
        .then(function (d) {
          if (!d) { return; }
          if (d.output) { append("", d.output.replace(/\s+$/, "")); }
          if (d.errors && d.errors.length) { append("err", d.errors.join("\n")); }
        })
        .catch(function () { append("err", "Command failed to reach the agent."); });
    }

    if (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          var cmd = input.value;
          if (!cmd.trim()) { return; }
          history.push(cmd);
          historyIdx = history.length;
          run(cmd);
          input.value = "";
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          if (historyIdx > 0) { historyIdx--; input.value = history[historyIdx] || ""; }
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          if (historyIdx < history.length - 1) { historyIdx++; input.value = history[historyIdx] || ""; }
          else { historyIdx = history.length; input.value = ""; }
        }
      });
    }

    var clearBtn = document.getElementById("srv-console-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () { out.textContent = ""; });
    }

    window.addEventListener("beforeunload", function () {
      if (sessionId && navigator.sendBeacon) {
        // Best effort tidy-up; the agent also expires idle sessions.
        try {
          var fd = new FormData();
          fd.append("csrf_token", csrf);
          navigator.sendBeacon(base + "/sessions/" + encodeURIComponent(sessionId) + "/close", fd);
        } catch (e) { /* ignore */ }
      }
    });

    openSession();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
}());
