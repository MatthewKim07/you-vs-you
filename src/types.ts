export interface Vec2 {
  x: number;
  y: number;
}

export type ObstacleKind = 'spike' | 'gap' | 'lowCeiling' | 'doubleSpike' | 'choiceObstacle' | 'platform';
export type TrapState = 'idle' | 'armed' | 'warning' | 'triggered' | 'spent';
export type RouteLayer = 'lower' | 'mid' | 'upper';

// AI modifier — behavior overlaid on existing obstacles by levelMutator
export type AiModifierType =
  | 'risingSpike'       // rises from flat → full height on a timed cycle
  | 'pulsingSpike'      // pulses full → flat → full with safe windows
  | 'droppingPlatform'  // shakes then falls when player touches
  | 'temporaryBlocker'; // low ceiling cycles inactive → warning → active → gone

export type AiModState =
  | 'inactive'   // safe / not present
  | 'warning'    // visible warning, not yet deadly
  | 'rising'     // animating to dangerous (spikes)
  | 'active'     // dangerous
  | 'hold'       // dangerous, held at peak
  | 'retracting' // animating away
  | 'dropping'   // platform falling
  | 'invisible'  // platform fully gone mid-cycle
  | 'spawning';  // platform rising back

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
  // AI modifier — layered behavior on existing obstacles
  aiModifier?: AiModifierType;
  aiModState?: AiModState;
  aiModTimer?: number;
  aiModVisualHeight?: number; // current animated height for rising/pulsing spikes (0..height)
  aiModDropOffset?: number;   // pixels fallen for droppingPlatform
}

export type GameState = 'menu' | 'countdown' | 'paused' | 'playing' | 'dead' | 'levelComplete';

export type LevelMutationActionType =
  | 'ADD_SPIKE'
  | 'ADD_LANDING_HAZARD'
  | 'MAKE_PLATFORM_DISAPPEAR'
  | 'INCREASE_GAP'
  | 'ADD_ROUTE_BLOCKER'
  | 'APPLY_RISING_SPIKE'
  | 'APPLY_PULSING_SPIKE'
  | 'APPLY_DROPPING_PLATFORM'
  | 'APPLY_TEMP_BLOCKER';

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
