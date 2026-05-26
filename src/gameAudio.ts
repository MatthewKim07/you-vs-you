import * as Tone from 'tone';

type Wave = OscillatorType;
type N = string | null;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// ============================================================================
// Track Definitions — original compositions, public domain intent
// 8th-note grid: 16 bars × 8 steps = 128 elements per track. null = rest.
// ============================================================================

// ---- GAME TRACK 1: "Sprint!" — G major, 144 BPM ----
// Energetic platformer theme, arpeggiated melodies, bouncy bass.
const G1_LEAD: N[] = [
  // Phrase A (bars 1–4): G major arpeggios
  "G5","B5","D6","G6","F#6","D6","B5","G5",
  "A5","C6","E6","A6","G6","E6","C6","A5",
  "B5","D6","G6","B6","A6","G6","E6","D6",
  "C6","B5","A5","G5","F#5","E5","D5",null,
  // Phrase A' (bars 5–8): scale runs
  "G4","A4","B4","C5","D5","E5","F#5","G5",
  "A5","G5","F#5","E5","D5","C5","B4","A4",
  "G4","B4","D5","G5","B5","D6","G6","B6",
  "D7","B6","G6","D6","B5","G5","D5",null,
  // Phrase B (bars 9–12): bridge
  "E6","D6","C6","B5","A5","G5","F#5","E5",
  "D5","E5","F#5","G5","A5","B5","C6","D6",
  "G6","F#6","E6","D6","C6","B5","A5","G5",
  "F#5","E5","D5","C5","B4","A4","G4",null,
  // Return (bars 13–16)
  "G5","B5","D6","G6","F#6","D6","B5","G5",
  "A5","C6","E6","A6","G6","E6","C6","A5",
  "G5","B5","D6","G6","B6","G6","D6","B5",
  "G5",null,"G5",null,"G6",null,null,null,
];

const G1_BASS: N[] = [
  "G3",null,"D3",null,"G3",null,"D3",null,
  "A3",null,"E3",null,"A3",null,"E3",null,
  "G3",null,"D3",null,"G3",null,"B3",null,
  "C3",null,"G3",null,"G2",null,null,null,
  "G3",null,"D3",null,"G3",null,"D3",null,
  "A2",null,"D3",null,"A2",null,"D3",null,
  "G3",null,"D3",null,"G3",null,"D3",null,
  "G2",null,"D3",null,"G2",null,null,null,
  "E3",null,"B3",null,"E3",null,"B3",null,
  "D3",null,"A3",null,"D3",null,"A3",null,
  "G3",null,"D3",null,"G3",null,"E3",null,
  "D3",null,"A2",null,"G2",null,null,null,
  "G3",null,"D3",null,"G3",null,"D3",null,
  "A3",null,"E3",null,"A3",null,"E3",null,
  "G3",null,"D3",null,"B3",null,"D4",null,
  "G2",null,"G3",null,"G2",null,null,null,
];

function rep<T>(arr: T[], n: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(...arr);
  return out;
}

const G1_KICK  = rep(["C1",null,null,null,"C1",null,null,null] as N[], 16);
const G1_SNARE = rep([null,null,"C2",null,null,null,"C2",null] as N[], 16);
const G1_HIHAT = rep(["C4",null,"C4",null,"C4",null,"C4",null] as N[], 16);

// ---- GAME TRACK 2: "Dungeon Run" — D minor, 136 BPM ----
// Darker, driving, minor key urgency.
const G2_LEAD: N[] = [
  "D5","F5","A5","D6","C6","A5","F5","D5",
  "F5","G5","A5","C6","A5","G5","F5","E5",
  "D5","A4","D5","F5","G5","A5","C6","D6",
  "A5","F5","D5",null,null,null,null,null,
  "D6","C6","A5","G5","F5","E5","D5","C5",
  "A4","C5","D5","F5","G5","A5","G5","F5",
  "D5","F5","G5","A5","C6","D6","C6","A5",
  "G5","F5","E5","D5",null,null,null,null,
  "F5","G5","A5",null,"C6",null,"D6",null,
  "A5","G5","F5",null,"E5",null,"D5",null,
  "C5","D5","E5","F5","G5","A5",null,null,
  "D5",null,null,null,"D4",null,null,null,
  "D5","F5","A5","D6","C6","A5","F5","D5",
  "F5","A5","C6","F6","E6","C6","A5","F5",
  "D5","F5","A5","D6","F6","A6","F6","D6",
  "A5","F5","D5",null,"D4",null,null,null,
];

