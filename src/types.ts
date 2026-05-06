export interface Vec2 {
  x: number;
  y: number;
}

export type ObstacleKind = 'spike' | 'gap' | 'lowCeiling' | 'doubleSpike' | 'choiceObstacle' | 'platform';

export interface Obstacle {
  kind: ObstacleKind;
  x: number;       // world-space left edge
  width: number;
  height: number;  // spikes: spike height; gaps: ignored; lowCeiling: clearance from ground
  // Trap system fields (optional)
  trapHost?: boolean;
  trapType?: string;
  trapState?: 'idle' | 'armed' | 'triggered' | 'spent';
  trapReason?: string;
  trapTimer?: number;   // runtime mutable, seconds elapsed in current trapState
}

export type GameState = 'menu' | 'countdown' | 'paused' | 'playing' | 'dead' | 'levelComplete';
