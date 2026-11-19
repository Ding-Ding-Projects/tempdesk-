(() => {
  const time = document.querySelector('time[data-build-time]');
  if (!time) return;
  function localize() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timezone) return;
    const formatter = new Intl.DateTimeFormat(document.documentElement.lang || 'en', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    time.textContent = formatter.format(new Date(time.dateTime)) + ' (' + timezone + ')';
  }
  localize();
  window.TempDeskSite?.onLang(localize);
})();
