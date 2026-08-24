// ── Steel & Tactics — synthesized WebAudio SFX (no assets) ─────────────────

export type SfxName =
  | "mg" | "cannon" | "flakShot" | "boom" | "boomBig" | "ricochet" | "clang"
  | "build" | "denied" | "coin" | "siren" | "whistle" | "reload" | "horn"
  | "tinnitus" | "click" | "alarm" | "sell" | "upgrade" | "flyby";

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.42;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.42, this.ctx.currentTime, 0.05);
  }

  private startAmbience() {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const lp = this.ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 220;
    const g = this.ctx.createGain(); g.gain.value = 0.028;
    src.connect(lp).connect(g).connect(this.master);
    src.start();
  }

  private noise(dur: number, freq: number, gain: number, type: BiquadFilterType = "lowpass", when = 0) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  private tone(
    dur: number, f0: number, f1: number, gain: number,
    type: OscillatorType = "sine", when = 0,
  ) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  play(name: SfxName) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case "mg":
        this.noise(0.07, 2600, 0.16, "highpass");
        this.tone(0.05, 210, 90, 0.1, "square");
        break;
      case "cannon":
        this.noise(0.3, 420, 0.5);
        this.tone(0.32, 82, 34, 0.5);
        this.noise(0.12, 1400, 0.18, "highpass");
        break;
      case "flakShot":
        this.noise(0.24, 600, 0.42);
        this.tone(0.26, 96, 42, 0.42);
        break;
      case "boom":
        this.noise(0.55, 240, 0.55);
        this.tone(0.5, 60, 26, 0.5);
        break;
      case "boomBig":
        this.noise(0.95, 180, 0.75);
        this.tone(0.85, 52, 22, 0.65);
        this.noise(0.4, 900, 0.2, "highpass", 0.05);
        break;
      case "ricochet":
        this.tone(0.28, 2200 + Math.random() * 800, 500, 0.12, "triangle");
        this.noise(0.08, 4200, 0.1, "highpass");
        break;
      case "clang":
        this.tone(0.14, 780, 320, 0.14, "square");
        this.noise(0.05, 3000, 0.1, "highpass");
        break;
      case "build":
        this.noise(0.09, 500, 0.3);
        this.tone(0.12, 140, 70, 0.3);
        this.noise(0.08, 700, 0.22, "lowpass", 0.12);
        break;
      case "denied":
        this.tone(0.16, 170, 110, 0.22, "square");
        break;
      case "coin":
        this.tone(0.07, 900, 1400, 0.12, "sine");
        break;
      case "siren":
        this.tone(1.7, 1500, 420, 0.14, "sawtooth");
        this.tone(1.7, 750, 210, 0.1, "sawtooth", 0.03);
        break;
      case "whistle":
        this.tone(0.7, 1900, 320, 0.1, "sine");
        break;
      case "reload":
        this.noise(0.04, 2400, 0.14, "highpass");
        this.tone(0.06, 110, 70, 0.16, "square", 0.08);
        this.noise(0.05, 1800, 0.14, "highpass", 0.22);
        break;
      case "horn":
        this.tone(0.3, 330, 325, 0.14, "square");
        this.tone(0.3, 414, 410, 0.12, "square");
        break;
      case "tinnitus":
        this.tone(1.4, 3400, 3200, 0.05, "sine");
        break;
      case "click":
        this.noise(0.03, 3200, 0.1, "highpass");
        break;
      case "alarm":
        this.tone(0.4, 620, 620, 0.16, "square");
        this.tone(0.4, 470, 470, 0.16, "square", 0.42);
        break;
      case "sell":
        this.tone(0.1, 500, 300, 0.14, "square");
        this.noise(0.1, 800, 0.18);
        break;
      case "upgrade":
        this.tone(0.1, 520, 780, 0.14, "square");
        this.tone(0.14, 780, 1180, 0.12, "square", 0.1);
        break;
      case "flyby":
        this.tone(1.0, 230, 85, 0.16, "sawtooth");
        this.noise(1.0, 750, 0.22, "bandpass");
        break;
    }
  }
}

export const sfx = new Sfx();