const G2_BASS: N[] = [
  "D3",null,"A3",null,"D3",null,"A3",null,
  "F3",null,"C3",null,"F3",null,"A3",null,
  "G3",null,"D3",null,"G3",null,"A3",null,
  "A3",null,null,null,"D2",null,null,null,
  "D3",null,"A3",null,"D3",null,"A3",null,
  "A2",null,"D3",null,"A2",null,"F3",null,
  "G3",null,"D3",null,"G3",null,"A3",null,
  "D3",null,null,null,"D2",null,null,null,
  "F3",null,"C3",null,"F3",null,"C3",null,
  "A3",null,"E3",null,"A3",null,"E3",null,
  "C3",null,"G2",null,"C3",null,"G2",null,
  "D3",null,null,null,"D2",null,null,null,
  "D3",null,"A3",null,"D3",null,"A3",null,
  "F3",null,"C3",null,"F3",null,"A3",null,
  "G3",null,"D3",null,"G3",null,"A3",null,
  "D2",null,"A2",null,"D2",null,null,null,
];

const G2_KICK  = rep(["C1",null,null,null,null,null,"C1",null] as N[], 16);
const G2_SNARE = rep([null,null,"C2",null,null,null,"C2",null] as N[], 16);
const G2_HIHAT = rep(["C4","C4","C4","C4","C4","C4","C4","C4"] as N[], 16);

// ---- GAME TRACK 3: "Starfield" — E major, 152 BPM ----
// Fast, electric, ascending energy.
const G3_LEAD: N[] = [
  "E5","G#5","B5","E6","D#6","B5","G#5","E5",
  "F#5","A5","C#6","F#6","E6","C#6","A5","F#5",
  "G#5","B5","E6","G#6","F#6","E6","C#6","B5",
  "A5","B5","C#6","E6","B5","A5","G#5",null,
  "E6","D#6","C#6","B5","A5","G#5","F#5","E5",
  "F#5","G#5","A5","B5","C#6","D#6","E6","F#6",
  "G#6","F#6","E6","D#6","C#6","B5","A5","G#5",
  "F#5","E5","B4","E5","B5","E6",null,null,
  "C#6","B5","A5","G#5","F#5","E5","D#5","C#5",
  "B4","C#5","D#5","E5","F#5","G#5","A5","B5",
  "C#6","E6","G#6",null,"B5","G#5","E5",null,
  "F#5","G#5","A5","B5","E5",null,null,null,
  "E5","G#5","B5","E6","D#6","B5","G#5","E5",
  "F#5","A5","C#6","F#6","E6","C#6","A5","F#5",
  "E5","G#5","B5","E6","G#6","B6","E7",null,
  "B6","G#6","E6","B5","G#5","E5",null,null,
];

const G3_BASS: N[] = [
  "E3",null,"B3",null,"E3",null,"B3",null,
  "F#3",null,"C#3",null,"F#3",null,"A3",null,
  "G#3",null,"D#3",null,"G#3",null,"B3",null,
  "A3",null,"E3",null,"B2",null,null,null,
  "E3",null,"B3",null,"E3",null,"B3",null,
  "F#3",null,"C#3",null,"F#3",null,"C#4",null,
  "G#3",null,"D#3",null,"G#3",null,"D#4",null,
  "B3",null,"E3",null,"B2",null,null,null,
  "C#3",null,"G#3",null,"C#3",null,"G#3",null,
  "B2",null,"F#3",null,"B2",null,"F#3",null,
  "G#3",null,"C#3",null,"G#3",null,"C#4",null,
  "F#3",null,"B2",null,"E2",null,null,null,
  "E3",null,"B3",null,"E3",null,"B3",null,
  "F#3",null,"C#3",null,"F#3",null,"A3",null,
  "E3",null,"B2",null,"E3",null,"B3",null,
  "E2",null,"B2",null,"E2",null,null,null,
];

