export interface Vec2 {
  x: number;
  y: number;
}

export type ObstacleKind = 'spike' | 'gap' | 'lowCeiling' | 'doubleSpike' | 'choiceObstacle' | 'platform';
export type TrapState = 'idle' | 'armed' | 'warning' | 'triggered' | 'spent';
export type RouteLayer = 'lower' | 'mid' | 'upper';

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
  routeLayer?: RouteLayer;
  routeId?: string;
  // Disappearing platform configuration
  disappearMode?: 'onTouch' | 'timed' | 'afterDelay';
  disappearDelayMs?: number;
  reappearDelayMs?: number;
  maxDisappearCount?: number | null;
  // Disappearing platform runtime state
  disappearState?: 'visible' | 'disappearing' | 'invisible' | 'reappearing';
  disappearTimer?: number;
  disappearCount?: number;
}

export type GameState = 'menu' | 'countdown' | 'paused' | 'playing' | 'dead' | 'levelComplete';

export type LevelMutationActionType =
  | 'ADD_SPIKE'
  | 'ADD_LANDING_HAZARD'
  | 'MAKE_PLATFORM_DISAPPEAR'
  | 'INCREASE_GAP'
  | 'ADD_ROUTE_BLOCKER';

export interface LevelMutationAction {
  id: string;
  type: LevelMutationActionType;
  targetX: number;
  targetRouteLayer?: RouteLayer;
  difficultyCost: number;
  reason: string;
}

export interface DifficultyBudget {
  total: number;
  spent: number;
}
