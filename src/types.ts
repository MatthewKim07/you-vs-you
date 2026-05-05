export interface Vec2 {
  x: number;
  y: number;
}

export type GameState = 'playing' | 'win';

// AI HOOK (Milestone 2+): extend with recorded run data for adaptive generation
export interface RunRecord {
  jumps: Array<{ x: number; velY: number }>;
  completionTimeMs: number;
}
