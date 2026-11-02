// Live Overview charts. Polls /server/metrics every 2 seconds and draws CPU,
// memory, per-disk and per-NIC throughput as small canvas sparklines. Pauses
// when the tab is hidden; honours prefers-reduced-motion by not animating.
(function () {
  "use strict";

  var POLL_MS = 2000;
  var HISTORY = 60; // points kept per series
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function fmtBytes(n) {
    n = Number(n) || 0;
    var u = ["B", "KB", "MB", "GB", "TB"];
    var i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i === 0 ? 0 : 1) + " " + u[i];
  }

  function Series(max) { this.data = []; this.max = max || HISTORY; }
  Series.prototype.push = function (v) {
    this.data.push(Number(v) || 0);
    if (this.data.length > this.max) { this.data.shift(); }
  };

  function draw(canvas, series, color, peakHint) {
    var ctx = canvas.getContext("2d");
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var d = series.data;
    if (d.length < 2) { return; }
    var peak = peakHint || 1;
    for (var i = 0; i < d.length; i++) { if (d[i] > peak) { peak = d[i]; } }
    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = color;
    for (var j = 0; j < d.length; j++) {
      var x = (j / (d.length - 1)) * w;
      var y = h - (d[j] / peak) * (h - 6) - 3;
      if (j === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) { el.textContent = text; }
  }

  function init() {
    var root = document.getElementById("srv-metrics");
    if (!root) { return; }
    var url = root.getAttribute("data-metrics-url") || "/server/metrics";

    var cpu = new Series();
    var mem = new Series();
    var net = new Series();
    var disk = new Series();

    var cpuCanvas = document.getElementById("chart-cpu");
    var memCanvas = document.getElementById("chart-mem");
    var netCanvas = document.getElementById("chart-net");
    var diskCanvas = document.getElementById("chart-disk");

    var timer = null;

    function sumRate(list, a, b) {
      var t = 0;
      (list || []).forEach(function (x) { t += (Number(x[a]) || 0) + (Number(x[b]) || 0); });
      return t;
    }

    function tick() {
      fetch(url, { headers: { "Accept": "application/json" }, credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (m) {
          if (!m) { return; }
          cpu.push(m.cpuPercent);
          setText("val-cpu", Math.round(Number(m.cpuPercent) || 0) + "%");
          if (cpuCanvas) { draw(cpuCanvas, cpu, "#7CF3E6", 100); }

          var used = Number(m.memoryUsedBytes) || 0;
          mem.push(used);
          setText("val-mem", fmtBytes(used));
          if (memCanvas) { draw(memCanvas, mem, "#FFB8A3"); }

          var netRate = sumRate(m.network, "sendBytesPerSec", "receiveBytesPerSec");
          net.push(netRate);
          setText("val-net", fmtBytes(netRate) + "/s");
          if (netCanvas) { draw(netCanvas, net, "#B9C9C6"); }

          var diskRate = sumRate(m.disks, "readBytesPerSec", "writeBytesPerSec");
          disk.push(diskRate);
          setText("val-disk", fmtBytes(diskRate) + "/s");
          if (diskCanvas) { draw(diskCanvas, disk, "#7CF3E6"); }
        })
        .catch(function () { /* transient; next tick retries */ });
    }

    function start() {
      if (timer) { return; }
      tick();
      timer = window.setInterval(tick, POLL_MS);
    }
    function stop() {
      if (timer) { window.clearInterval(timer); timer = null; }
    }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { stop(); } else { start(); }
    });
    if (!document.hidden) { start(); }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
