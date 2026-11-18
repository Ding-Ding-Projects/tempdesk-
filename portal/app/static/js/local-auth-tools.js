(() => {
  "use strict";
  const panel = document.querySelector("[data-auth-tool]");
  if (!panel) return;
  const el = key => panel.querySelector("[data-" + key + "]");
  const algorithms = {"SHA1": "SHA-1", "SHA256": "SHA-256", "SHA512": "SHA-512"};
  let account = null, revision = 0, busy = false;
  function decode(value) {
    const text = value.toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z2-7]+=*$/.test(text)) throw Error();
    const raw = text.replace(/=+$/, "");
    if (![0,2,4,5,7].includes(raw.length % 8)) throw Error();
    const bytes = [];
    let bits = 0, buffer = 0;
    for (const digit of raw) {
      buffer = buffer << 5 | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(digit);
      bits += 5;
      if (bits >= 8) { bits -= 8; bytes.push(buffer >> bits & 255); }
      buffer &= (1 << bits) - 1;
    }
    if (buffer || !bytes.length) throw Error();
    return Uint8Array.from(bytes);
  }
  async function code(a, counter) {
    const message = new DataView(new ArrayBuffer(8));
    message.setBigUint64(0, BigInt(counter));
    const h = new Uint8Array(await crypto.subtle.sign("HMAC", a.key, message.buffer));
    const pos = h[h.length - 1] & 15;
    const number = new DataView(h.buffer).getUint32(pos) & 0x7fffffff;
    return String(number % 10 ** a.digits).padStart(a.digits, "0");
  }
  async function display() {
    const a = account;
    if (!a || busy) return;
    busy = true;
    try {
      const now = Math.floor(Date.now() / 1000), counter = Math.floor(now / a.period);
      if (counter !== a.last) {
        const values = await Promise.all([code(a, counter), code(a, counter + 1)]);
        if (account !== a) return;
        el("code").textContent = values[0];
        el("next").textContent = values[1];
        a.last = counter;
      }
      el("seconds").textContent = String(a.period - now % a.period);
    } catch {
      if (account === a) { clear(); el("status").textContent = el("status").dataset.invalid; }
    } finally { busy = false; }
  }
  function clear() {
    revision++; account = null; el("key").value = "";
    for (const name of ["code", "next", "seconds", "status"]) el(name).textContent = "";
  }
  el("clear").onclick = clear;
  el("load").onclick = async () => {
    const value = el("key").value.trim();
    clear();
    const version = revision;
    try {
      if (value.length > 4096) throw Error();
      let secret = value, hash = el("algorithm").value;
      let digits = Number(el("digits").value), period = Number(el("period").value);
      if (/^otpauth:/i.test(value)) {
        const uri = new URL(value);
        if (uri.hostname !== "totp" || uri.protocol !== "otpauth:") throw Error();
        const params = uri.searchParams;
        secret = params.get("secret") || "";
        hash = algorithms[(params.get("algorithm") || "SHA1").toUpperCase()];
        digits = Number(params.get("digits") || "6"); period = Number(params.get("period") || "30");
      }
      if (!Object.values(algorithms).includes(hash) || !Number.isInteger(digits) || digits < 6 || digits > 8 ||
          !Number.isSafeInteger(period) || period < 1 || period > 86400) throw Error();
      const bytes = decode(secret);
      let key;
      try { key = await crypto.subtle.importKey("raw", bytes, {name:"HMAC", hash}, false, ["sign"]); }
      finally { bytes.fill(0); }
      if (version !== revision) return;
      account = {key, digits, period};
      el("status").textContent = el("status").dataset.loaded;
      display();
    } catch { if (version === revision) el("status").textContent = el("status").dataset.invalid; }
  };
  setInterval(display, 1000);
  window.addEventListener("pagehide", clear);

  const desk = document.querySelector("[data-ticket-tool]");
  const topic = desk.querySelector("[data-topic]"), list = desk.querySelector("[data-tickets]");
  const storageKey = "tempdesk.recovery.tickets.v1";
  function read() {
    const entries = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(entries)) throw Error();
    return entries.filter(row => row && Number.isSafeInteger(row.at) && ["preferences","account"].includes(row.topic)).slice(-100);
  }
  function draw(entries) {
    list.replaceChildren();
    for (const row of entries.slice().reverse()) {
      const item = document.createElement("li");
      const option = Array.from(topic.options).find(opt => opt.value === row.topic);
      item.textContent = new Date(row.at).toLocaleString() + " · " + option.text;
      list.append(item);
    }
  }
  function refresh(create) {
    try {
      const entries = read();
      if (create) {
        entries.push({at: Date.now(), topic: topic.value});
        localStorage.setItem(storageKey, JSON.stringify(entries.slice(-100)));
      }
      draw(entries);
      desk.querySelector("[data-warning]").hidden = true;
    } catch { desk.querySelector("[data-warning]").hidden = false; }
  }
  desk.querySelector("[data-create]").onclick = () => refresh(true);
  refresh(false);
})();
