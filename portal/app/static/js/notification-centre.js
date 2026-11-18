// Management notification history and its local actions.
(() => {
  const td = window.TD;
  const notices = td?.notifications;
  const panel = document.querySelector("[data-notif-panel]");
  if (!notices || !panel) return;

  const bell = document.querySelector("[data-bell]");
  const heading = panel.querySelector("h2");
  const list = panel.querySelector("[data-notif-list]");
  const empty = panel.querySelector("[data-notif-empty]");
  const legacy = panel.querySelector("[data-notif-legacy]");
  const selectionStatus = panel.querySelector("[data-notif-selection]");
  const actionStatus = panel.querySelector("[data-notif-status]");
  const search = window.TDSearch?.get("notifications");
  const controls = Object.fromEntries([...panel.querySelectorAll("[data-notif-action]")].map(button =>
    [button.dataset.notifAction, button]));
  const dialog = document.querySelector("[data-notif-confirm]");
  const keys = [...dialog.querySelectorAll("input[type=checkbox]")];
  const slider = dialog.querySelector("input[type=range]");
  const progress = dialog.querySelector("progress");
  const commit = dialog.querySelector("[data-notif-confirm-delete]");
  const preview = dialog.querySelector("[data-notif-preview]");
  const reviewSearch = window.TDSearch?.mount(dialog.querySelector("[data-search-manual]"), {
    onChange(surface) {
      const records = [...preview.children];
      const matching = records.filter(row => surface.test(row.textContent));
      surface.count(matching.length, records.length);
      surface.highlight(matching);
    }
  });
  const reviewHeading = dialog.querySelector("h2");
  const reviewStatus = dialog.querySelector("[data-notif-review-status]");
  const kindLabels = { info: "Information", success: "Success", warning: "Warning", error: "Error", progress: "Progress" };
  const formatter = new Intl.DateTimeFormat(document.documentElement.lang || "en", {
    dateStyle: "short", timeStyle: "short", hourCycle: "h23"
  });

  const rows = new Map();
  const selected = new Set();
  let anchor, pending, status;
  let previousFilter = "";

  function copy(key, args = {}) {
    return notices.renderMessage({ key, args });
  }

  function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  function report(key, args = {}) {
    status = { key, args };
    setText(actionStatus, copy(key, args));
  }

  function setDisabled(element, disabled) {
    element.setAttribute("aria-disabled", String(disabled));
  }

  function validSearch() {
    return !search || search.compiled.ok;
  }

  function matchingRows() {
    return validSearch() ? [...list.children].filter(row => !row.hidden).map(row => row.dataset.noticeId) : [];
  }

  function selectedRows() {
    return matchingRows().filter(id => selected.has(id));
  }

  function filterSignature() {
    return search ? JSON.stringify(search.state()) : "";
  }

  function freshSearch() {
    search?.refresh();
  }

  function adjustActions() {
    const visible = matchingRows();
    const chosen = visible.filter(id => selected.has(id));
    const active = chosen.filter(id => notices.isActive(id)).length;
    for (const [id, row] of rows) row.check.checked = selected.has(id);
    setText(selectionStatus, chosen.length ? copy("{count} selected", { count: chosen.length }) +
      " · " + copy("{count} active toasts selected", { count: active }) : "");
    setDisabled(controls.select, !visible.length);
    setDisabled(controls.invert, !visible.length);
    setDisabled(controls.dismiss, !active);
    setDisabled(controls.remove, !chosen.length);
    setDisabled(controls.export, !visible.length);
    setDisabled(controls.clear, !validSearch() || !rows.size);
    setDisabled(controls.read, ![...rows.values()].some(row => !row.record.read));

    empty.hidden = !!visible.length || !validSearch();
    setText(empty, copy(rows.size ? "No matching notifications." : "No notifications yet"));
  }

  function onFilter() {
    const signature = filterSignature();
    if (signature !== previousFilter) {
      previousFilter = signature;
      anchor = undefined;
    }
    const visible = new Set(matchingRows());
    for (const id of selected) if (!visible.has(id)) selected.delete(id);
    adjustActions();
    if (pending) updatePreview();
  }

  function choose(id, on, range) {
    freshSearch();
    const visible = matchingRows();
    const end = visible.indexOf(id);
    const start = range ? visible.indexOf(anchor) : -1;
    if (end < 0) return;
    const ids = start < 0 ? [id] : visible.slice(Math.min(start, end), Math.max(start, end) + 1);
    for (const target of ids) {
      if (on) selected.add(target);
      else selected.delete(target);
    }
    anchor = id;
    adjustActions();
  }

  function createRow(id) {
    const element = document.createElement("li");
    element.dataset.noticeId = id;
    const label = document.createElement("label");
    label.className = "notice-row";
    const check = document.createElement("input");
    check.type = "checkbox";
    const content = document.createElement("span");
    content.className = "notice-record";
    const message = document.createElement("span");
    message.className = "notice-record-copy";
    const metadata = document.createElement("span");
    metadata.className = "subtle";
    content.append(message, metadata);
    label.append(check, content);
    element.append(label);
    check.addEventListener("click", event => {
      const on = check.checked;
      choose(id, on, event.shiftKey);
    });
    check.addEventListener("keydown", event => {
      if (event.key !== " " || !event.shiftKey) return;
      event.preventDefault();
      choose(id, !selected.has(id), true);
    });
    return { element, check, message, metadata };
  }

  function refreshHistory() {
    const history = notices.snapshot();
    const have = new Set(history.map(record => record.id));
    for (const [id, row] of rows) {
      if (have.has(id)) continue;
      row.element.remove();
      rows.delete(id);
      selected.delete(id);
    }

    let position = list.firstElementChild;
    for (const record of history) {
      const row = rows.get(record.id) || createRow(record.id);
      rows.set(record.id, row);
      row.record = record;
      row.element.classList.toggle("unread", !record.read);
      const text = notices.renderMessage(record.message);
      setText(row.message, text);
      const state = notices.isActive(record.id) ? "" : " · " + copy("Dismissed");
      setText(row.metadata, copy(kindLabels[record.kind]) + " · " +
        formatter.format(record.time) + " · " + copy(record.read ? "Marked as read" : "Unread") + state);
      row.check.setAttribute("aria-label", copy("Select notification") + " " + text);
      if (row.element !== position) list.insertBefore(row.element, position);
      position = row.element.nextElementSibling;
    }

    const unread = history.filter(record => !record.read).length;
    legacy.hidden = !notices.hasLegacy();
    const badge = bell.querySelector("[data-bell-count]");
    badge.hidden = !unread;
    setText(badge, String(unread));
    if (status) setText(actionStatus, copy(status.key, status.args));
    freshSearch();
    onFilter();
  }

  function openPanel() {
    panel.hidden = false;
    bell.setAttribute("aria-expanded", "true");
    refreshHistory();
    heading.focus();
  }

  function closePanel() {
    panel.hidden = true;
    bell.setAttribute("aria-expanded", "false");
    bell.focus();
  }

  function exportMatches() {
    const matching = matchingRows().map(id => rows.get(id).record);
    const exported = matching.filter(row => notices.isStorable(row.message)).map(row => ({
      message: notices.renderMessage(row.message, true),
      kind: row.kind,
      time: new Date(row.time).toISOString(),
      read: row.read
    }));
    if (exported.length) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2) + "\n"], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "tempdesk-notifications.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    const excluded = matching.length - exported.length;
    status = null;
    setText(actionStatus, copy("{count} notifications exported.", { count: exported.length }) +
      (excluded ? " " + copy("{count} entries with unclassified or literal details were excluded.", { count: excluded }) : ""));
  }

  function deletionTargets(all) {
    if (!validSearch()) return [];
    return all ? [...list.children].map(row => row.dataset.noticeId) : selectedRows();
  }

  function updateConfirmation() {
    const armed = pending?.ids.length && keys.every(key => key.checked);
    slider.disabled = !armed;
    if (!armed) slider.value = "0";
    progress.value = Number(slider.value);
    slider.setAttribute("aria-valuetext", copy("Confirmation {value}%", { value: progress.value }));
    commit.disabled = !armed || progress.value !== 100;
    dialog.toggleAttribute("data-notice-armed", !commit.disabled);
  }

  function updatePreview(initial = false) {
    const ids = deletionTargets(pending.all);
    const state = JSON.stringify([ids.map(id => rows.get(id).record), filterSignature()]);
    const changed = state !== pending.state;
    if (changed) {
      pending.ids = ids;
      pending.state = state;
      for (const key of keys) key.checked = false;
      slider.value = "0";
      setText(reviewStatus, initial ? "" : copy("The notifications changed. Review the updated list before deleting."));
    }
    setText(reviewHeading, copy(ids.length === 1 ? "Review 1 notification for deletion" : "Review {count} notifications for deletion", { count: ids.length }));
    setText(commit, copy(ids.length === 1 ? "Delete 1 notification" : "Delete {count} notifications", { count: ids.length }));
    if (changed) {
      preview.replaceChildren(...ids.map(id => {
        const item = document.createElement("li");
        item.textContent = notices.renderMessage(rows.get(id).record.message);
        return item;
      }));
    } else {
      ids.forEach((id, index) => setText(preview.children[index], notices.renderMessage(rows.get(id).record.message)));
    }
    reviewSearch?.refresh();
    updateConfirmation();
  }

  function startDeletion(button, all) {
    if (!deletionTargets(all).length || !dialog.showModal) return;
    pending = { all, opener: button, ids: [] };
    dialog.querySelector("[data-notif-delete-all-note]").hidden = !all;
    updatePreview(true);
    dialog.showModal();
    reviewHeading.focus();
  }

  keys.forEach(key => key.addEventListener("change", updateConfirmation));
  slider.addEventListener("input", updateConfirmation);
  dialog.querySelector("[data-notif-confirm-cancel]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    const opener = pending?.opener;
    pending = null;
    opener?.focus();
  });
  commit.addEventListener("click", () => {
    refreshHistory();
    if (!pending || commit.disabled || !keys.every(key => key.checked) || Number(slider.value) !== 100) return;
    const ids = pending.ids.slice();
    const result = notices.remove(ids);
    if (result.failed) {
      const count = result.count ? copy("{count} notifications deleted.", { count: result.count }) + " " : "";
      setText(reviewStatus, count + copy("This browser could not update notification history."));
      return;
    }
    dialog.close();
    report(result.count === 1 ? "1 notification deleted." : "{count} notifications deleted.", { count: result.count });
  });

  bell.addEventListener("click", () => panel.hidden ? openPanel() : closePanel());
  panel.querySelector("[data-notif-close]").addEventListener("click", closePanel);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !event.defaultPrevented && !panel.hidden && !dialog.open &&
        !event.target.closest?.(".rxb-pop")) closePanel();
  });

  panel.addEventListener("click", event => {
    const button = event.target.closest("[data-notif-action]");
    if (!button) return;
    freshSearch();
    if (button.getAttribute("aria-disabled") === "true") return;
    switch (button.dataset.notifAction) {
      case "select":
        matchingRows().forEach(id => selected.add(id));
        adjustActions();
        break;
      case "invert":
        matchingRows().forEach(id => selected.has(id) ? selected.delete(id) : selected.add(id));
        adjustActions();
        break;
      case "read":
        report(notices.markRead([...rows.keys()]) ? "Notifications marked read." :
          "This browser could not update notification history.");
        break;
      case "dismiss":
        notices.dismiss(selectedRows());
        report("Selected toasts dismissed.");
        break;
      case "export":
        exportMatches();
        break;
      case "remove":
      case "clear":
        startDeletion(button, button.dataset.notifAction === "clear");
        break;
    }
  });

  search?.listen(onFilter);
  notices.listen(refreshHistory);
  refreshHistory();
})();
