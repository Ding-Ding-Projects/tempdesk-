// Shared client behaviour for Server tables: client-side search (with a regex
// toggle), column sort, multi-select with bulk actions, context menu, and
// CSV / JSON export. Progressive enhancement: the tables work without it, this
// only adds interactivity. Attaches to any <table class="srv-table"> inside a
// [data-srv-table] container.
(function () {
  "use strict";

  function text(td) { return (td.getAttribute("data-sort") || td.textContent || "").trim(); }

  function enhance(container) {
    var table = container.querySelector("table.srv-table");
    if (!table) { return; }
    var tbody = table.tBodies[0];
    if (!tbody) { return; }
    var allRows = Array.prototype.slice.call(tbody.rows);

    // ---- search + regex toggle ----
    var search = container.querySelector("[data-srv-search]");
    var regexToggle = container.querySelector("[data-srv-regex]");
    var errBox = container.querySelector("[data-srv-regex-error]");

    function applyFilter() {
      var q = search ? search.value : "";
      var useRe = regexToggle && regexToggle.checked;
      var matcher = null;
      if (errBox) { errBox.textContent = ""; }
      if (q) {
        if (useRe) {
          try { matcher = new RegExp(q, "i"); }
          catch (e) {
            if (errBox) { errBox.textContent = "Invalid pattern: " + e.message; }
            return;
          }
        }
      }
      allRows.forEach(function (row) {
        if (!q) { row.hidden = false; return; }
        var hay = row.textContent || "";
        var hit = useRe ? matcher.test(hay) : hay.toLowerCase().indexOf(q.toLowerCase()) >= 0;
        row.hidden = !hit;
      });
      updateSelectionCount();
    }
    if (search) { search.addEventListener("input", applyFilter); }
    if (regexToggle) { regexToggle.addEventListener("change", applyFilter); }

    // ---- sort ----
    Array.prototype.forEach.call(table.tHead ? table.tHead.rows[0].cells : [], function (th, idx) {
      if (th.getAttribute("data-no-sort") !== null) { return; }
      th.addEventListener("click", function () {
        var asc = th.getAttribute("data-dir") !== "asc";
        Array.prototype.forEach.call(table.tHead.rows[0].cells, function (c) {
          c.removeAttribute("data-dir"); c.setAttribute("aria-sort", "none");
        });
        th.setAttribute("data-dir", asc ? "asc" : "desc");
        th.setAttribute("aria-sort", asc ? "ascending" : "descending");
        var rows = Array.prototype.slice.call(tbody.rows);
        rows.sort(function (a, b) {
          var av = text(a.cells[idx]), bv = text(b.cells[idx]);
          var an = parseFloat(av), bn = parseFloat(bv);
          var cmp;
          if (!isNaN(an) && !isNaN(bn)) { cmp = an - bn; }
          else { cmp = av.toLowerCase().localeCompare(bv.toLowerCase()); }
          return asc ? cmp : -cmp;
        });
        rows.forEach(function (r) { tbody.appendChild(r); });
      });
    });

    // ---- multi-select + bulk ----
    var selectAll = container.querySelector("[data-srv-selectall]");
    var countEl = container.querySelector("[data-srv-count]");
    function rowChecks() {
      return Array.prototype.slice.call(tbody.querySelectorAll("[data-srv-check]"));
    }
    function updateSelectionCount() {
      var n = rowChecks().filter(function (c) { return c.checked && !c.closest("tr").hidden; }).length;
      if (countEl) { countEl.textContent = n ? (n + " selected") : ""; }
      rowChecks().forEach(function (c) {
        var tr = c.closest("tr");
        if (tr) { tr.classList.toggle("selected", c.checked); }
      });
      container.querySelectorAll("[data-srv-bulk]").forEach(function (b) { b.disabled = n === 0; });
    }
    if (selectAll) {
      selectAll.addEventListener("change", function () {
        rowChecks().forEach(function (c) { if (!c.closest("tr").hidden) { c.checked = selectAll.checked; } });
        updateSelectionCount();
      });
    }
    rowChecks().forEach(function (c) { c.addEventListener("change", updateSelectionCount); });

    container.querySelectorAll("[data-srv-bulk]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var ids = rowChecks().filter(function (c) { return c.checked; })
          .map(function (c) { return c.value; });
        var target = container.querySelector(btn.getAttribute("data-srv-bulk"));
        if (target) {
          target.value = ids.join(",");
          if (target.form) { target.form.requestSubmit ? target.form.requestSubmit() : target.form.submit(); }
        }
      });
    });

    // ---- export CSV / JSON (visible rows) ----
    container.querySelectorAll("[data-srv-export]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var kind = btn.getAttribute("data-srv-export");
        var headers = Array.prototype.map.call(table.tHead.rows[0].cells, function (c) {
          return (c.getAttribute("data-col") || c.textContent || "").trim();
        });
        var rows = allRows.filter(function (r) { return !r.hidden; }).map(function (r) {
          return Array.prototype.map.call(r.cells, function (c) { return (c.getAttribute("data-sort") || c.textContent || "").trim(); });
        });
        var blob, name;
        if (kind === "json") {
          var objs = rows.map(function (r) {
            var o = {}; headers.forEach(function (h, i) { o[h] = r[i]; }); return o;
          });
          blob = new Blob([JSON.stringify(objs, null, 2)], { type: "application/json" });
          name = "export.json";
        } else {
          var lines = [headers].concat(rows).map(function (r) {
            return r.map(function (v) {
              v = String(v);
              if (/^[=+\-@\t\r]/.test(v)) { v = "'" + v; }
              return '"' + v.replace(/"/g, '""') + '"';
            }).join(",");
          });
          blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
          name = "export.csv";
        }
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      });
    });

    updateSelectionCount();
  }

  function init() {
    document.querySelectorAll("[data-srv-table]").forEach(enhance);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
}());