const G3_KICK  = rep(["C1",null,"C1",null,"C1",null,"C1",null] as N[], 16);
const G3_SNARE = rep([null,null,"C2",null,null,null,"C2",null] as N[], 16);
const G3_HIHAT = rep(["C4","C4","C4","C4","C4","C4","C4","C4"] as N[], 16);

// ---- MENU TRACK 1: "Sunrise Plains" — C major, 108 BPM ----
// Warm, flowing, welcoming. Mario World-ish calm energy.
const M1_LEAD: N[] = [
  "C5","E5","G5",null,"A5","G5","E5",null,
  "F5",null,"A5",null,"C6",null,"E6",null,
  "D5","F5","A5",null,"G5","E5","D5",null,
  "C5","D5","E5","F5","G5",null,null,null,
  "G5","A5","B5",null,"C6","B5","A5",null,
  "G5","F5","E5",null,"D5","C5","B4",null,
  "C5","E5","G5","C6","B5","A5","G5","F5",
  "E5","D5","C5",null,null,null,null,null,
  "A4","C5","E5","A5","G5","E5","C5","A4",
  "F4","A4","C5","F5","E5","D5","C5","B4",
  "C5","E5","G5","C6","E6","D6","C6","B5",
  "A5","G5","F5","E5","D5","C5",null,null,
  "C5","E5","G5",null,"A5","G5","E5",null,
  "F5",null,"A5",null,"C6",null,"A5",null,
  "G5","E5","D5","C5","B4","G4","A4","B4",
  "C5",null,null,null,"C5",null,null,null,
];

const M1_BASS: N[] = [
  "C3",null,null,null,"G3",null,null,null,
  "F3",null,null,null,"C3",null,null,null,
  "A3",null,null,null,"E3",null,null,null,
  "G3",null,null,null,"G2",null,null,null,
  "G3",null,null,null,"D3",null,null,null,
  "G3",null,null,null,"G2",null,null,null,
  "C3",null,null,null,"G2",null,null,null,
  "G2",null,null,null,null,null,null,null,
  "A2",null,null,null,"E3",null,null,null,
  "F2",null,null,null,"C3",null,null,null,
  "C3",null,null,null,"G3",null,null,null,
  "A2",null,null,null,"G2",null,null,null,
  "C3",null,null,null,"G3",null,null,null,
  "F2",null,null,null,"C3",null,null,null,
  "G2",null,null,null,"D3",null,null,null,
  "C2",null,null,null,null,null,null,null,
];

// ---- MENU TRACK 2: "Wandering" — A minor, 84 BPM ----
// Sparse, ambient, Minecraft-ish. Space between notes is part of the melody.
const M2_LEAD: N[] = [
  "A4",null,null,null,"C5",null,null,null,
  "E5",null,null,null,"D5",null,null,null,
  null,null,"A5",null,null,null,"G5",null,
  "E5",null,null,null,"A4",null,null,null,
  "C5",null,"E5",null,"G5",null,"A5",null,
  "E5",null,"D5",null,"C5",null,null,null,
  "A4",null,"C5",null,"E5",null,"G5",null,
  "A5",null,null,null,null,null,null,null,
  "E5",null,null,null,"C5",null,null,null,
  "A4",null,"G4",null,null,null,null,null,
  "D5",null,null,null,"A4",null,null,null,
  "E5",null,null,null,"A3",null,null,null,
  "A4",null,null,null,"C5",null,null,null,
  "E5",null,"G5",null,"A5",null,null,null,
  "G5",null,"E5",null,"C5",null,"A4",null,
  "E4",null,null,null,null,null,null,null,
];

