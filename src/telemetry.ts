// All telemetry types. No logic here — RunTracker owns collection, buildProfile owns analysis.

export interface JumpEvent {
  x: number;
  y: number;
  timeMs: number; // ms since run start
}

export interface LandingEvent {
  x: number;
  y: number;
  timeMs: number;
  airTimeMs?: number; // undefined for the initial spawn-to-first-landing
}

export interface PositionSample {
  x: number;
  y: number;
  timeMs: number;
}

export interface RunData {
  levelIndex: number;
  attemptNumber: number;
  startedAt: number;   // performance.now() wall time
  endedAt?: number;
  completed: boolean;
  deathReason?: 'spike' | 'gap';
  deathX?: number;
  jumps: JumpEvent[];
  landings: LandingEvent[];
  samples: PositionSample[];
}

// Derived summary across all stored runs — AI HOOK (Milestone 4): feed into level generator
export interface PlayerProfile {
  totalRuns: number;
  completedRuns: number;
  averageJumpXDistance: number;    // avg px gap between consecutive jumps within a run
  averageCompletionTimeMs: number; // avg of (endedAt - startedAt) for completed runs
  commonLandingZones: number[];    // top-3 bucket centers (100px buckets) by landing frequency
  jumpStyle: 'early' | 'balanced' | 'late' | 'unknown';
}
