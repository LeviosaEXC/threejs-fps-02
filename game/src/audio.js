// Procedural WebAudio: no audio files, no network. Gunshots are filtered
// noise bursts (never bare oscillator beeps); footsteps, reload clicks,
// spike beeps, flash ringing and ambient wind are synthesized the same way.
// The context is created only after a user gesture; shot mode never starts
// it, so captures stay silent and error-free.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.wind = null;
    this.noiseBuf = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startWind();
      return true;
    } catch {
      return false;
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  startWind() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 320;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
    this.wind = src;
  }

  // Short filtered-noise burst with an exponential decay envelope.
  burst(freq, dur, vol, type = 'lowpass', when = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
    src.stop(t + dur + 0.1);
  }

  tone(freq, dur, vol, type = 'sine', when = 0, slideTo = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  shot(kind) {
    if (!this.ctx) return;
    const map = {
      pistol: [2400, 0.09, 0.5],
      smg: [3000, 0.07, 0.4],
      rifle: [1700, 0.13, 0.65],
      dmr: [1100, 0.22, 0.85],
      shotgun: [900, 0.2, 0.9],
    };
    const [f, d, v] = map[kind] || map.rifle;
    this.burst(f, d, v);
    this.burst(f * 0.4, d * 1.6, v * 0.5);
  }

  // Distant shot: quieter, lowpassed, for bot fire heard across the yard.
  distantShot(kind) {
    if (!this.ctx) return;
    this.burst(700, 0.1, 0.14, 'lowpass');
    void kind;
  }

  footstep(run) {
    this.burst(500, 0.05, run ? 0.09 : 0.05, 'lowpass');
  }

  reload() {
    this.tone(1400, 0.03, 0.12, 'square');
    this.tone(900, 0.04, 0.14, 'square', 0.12);
    this.tone(1800, 0.03, 0.12, 'square', 0.3);
  }

  click() { this.tone(2200, 0.02, 0.08, 'square'); }
  buy() { this.tone(660, 0.07, 0.12, 'sine'); this.tone(990, 0.09, 0.12, 'sine', 0.07); }
  deny() { this.tone(180, 0.12, 0.14, 'square'); }
  roundStart() { this.tone(523, 0.12, 0.14, 'sine'); this.tone(784, 0.16, 0.14, 'sine', 0.12); }
  roundWin() { this.tone(523, 0.12, 0.14, 'sine'); this.tone(659, 0.12, 0.14, 'sine', 0.12); this.tone(784, 0.22, 0.16, 'sine', 0.24); }
  roundLose() { this.tone(392, 0.14, 0.14, 'sine'); this.tone(311, 0.22, 0.14, 'sine', 0.14); }
  plantBeep(fast) { this.tone(fast ? 1320 : 880, 0.07, 0.16, 'sine'); }
  defuseTick() { this.tone(1100, 0.04, 0.1, 'sine'); }
  flashRing() { this.tone(2800, 0.7, 0.1, 'sine', 0, 2400); }
  hit() { this.tone(1500, 0.04, 0.1, 'square'); }
  kill() { this.tone(1500, 0.04, 0.12, 'square'); this.tone(2000, 0.06, 0.12, 'square', 0.05); }
  hurt() { this.burst(300, 0.12, 0.2, 'lowpass'); }
  pickup() { this.tone(990, 0.06, 0.1, 'sine'); this.tone(1320, 0.08, 0.1, 'sine', 0.06); }
}
