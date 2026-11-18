const button = document.getElementById('status-hub-open');
const dialog = document.getElementById('status-hub-panel');
const output = document.getElementById('status-hub-result');
const descriptions = {
  unconfigured: 'Configure the service address, trusted client and enrollment credential to enable reporting.',
  'client-path': 'The trusted client requires an absolute path.',
  address: 'Use a secure service address without embedded credentials.',
  connecting: 'Connecting to the service.',
  unavailable: 'The service or trusted client could not be initialized.',
  unconfirmed: 'The service has not confirmed the latest update.',
  accepted: 'The service acknowledged a request.'
};
async function refresh() {
  try {
    const record = await window.td.invoke['hub:status']();
    output.textContent = [descriptions[record.state], record.repository,
      record.session, record.lastSuccess && 'Last acknowledgment: ' + record.lastSuccess].filter(Boolean).join('\n');
  } catch { output.textContent = 'Status is unavailable.'; }
}
button.addEventListener('click', () => { dialog.showModal(); refresh(); });
document.getElementById('status-hub-refresh').addEventListener('click', refresh);
document.getElementById('status-hub-close').addEventListener('click', () => dialog.close());
