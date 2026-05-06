export interface Vec2 {
  x: number;
  y: number;
}

export type ObstacleKind = 'spike' | 'gap' | 'lowCeiling' | 'doubleSpike' | 'choiceObstacle' | 'platform';
export type TrapState = 'idle' | 'armed' | 'warning' | 'triggered' | 'spent';

export interface Obstacle {
  kind: ObstacleKind;
  x: number;       // world-space left edge
  width: number;
  height: number;  // spikes: spike height; gaps: ignored; lowCeiling: clearance from ground
  // For platform obstacles: when true, platform blocks from below too (not one-way).
  solid?: boolean;
  // Trap system fields (optional)
  trapHost?: boolean;
  trapType?: string;
  trapGroupId?: string;
  trapState?: TrapState;
  trapReason?: string;
  trapTimer?: number;   // runtime mutable, seconds elapsed in current trapState
  currentHeight?: number;
  targetHeight?: number;
  currentX?: number;
  targetX?: number;
  currentWidth?: number;
  targetWidth?: number;
  animationProgress?: number;
  warningTimer?: number;
  triggeredByAI?: boolean;
  // stored initial runtime values so trap can be reset between runs on the same level
  trapInitialHeight?: number;
  trapInitialWidth?: number;
  trapInitialX?: number;
  // Spike extension for adaptiveChoiceGateJump — animates 0 → targetSpikeExt (tall upward spikes)
  currentSpikeExt?: number;
  targetSpikeExt?: number;
}

export type GameState = 'menu' | 'countdown' | 'paused' | 'playing' | 'dead' | 'levelComplete';
