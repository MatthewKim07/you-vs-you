type Wave = OscillatorType;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private masterGain = 0.18;
  private lastTrapCueAt = 0;
  private trapCueCooldownSec = 0.07;

  private musicGain: GainNode | null = null;
  private musicMode: 'none' | 'menu' | 'gameplay' = 'none';
  private musicTimer: number | null = null;
  private nextNoteAt = 0;
  private musicStep = 0;
  private bpm = 120;
  private musicVolume = 0.55;

  unlock(): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
  }

  isUnlocked(): boolean {
    return this.ctx !== null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stopMusic();
    }
  }

  setSfxVolume(volume01: number): void {
    this.masterGain = clamp01(volume01) * 0.28;
  }

  getSfxVolume(): number {
    return clamp01(this.masterGain / 0.28);
  }

  setMusicVolume(volume01: number): void {
    const normalized = clamp01(volume01);
    this.musicVolume = Math.max(0.0001, normalized);
    if (!this.musicGain || !this.ctx) return;
    if (this.musicMode === 'none') return;
    const now = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(Math.max(0.0001, this.musicGain.gain.value), now);
    this.musicGain.gain.exponentialRampToValueAtTime(this.musicVolume, now + 0.08);
  }

  getMusicVolume(): number {
    return clamp01(this.musicVolume);
  }

  startMenuMusic(): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (!this.musicGain) this.musicGain = ctx.createGain();
    this.musicGain.connect(ctx.destination);
    this.musicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.setMusicMode('menu');
    this.setMusicMuted(false);
  }

  startGameplayMusic(): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (!this.musicGain) this.musicGain = ctx.createGain();
    this.musicGain.connect(ctx.destination);
    this.musicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.setMusicMode('gameplay');
    this.setMusicMuted(false);
  }

  stopMusic(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.musicMode = 'none';
    if (this.musicGain) {
      const now = ctx.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(Math.max(0.0001, this.musicGain.gain.value), now);
      this.musicGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    }
  }

  setPaused(paused: boolean): void {
    this.setMusicMuted(paused);
  }

  private setMusicMuted(muted: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const now = ctx.currentTime;
    const target = muted ? 0.0001 : this.musicVolume;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(Math.max(0.0001, this.musicGain.gain.value), now);
    this.musicGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, target), now + 0.08);
  }

  private setMusicMode(mode: 'menu' | 'gameplay'): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.musicMode = mode;
    this.musicStep = 0;
    this.nextNoteAt = 0;

    if (mode === 'menu') {
      this.bpm = 112;
      this.musicVolume = 0.45;
    } else {
      this.bpm = 128;
      this.musicVolume = 0.55;
    }

    // Clear to silence now; scheduler will fade in.
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.musicGain) this.musicGain = ctx.createGain();
    this.musicGain.disconnect();
    this.musicGain.connect(ctx.destination);
    this.musicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.musicGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, this.musicVolume), ctx.currentTime + 0.12);

    this.nextNoteAt = ctx.currentTime + 0.04;

    this.musicTimer = window.setInterval(() => {
      // Schedule notes a bit ahead for smooth playback.
      const lookAheadSec = 0.18;
      while (this.ctx && this.nextNoteAt < this.ctx.currentTime + lookAheadSec) {
        this.scheduleMusicNote(this.nextNoteAt, this.musicStep);
        this.nextNoteAt += this.beatSec() / 2; // 8th-note grid
        this.musicStep++;
      }
    }, 60);
  }

  private beatSec(): number {
    return 60 / this.bpm;
  }

  private scheduleMusicNote(time: number, step: number): void {
    const ctx = this.ctx;
    const musicGain = this.musicGain;
    if (!ctx || !musicGain) return;
    if (this.musicMode === 'none') return;

    const isMenu = this.musicMode === 'menu';
    const waveLead: Wave = isMenu ? 'square' : 'square';
    const waveBass: Wave = isMenu ? 'triangle' : 'triangle';

    // Long loops: 64 eighth-notes.
    // menu @112 BPM -> ~17.1s, gameplay @128 BPM -> 15.0s.
    const loopSteps = 64;
    const stepInLoop = step % loopSteps;
    const bar = Math.floor(stepInLoop / 8); // 8 eighth-notes per bar
    const pos = stepInLoop % 8;

    const leadFreq = isMenu
      ? this.menuLeadNote(bar, pos)
      : this.gameLeadNote(bar, pos);
    const bassFreq = isMenu
      ? this.menuBassNote(bar, pos)
      : this.gameBassNote(bar, pos);

    // 8th note duration
    const dur = this.beatSec() / 2 * 0.92;
    const leadVol = isMenu ? 0.26 : 0.3;
    const bassVol = isMenu ? 0.12 : 0.14;

    if (leadFreq > 0) {
      this.chipTone(time, leadFreq, dur, waveLead, leadVol, musicGain);
    }
    // Bass: mostly quarter-note pulses plus occasional fills.
    const bassGate = isMenu ? pos % 2 === 0 : pos % 2 === 0 || (bar % 4 === 3 && pos === 7);
    if (bassFreq > 0 && bassGate) {
      this.chipTone(time + this.beatSec() / 16, bassFreq, dur * 1.05, waveBass, bassVol, musicGain);
    }
  }

  private menuLeadNote(bar: number, pos: number): number {
    // C-major flavored menu tune, intentionally relaxed.
    const a = [0, 659.25, 783.99, 880.0, 783.99, 698.46, 659.25, 523.25];
    const b = [0, 659.25, 698.46, 783.99, 698.46, 659.25, 587.33, 523.25];
    const c = [0, 587.33, 659.25, 698.46, 783.99, 698.46, 659.25, 587.33];
    const d = [0, 523.25, 587.33, 659.25, 698.46, 659.25, 587.33, 523.25];
    const map = [a, b, a, c, a, b, d, c];
    return map[bar]?.[pos] ?? 0;
  }

  private menuBassNote(bar: number, pos: number): number {
    const roots = [261.63, 293.66, 261.63, 220.0, 261.63, 293.66, 196.0, 220.0];
    const fifths = [392.0, 440.0, 392.0, 329.63, 392.0, 440.0, 293.66, 329.63];
    if (pos === 0 || pos === 4) return roots[bar] ?? 0;
    if (pos === 2 || pos === 6) return fifths[bar] ?? 0;
    return 0;
  }

  private gameLeadNote(bar: number, pos: number): number {
    // Higher-energy gameplay theme; still same tonal family as menu.
    const p1 = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 587.33, 659.25];
    const p2 = [587.33, 698.46, 783.99, 1174.66, 783.99, 698.46, 659.25, 587.33];
    const p3 = [659.25, 783.99, 880.0, 1046.5, 880.0, 783.99, 698.46, 659.25];
    const p4 = [523.25, 587.33, 659.25, 783.99, 659.25, 587.33, 523.25, 493.88];
    const map = [p1, p2, p1, p3, p1, p2, p4, p3];
    return map[bar]?.[pos] ?? 0;
  }

  private gameBassNote(bar: number, pos: number): number {
    const roots = [130.81, 146.83, 130.81, 164.81, 130.81, 146.83, 123.47, 164.81];
    const walk = [196.0, 220.0, 196.0, 246.94, 196.0, 220.0, 185.0, 246.94];
    if (pos === 0 || pos === 4) return roots[bar] ?? 0;
    if (pos === 2 || pos === 6) return walk[bar] ?? 0;
    return 0;
  }

  private chipTone(
    time: number,
    freq: number,
    duration: number,
    wave: Wave,
    volume: number,
    musicGain: GainNode,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(gain);
    gain.connect(musicGain);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  playMenuStart(): void {
    const t = this.now();
    if (t === null) return;
    // A short, recognizable chord.
    this.tone(t, 523.25, 0.07, 0.12, 'square');
    this.tone(t + 0.02, 659.25, 0.07, 0.12, 'square');
    this.tone(t + 0.04, 783.99, 0.07, 0.12, 'square');
  }

  playUiClick(): void {
    const t = this.now();
    if (t === null) return;
    this.tone(t, 820, 0.04, 0.08, 'triangle');
    this.tone(t + 0.02, 540, 0.05, 0.06, 'square');
  }

  playRetry(): void {
    const t = this.now();
    if (t === null) return;
    this.slide(t, 260, 520, 0.12, 0.12, 'square');
    this.slide(t + 0.04, 440, 880, 0.1, 0.1, 'triangle');
  }

  playAdvance(): void {
    const t = this.now();
    if (t === null) return;
    this.tone(t, 392, 0.06, 0.09, 'square');
    this.tone(t + 0.06, 494, 0.06, 0.09, 'square');
    this.tone(t + 0.12, 659.25, 0.08, 0.11, 'triangle');
  }

  playCountdownTick(count: number): void {
    const t = this.now();
    if (t === null) return;
    const base = count >= 3 ? 520 : count === 2 ? 600 : 680;
    this.tone(t, base, 0.06, 0.1, 'square');
    this.tone(t + 0.03, base * 1.25, 0.05, 0.07, 'triangle');
  }

  playCountdownGo(): void {
    const t = this.now();
    if (t === null) return;
    this.tone(t, 523.25, 0.07, 0.1, 'square');
    this.tone(t + 0.06, 659.25, 0.07, 0.1, 'square');
    this.tone(t + 0.12, 783.99, 0.1, 0.12, 'triangle');
  }

  playJump(): void {
    const t = this.now();
    if (t === null) return;
    this.tone(t, 640, 0.045, 0.09, 'square');
    this.tone(t + 0.03, 840, 0.04, 0.06, 'triangle');
  }

  playDeath(): void {
    const t = this.now();
    if (t === null) return;
    this.slide(t, 380, 120, 0.24, 0.12, 'sawtooth');
    this.slide(t + 0.06, 220, 75, 0.22, 0.09, 'square');
    this.noiseBurst(t + 0.02, 0.1, 0.03);
  }

  playLevelComplete(): void {
    const t = this.now();
    if (t === null) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => this.tone(t + i * 0.075, n, 0.1, 0.1, 'square'));
  }

  playTrapCue(trapType?: string): void {
    const t = this.now();
    if (t === null) return;
    if (t - this.lastTrapCueAt < this.trapCueCooldownSec) return;
    this.lastTrapCueAt = t;

    switch (trapType) {
      case 'reactiveLowCeiling':
        this.tone(t, 210, 0.08, 0.1, 'triangle');
        this.tone(t + 0.03, 330, 0.06, 0.09, 'square');
        break;
      case 'popUpSpike':
        this.slide(t, 240, 680, 0.12, 0.11, 'triangle');
        break;
      case 'platformNeedle':
        this.tone(t, 290, 0.06, 0.09, 'square');
        this.tone(t + 0.04, 230, 0.09, 0.08, 'square');
        break;
      case 'collapsingPlatform':
        this.slide(t, 170, 95, 0.17, 0.12, 'sawtooth');
        break;
      case 'landingPunisher':
        this.tone(t, 330, 0.08, 0.1, 'square');
        this.slide(t + 0.03, 330, 840, 0.1, 0.08, 'triangle');
        break;
      case 'shiftingGap':
        this.slide(t, 410, 165, 0.16, 0.1, 'triangle');
        break;
      case 'adaptiveChoiceGateJump':
        this.tone(t, 700, 0.07, 0.09, 'square');
        this.tone(t + 0.05, 880, 0.06, 0.08, 'square');
        break;
      case 'adaptiveChoiceGateCrouch':
        this.tone(t, 260, 0.08, 0.1, 'square');
        this.tone(t + 0.05, 210, 0.08, 0.08, 'triangle');
        break;
      case 'routeReturnPunisher':
        this.tone(t, 520, 0.06, 0.08, 'square');
        this.slide(t + 0.04, 520, 740, 0.1, 0.08, 'triangle');
        break;
      default:
        this.tone(t, 520, 0.05, 0.08, 'triangle');
        break;
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined' || !('AudioContext' in window)) {
      this.enabled = false;
      return null;
    }
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    return this.ctx;
  }

  private now(): number | null {
    if (!this.enabled) return null;
    const ctx = this.ensureContext();
    if (!ctx) return null;
    return ctx.currentTime;
  }

  private tone(start: number, freq: number, duration: number, volume: number, wave: Wave): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, start);
    this.shape(gain, start, duration, volume);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private slide(
    start: number,
    fromHz: number,
    toHz: number,
    duration: number,
    volume: number,
    wave: Wave,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(fromHz, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, toHz), start + duration);
    this.shape(gain, start, duration, volume);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  private noiseBurst(start: number, duration: number, volume: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    const level = clamp01(volume * this.masterGain);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(start);
    src.stop(start + duration + 0.01);
  }

  private shape(gain: GainNode, start: number, duration: number, volume: number): void {
    const level = clamp01(volume * this.masterGain);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  }
}