const M2_BASS: N[] = [
  "A2",null,null,null,null,null,null,null,
  "E3",null,null,null,null,null,null,null,
  null,null,null,null,"A2",null,null,null,
  "E2",null,null,null,null,null,null,null,
  "A2",null,null,null,"E3",null,null,null,
  "G2",null,null,null,"C3",null,null,null,
  "A2",null,null,null,"E2",null,null,null,
  "A1",null,null,null,null,null,null,null,
  "E2",null,null,null,"C3",null,null,null,
  "A2",null,null,null,null,null,null,null,
  "D2",null,null,null,"A2",null,null,null,
  "E2",null,null,null,null,null,null,null,
  "A2",null,null,null,null,null,null,null,
  "E2",null,null,null,"G2",null,null,null,
  "C2",null,null,null,"G2",null,null,null,
  "A1",null,null,null,null,null,null,null,
];

// ============================================================================

type SimpleWave = 'sine' | 'triangle' | 'square' | 'sawtooth';

interface TrackDef {
  lead: N[];
  bass: N[];
  kick?: N[];
  snare?: N[];
  hihat?: N[];
  bpm: number;
  bars: number;
  leadWave: SimpleWave;
  leadDur: string;
  bassDur: string;
  reverbDecay: number;
  reverbWet: number;
  leadVol: number;
  bassVol: number;
  drumVol: number;
}

const MENU_TRACKS: TrackDef[] = [
  {
    lead: M1_LEAD, bass: M1_BASS, bpm: 108, bars: 16,
    leadWave: 'triangle', leadDur: '4n', bassDur: '2n',
    reverbDecay: 1.0, reverbWet: 0.35,
    leadVol: 0.40, bassVol: 0.22, drumVol: 0,
  },
  {
    lead: M2_LEAD, bass: M2_BASS, bpm: 84, bars: 16,
    leadWave: 'sine', leadDur: '2n', bassDur: '1n',
    reverbDecay: 1.8, reverbWet: 0.55,
    leadVol: 0.38, bassVol: 0.18, drumVol: 0,
  },
];

const GAME_TRACKS: TrackDef[] = [
  {
    lead: G1_LEAD, bass: G1_BASS, kick: G1_KICK, snare: G1_SNARE, hihat: G1_HIHAT,
    bpm: 144, bars: 16,
    leadWave: 'square', leadDur: '8n', bassDur: '4n',
    reverbDecay: 0.3, reverbWet: 0.18,
    leadVol: 0.35, bassVol: 0.26, drumVol: 0.20,
  },
  {
    lead: G2_LEAD, bass: G2_BASS, kick: G2_KICK, snare: G2_SNARE, hihat: G2_HIHAT,
    bpm: 136, bars: 16,
    leadWave: 'square', leadDur: '8n', bassDur: '4n',
    reverbDecay: 0.4, reverbWet: 0.22,
    leadVol: 0.32, bassVol: 0.28, drumVol: 0.22,
  },
  {
    lead: G3_LEAD, bass: G3_BASS, kick: G3_KICK, snare: G3_SNARE, hihat: G3_HIHAT,
    bpm: 152, bars: 16,
    leadWave: 'square', leadDur: '8n', bassDur: '4n',
    reverbDecay: 0.25, reverbWet: 0.15,
    leadVol: 0.36, bassVol: 0.24, drumVol: 0.18,
  },
];

// ============================================================================

export class GameAudio {
  private enabled = true;
  private masterGain = 0.18;
  private lastTrapCueAt = 0;
  private trapCueCooldownSec = 0.07;
  private musicVolume = 0.55;
  private musicMode: 'none' | 'menu' | 'gameplay' = 'none';
  private musicMuted = false;

  // Tone.js music state
  private toneReady = false;
  private toneMasterGain: Tone.Gain | null = null;
  private activeSeqs: Tone.Sequence[] = [];
  private activeNodes: Tone.ToneAudioNode[] = [];
  private trackTimer: number | null = null;
  private menuTrackIdx = -1;
  private gameTrackIdx = -1;

  // Raw Web Audio API context for SFX (shared with Tone.js after unlock)
  private ctx: AudioContext | null = null;

