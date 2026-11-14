// Procedural sound: every effect is synthesised with WebAudio, so the game ships
// no audio files and makes no network request. The context is created on the
// first user gesture (autoplay policy); verification runs keep it muted.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 1.0);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function noise(dur, filterFreq, type, gain, when = 0) {
    if (muted || !ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, type, gain, slideTo = 0, when = 0) {
    if (muted || !ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock() {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    setMuted(value) {
      muted = value;
    },
    get muted() {
      return muted;
    },
    shot() {
      noise(0.09, 1800, 'lowpass', 0.9);
      noise(0.05, 5200, 'highpass', 0.5);
      tone(160, 0.07, 'square', 0.22, 60);
    },
    distantShot() {
      noise(0.16, 700, 'lowpass', 0.28);
    },
    dryClick() {
      tone(1400, 0.03, 'square', 0.12);
    },
    reload() {
      tone(900, 0.04, 'square', 0.14);
      tone(600, 0.04, 'square', 0.14, 0, 0.18);
      tone(1100, 0.05, 'square', 0.16, 0, 0.55);
    },
    hit() {
      tone(2200, 0.05, 'sine', 0.22);
    },
    kill() {
      tone(880, 0.09, 'sine', 0.22);
      tone(1320, 0.12, 'sine', 0.2, 0, 0.08);
    },
    hurt() {
      tone(110, 0.16, 'sawtooth', 0.3, 70);
    },
    plantBeep() {
      tone(1250, 0.07, 'sine', 0.2);
    },
    defuseBeep() {
      tone(950, 0.07, 'sine', 0.2);
    },
    explosion() {
      noise(0.9, 320, 'lowpass', 1.0);
      noise(0.4, 2400, 'bandpass', 0.5);
      tone(90, 0.8, 'sine', 0.7, 30);
    },
    bounce() {
      tone(320, 0.05, 'triangle', 0.14, 180);
    },
    buy() {
      tone(660, 0.05, 'sine', 0.16);
      tone(990, 0.07, 'sine', 0.16, 0, 0.06);
    },
    roundWin() {
      tone(523, 0.14, 'sine', 0.2);
      tone(659, 0.14, 'sine', 0.2, 0, 0.13);
      tone(784, 0.24, 'sine', 0.22, 0, 0.26);
    },
    roundLose() {
      tone(392, 0.16, 'sine', 0.2);
      tone(330, 0.16, 'sine', 0.2, 0, 0.15);
      tone(262, 0.3, 'sine', 0.22, 0, 0.3);
    },
    denied() {
      tone(220, 0.09, 'square', 0.14);
    },
  };
}
