import { RunData, PlayerProfile } from './telemetry';

export class RunTracker {
  private runs: RunData[] = [];
  private current: RunData | null = null;

  startRun(levelIndex: number, attemptNumber: number): void {
    // Abandon any open run (e.g. level skip before death/complete)
    if (this.current) {
      this.runs.push({ ...this.current, endedAt: performance.now(), completed: false });
    }
    this.current = {
      levelIndex,
      attemptNumber,
      startedAt: performance.now(),
      completed: false,
      jumps: [],
      landings: [],
      samples: [],
    };
  }

  recordJump(x: number, y: number): void {
    if (!this.current) return;
    this.current.jumps.push({ x, y, timeMs: this.elapsed() });
  }

  recordLanding(x: number, y: number, airTimeMs?: number): void {
    if (!this.current) return;
    this.current.landings.push({ x, y, timeMs: this.elapsed(), airTimeMs });
  }

  recordSample(x: number, y: number): void {
    if (!this.current) return;
    this.current.samples.push({ x, y, timeMs: this.elapsed() });
  }

  finishRun(completed: boolean, deathReason?: 'spike' | 'gap', deathX?: number): void {
    if (!this.current) return;
    this.runs.push({
      ...this.current,
      endedAt: performance.now(),
      completed,
      deathReason,
      deathX,
    });
    this.current = null;
  }

  getCurrentRun(): RunData | null {
    return this.current;
  }

  getAllRuns(): RunData[] {
    return this.runs;
  }

  getProfile(): PlayerProfile {
    return buildProfile(this.runs);
  }

  private elapsed(): number {
    return this.current ? performance.now() - this.current.startedAt : 0;
  }
}

function buildProfile(runs: RunData[]): PlayerProfile {
  const totalRuns = runs.length;
  const completedRuns = runs.filter(r => r.completed).length;

  // Avg px gap between consecutive jumps within a run
  const jumpGaps: number[] = [];
  for (const run of runs) {
    for (let i = 1; i < run.jumps.length; i++) {
      jumpGaps.push(run.jumps[i].x - run.jumps[i - 1].x);
    }
  }
  const averageJumpXDistance =
    jumpGaps.length > 0 ? jumpGaps.reduce((a, b) => a + b, 0) / jumpGaps.length : 0;

  // Avg completion time for completed runs
  const times = runs
    .filter(r => r.completed && r.endedAt !== undefined)
    .map(r => r.endedAt! - r.startedAt);
  const averageCompletionTimeMs =
    times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;

  // Landing zones: bucket landings into 100px slots, return top-3 centers
  const BUCKET = 100;
  const buckets = new Map<number, number>();
  for (const run of runs) {
    for (const l of run.landings) {
      const key = Math.floor(l.x / BUCKET) * BUCKET;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  const commonLandingZones = [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => key + BUCKET / 2);

  // Jump style: classify by avg x-position of first jump per run
  const firstJumpXs = runs.filter(r => r.jumps.length > 0).map(r => r.jumps[0].x);
  let jumpStyle: PlayerProfile['jumpStyle'] = 'unknown';
  if (firstJumpXs.length >= 2) {
    const avg = firstJumpXs.reduce((a, b) => a + b, 0) / firstJumpXs.length;
    jumpStyle = avg < 450 ? 'early' : avg > 850 ? 'late' : 'balanced';
  }

  return {
    totalRuns,
    completedRuns,
    averageJumpXDistance,
    averageCompletionTimeMs,
    commonLandingZones,
    jumpStyle,
  };
}
