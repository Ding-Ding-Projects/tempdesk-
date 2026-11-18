// Original short browser cues. Playback never holds up the action it accompanies.
(() => {
  const td = window.TD;
  if (!td) return;

  const preference = "td.actionSounds";
  const cues = {
    applied: [523.25, 659.25, 783.99],
    rejected: [392, 293.66],
  };
  let context, playing;
  let generation = 0;

  function enabled() {
    try {
      return localStorage.getItem(preference) !== "off";
    } catch {
      return false;
    }
  }

  function school() {
    return document.cookie.split(";").some(part => part.trim() === "td_school=1");
  }

  function canPlay() {
    return enabled() && !document.hidden && !school();
  }

  function stopCue() {
    if (!playing) return;
    const { oscillator, output } = playing;
    playing = null;
    output.disconnect();
    try { oscillator.stop(); } catch { /* The cue already ended. */ }
  }

  function cancel() {
    generation++;
    stopCue();
  }

  function prepare(event) {
    if (!event.isTrusted || !canPlay() || !window.AudioContext) return null;
    try {
      if (!context || context.state === "closed") context = new AudioContext();
      // Ask the browser to enable audio during the user gesture, before reading a file.
      const resumed = context.state === "running" ? Promise.resolve(true) : context.resume().then(() => true, () => false);
      return { audio: context, generation, resumed };
    } catch {
      return null;
    }
  }

  async function play(ticket, name, stillCurrent) {
    const notes = cues[name];
    if (!ticket || !notes) return;

    let timer;
    try {
      const ready = await Promise.race([ticket.resumed, new Promise(resolve => { timer = setTimeout(() => resolve(false), 400); })]);
      const audio = ticket.audio;
      if (!ready || !canPlay() || ticket.generation !== generation ||
          !stillCurrent() || audio.state !== "running") return;

      stopCue();
      const oscillator = audio.createOscillator();
      const output = audio.createGain();
      const start = audio.currentTime + 0.008;
      const noteLength = 0.072;
      oscillator.type = "sine";
      oscillator.connect(output);
      output.connect(audio.destination);
      for (const [index, frequency] of notes.entries()) {
        const at = start + index * noteLength;
        oscillator.frequency.setValueAtTime(frequency, at);
        output.gain.setValueAtTime(0.0001, at);
        output.gain.linearRampToValueAtTime(0.075, at + 0.012);
        output.gain.exponentialRampToValueAtTime(0.0001, at + noteLength - 0.004);
      }
      const cue = { oscillator, output };
      playing = cue;
      oscillator.onended = () => {
        if (playing === cue) playing = null;
        oscillator.disconnect();
        output.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(start + notes.length * noteLength);
    } catch {
      // Audio can disappear during playback. The visible result is already complete.
      cancel();
    } finally {
      clearTimeout(timer);
    }
  }

  td.actionSounds = { prepare, play, cancel };

  const toggle = document.querySelector("[data-action-sounds]");
  const status = document.querySelector("[data-action-sounds-status]");
  const schoolNotice = document.querySelector("[data-action-sounds-school]");
  let statusKey = "";
  function renderStatus() {
    if (!status) return;
    const message = statusKey ? td.t(statusKey) : "";
    status.textContent = td.wordingText ? td.wordingText(message) : message;
  }

  if (toggle) {
    toggle.checked = enabled();
    toggle.disabled = false;
    toggle.addEventListener("change", () => {
      try {
        localStorage.setItem(preference, toggle.checked ? "on" : "off");
        statusKey = "Saved in this browser";
      } catch {
        toggle.checked = enabled();
        statusKey = "This browser could not save the sound preference.";
      }
      if (!canPlay()) cancel();
      renderStatus();
    });
  }

  function syncSchoolMode() {
    if (!toggle || !schoolNotice) return;
    schoolNotice.hidden = !school();
    toggle.setAttribute("aria-describedby", schoolNotice.hidden ? "action-sounds-help" : "action-sounds-help action-sounds-school");
  }

  window.addEventListener("td:wording-change", renderStatus);
  window.addEventListener("td:school", () => { syncSchoolMode(); cancel(); });
  window.addEventListener("pagehide", cancel);
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
  window.addEventListener("storage", event => {
    if (event.key !== preference && event.key !== "td.schoolPin" && event.key !== null) return;
    if (toggle) toggle.checked = enabled();
    syncSchoolMode();
    cancel();
  });
})();