  unlock(): void {
    if (!this.enabled) return;
    void Tone.start().then(() => {
      this.toneReady = true;
      this.ctx = Tone.getContext().rawContext as AudioContext;
      if (this.musicMode !== 'none' && !this.musicMuted) {
        this.launchTrack();
      }
    });
  }

  isUnlocked(): boolean {
    return this.toneReady;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stopMusic();
  }

  setSfxVolume(volume01: number): void {
    this.masterGain = clamp01(volume01) * 0.28;
  }

  getSfxVolume(): number {
    return clamp01(this.masterGain / 0.28);
  }

  setMusicVolume(volume01: number): void {
    const v = Math.max(0.0001, clamp01(volume01));
    this.musicVolume = v;
    if (this.toneMasterGain && !this.musicMuted) {
      this.toneMasterGain.gain.rampTo(v, 0.08);
    }
  }

  getMusicVolume(): number {
    return clamp01(this.musicVolume);
  }

  startMenuMusic(): void {
    if (!this.enabled) return;
    const wasPlaying = this.musicMode === 'menu';
    this.musicMode = 'menu';
    this.musicMuted = false;
    if (this.toneReady && !wasPlaying) this.launchTrack();
    if (this.toneReady && wasPlaying) this.setToneMuted(false);
  }

  startGameplayMusic(): void {
    if (!this.enabled) return;
    this.musicMode = 'gameplay';
    this.musicMuted = false;
    if (this.toneReady) this.launchTrack();
  }

  stopMusic(): void {
    this.musicMode = 'none';
    this.disposeActiveTrack();
    this.setToneMuted(true);
  }

  setPaused(paused: boolean): void {
    this.musicMuted = paused;
    this.setToneMuted(paused);
  }

  private setToneMuted(muted: boolean): void {
    if (!this.toneMasterGain) return;
    const target = muted ? 0.0001 : Math.max(0.0001, this.musicVolume);
    this.toneMasterGain.gain.rampTo(target, 0.08);
  }

