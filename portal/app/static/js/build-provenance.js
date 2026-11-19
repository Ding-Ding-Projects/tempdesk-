// The server supplies a validated UTC instant from the running package. Only its presentation is local.
for (const element of document.querySelectorAll('time[data-build-updated]')) {
  const instant = new Date(element.dateTime);
  if (!Number.isFinite(instant.getTime())) {
    element.replaceWith(document.createTextNode(element.dataset.unavailable));
    continue;
  }
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) continue;
    const locale = document.documentElement.lang || undefined;
    const formatter = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23', timeZone: zone
    });
    // Show the offset as well as the zone to disambiguate repeated local times at the end of DST.
    const offset = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(instant).find(part => part.type === 'timeZoneName');
    element.textContent = formatter.format(instant) + ' (' + zone + (offset ? ', ' + offset.value : '') + ')';
  } catch {
    // The server-rendered, explicitly labelled UTC instant remains readable without Intl zone data.
  }
}
