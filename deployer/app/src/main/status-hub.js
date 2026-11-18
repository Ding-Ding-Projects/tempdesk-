'use strict';

const { randomUUID } = require('node:crypto');
const path = require('node:path');

let client;
let state = 'unconfigured';
const repository = 'Ding-Ding-Projects/tempdesk-';

async function start(version) {
  const modulePath = process.env.TEMPDESK_STATUS_CLIENT;
  const address = process.env.STATUS_HUB_URL;
  if (!modulePath || !address || !process.env.AGENT_INGEST_TOKEN) return;
  if (!path.isAbsolute(modulePath)) { state = 'client-path'; return; }
  try {
    const target = new URL(address);
    if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash) {
      state = 'address';
      return;
    }
    state = 'connecting';
    const bridge = require(modulePath);
    client = await bridge.createStatusHubClient({
      baseUrl: target.href,
      sessionId: 'tempdesk-' + randomUUID(),
      title: 'TempDesk Deployer', repository, branch: 'main',
        status: 'running', summary: 'TempDesk Deployer ' + version + ' started.'
    });
    state = 'ready';
  } catch { state = 'unavailable'; }
}

function snapshot() {
  const receipt = client?.status();
  return {
    repository,
    state: receipt ? (receipt.lastError || !receipt.lastSuccessAt ? 'unconfirmed' : 'accepted') : state,
    lastSuccess: receipt?.lastSuccessAt || null,
    session: receipt?.sessionId || null
  };
}

async function finish() {
  if (client) await client.finish('landed', { summary: 'The desktop session ended.' });
}

module.exports = { start, snapshot, finish };
