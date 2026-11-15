// Every sound is procedural WebAudio: one shared noise buffer, short oscillators and
// envelopes, no audio files and no network. The context is created on the first
// user gesture; before that every call is a silent no-op, so ?shot= captures run
// cleanly and a headless browser never throws.
export function createSfx() {
  let ctx = null;
  let master = null;
  let noise = null;
  let lastStep = 0;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.42;
      master.connect(ctx.destination);
      const length = ctx.sampleRate;
      noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function tone(freq, dur, type, vol, slideTo) {
    if (!ensure() || ctx.state === 'suspended') return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), ctx.currentTime + dur);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + dur + 0.02);
    } catch { /* sound is never fatal */ }
  }

  function burst(dur, vol, filterFreq, filterType = 'lowpass') {
    if (!ensure() || ctx.state === 'suspended') return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = filterFreq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start();
      src.stop(ctx.currentTime + dur + 0.02);
    } catch { /* sound is never fatal */ }
  }

  const SHOT_TONE = { pistol: [190, 0.09], smg: [240, 0.07], rifle: [150, 0.11], shotgun: [110, 0.16], sniper: [95, 0.22] };

  return {
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    shot(kind) {
      const spec = SHOT_TONE[kind] || SHOT_TONE.rifle;
      burst(0.09, 0.5, 3200, 'bandpass');
      tone(spec[0], spec[1], 'square', 0.22, 55);
    },
    // A bot's shot, heard from wherever it fired: louder up close, a faint
    // crack at forty metres. dist is the metres from the shooter to the player.
    distantShot(dist = 20) {
      const vol = Math.max(0.04, 0.16 * (1 - Math.min(1, dist / 40)));
      burst(0.08, vol, 900, 'bandpass');
      tone(120, 0.08, 'square', vol * 0.45, 60);
    },
    dry() {
      tone(1400, 0.03, 'square', 0.1);
    },
    reload() {
      tone(700, 0.04, 'square', 0.12);
      setTimeout(() => tone(500, 0.04, 'square', 0.12), 180);
      setTimeout(() => tone(900, 0.05, 'square', 0.14), 420);
    },
    hit() {
      tone(1900, 0.045, 'sine', 0.2);
    },
    kill() {
      tone(1900, 0.05, 'sine', 0.2);
      setTimeout(() => tone(2500, 0.07, 'sine', 0.22), 70);
    },
    hurt() {
      tone(110, 0.12, 'sawtooth', 0.2, 70);
    },
    explosion() {
      burst(0.9, 0.9, 500);
      tone(70, 0.8, 'sine', 0.5, 28);
    },
    beep(final) {
      tone(final ? 1500 : 1050, 0.09, 'sine', 0.22);
    },
    plantTick() {
      tone(1250, 0.05, 'sine', 0.14);
    },
    defuseTick() {
      tone(850, 0.05, 'sine', 0.14);
    },
    step(now) {
      if (now - lastStep < 0.34) return;
      lastStep = now;
      burst(0.05, 0.08, 500);
    },
    buy() {
      tone(880, 0.06, 'sine', 0.16);
      setTimeout(() => tone(1320, 0.08, 'sine', 0.16), 70);
    },
    deny() {
      tone(220, 0.09, 'square', 0.14, 160);
    },
    round(win) {
      const notes = win ? [523, 659, 784] : [392, 330, 262];
      notes.forEach((freq, i) => setTimeout(() => tone(freq, 0.22, 'triangle', 0.2), i * 130));
    },
    throwPin() {
      tone(600, 0.03, 'square', 0.1);
    },
  };
}