  private launchTrack(): void {
    this.disposeActiveTrack();

    if (!this.toneMasterGain) {
      this.toneMasterGain = new Tone.Gain(0.0001).toDestination();
    }

    const playlist = this.musicMode === 'menu' ? MENU_TRACKS : GAME_TRACKS;
    if (this.musicMode === 'menu') {
      this.menuTrackIdx = (this.menuTrackIdx + 1) % playlist.length;
    } else {
      this.gameTrackIdx = (this.gameTrackIdx + 1) % playlist.length;
    }
    const idx = this.musicMode === 'menu' ? this.menuTrackIdx : this.gameTrackIdx;
    const t = playlist[idx];

    Tone.getTransport().bpm.value = t.bpm;

    // Effects
    const reverb = new Tone.Reverb({ decay: t.reverbDecay, wet: t.reverbWet });
    this.activeNodes.push(reverb);

    // Lead synth
    const leadGain = new Tone.Gain(t.leadVol).connect(reverb);
    reverb.connect(this.toneMasterGain);
    const leadSynth = new Tone.Synth({
      oscillator: { type: t.leadWave },
      envelope: {
        attack: t.leadWave === 'sine' ? 0.05 : 0.005,
        decay: 0.15,
        sustain: t.leadWave === 'sine' ? 0.8 : 0.5,
        release: t.leadWave === 'sine' ? 0.6 : 0.08,
      },
    }).connect(leadGain);
    this.activeNodes.push(leadGain, leadSynth);

    // Bass synth
    const bassGain = new Tone.Gain(t.bassVol).connect(this.toneMasterGain);
    const bassSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: {
        attack: 0.005,
        decay: 0.2,
        sustain: t.leadWave === 'sine' ? 0.9 : 0.35,
        release: t.leadWave === 'sine' ? 0.8 : 0.05,
      },
    }).connect(bassGain);
    this.activeNodes.push(bassGain, bassSynth);

    // Sequences
    const leadDur = t.leadDur;
    const bassDur = t.bassDur;

    const leadSeq = new Tone.Sequence(
      (time, note) => { if (note) leadSynth.triggerAttackRelease(note as string, leadDur, time); },
      t.lead, '8n',
    );
    const bassSeq = new Tone.Sequence(
      (time, note) => { if (note) bassSynth.triggerAttackRelease(note as string, bassDur, time); },
      t.bass, '8n',
    );
    this.activeSeqs.push(leadSeq, bassSeq);

    // Drums (gameplay tracks only)
    if (t.kick && t.snare && t.hihat && t.drumVol > 0) {
      const drumGain = new Tone.Gain(t.drumVol).connect(this.toneMasterGain);
      this.activeNodes.push(drumGain);

      const kickSynth = new Tone.MembraneSynth({
        pitchDecay: 0.05, octaves: 6,
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
      }).connect(drumGain);
      const snareSynth = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.02 },
      }).connect(drumGain);
      const hihatGain = new Tone.Gain(0.4).connect(drumGain);
      const hihatSynth = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.005 },
      }).connect(hihatGain);
      this.activeNodes.push(kickSynth, snareSynth, hihatSynth, hihatGain);

      const kick = t.kick;
      const snare = t.snare;
      const hihat = t.hihat;
      const kickSeq = new Tone.Sequence(
        (time, n) => { if (n) kickSynth.triggerAttackRelease('16n', time); },
        kick, '8n',
      );
      const snareSeq = new Tone.Sequence(
        (time, n) => { if (n) snareSynth.triggerAttackRelease('8n', time); },
        snare, '8n',
      );
      const hihatSeq = new Tone.Sequence(
        (time, n) => { if (n) hihatSynth.triggerAttackRelease('16n', time); },
        hihat, '8n',
      );
      this.activeSeqs.push(kickSeq, snareSeq, hihatSeq);
    }

    // Reset and start transport
    const transport = Tone.getTransport();
    if (transport.state === 'started') transport.stop();
    transport.cancel(0);
    transport.position = '0:0:0';

    for (const seq of this.activeSeqs) seq.start(0);
    transport.start('+0.1');

    // Fade in
    const targetVol = this.musicMuted ? 0.0001 : Math.max(0.0001, this.musicVolume);
    this.toneMasterGain.gain.rampTo(targetVol, 0.4);

    // Schedule rotation to next track after 2 full loops
    const loopMs = (60000 / t.bpm) * 4 * t.bars;
    this.trackTimer = window.setTimeout(() => {
      if (this.musicMode !== 'none') this.launchTrack();
    }, loopMs * 2 - 200);
  }

  private disposeActiveTrack(): void {
    if (this.trackTimer !== null) {
      window.clearTimeout(this.trackTimer);
      this.trackTimer = null;
    }
    for (const seq of this.activeSeqs) {
      try { seq.stop(); seq.dispose(); } catch { /* already disposed */ }
    }
    for (const node of this.activeNodes) {
      try { node.dispose(); } catch { /* already disposed */ }
    }
    this.activeSeqs = [];
    this.activeNodes = [];
    const t = Tone.getTransport();
    if (t.state === 'started') t.stop();
  }

  // ============================================================================
  // SFX — raw Web Audio API (fast, fire-and-forget)
  // ============================================================================

  playMenuStart(): void {
    const t = this.now();
    if (t === null) return;
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

  playPhase(): void {
    const t = this.now();
    if (t === null) return;
    this.slide(t, 880, 2200, 0.08, 0.09, 'triangle');
    this.tone(t + 0.05, 2400, 0.04, 0.06, 'sine');
    this.tone(t + 0.07, 1800, 0.03, 0.05, 'triangle');
  }

  playPhaseDenied(): void {
    const t = this.now();
    if (t === null) return;
    this.tone(t, 180, 0.05, 0.06, 'square');
    this.tone(t + 0.04, 120, 0.06, 0.05, 'triangle');
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

  // ============================================================================
  // SFX internals
  // ============================================================================

  private now(): number | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      // Before Tone.js unlocks, try a raw context for SFX only
      if (typeof window === 'undefined' || !('AudioContext' in window)) {
        this.enabled = false;
        return null;
      }
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx.currentTime;
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
    start: number, fromHz: number, toHz: number,
    duration: number, volume: number, wave: Wave,
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
