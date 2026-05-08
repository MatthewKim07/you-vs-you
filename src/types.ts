export interface Vec2 {
  x: number;
  y: number;
}

export type ObstacleKind = 'spike' | 'gap' | 'lowCeiling' | 'doubleSpike' | 'choiceObstacle' | 'platform'
  | 'electricField'   // timed ground zone — deadly when active, safe when inactive
  | 'crusherCeiling'  // overhead crusher — cycles raised/crushed, must crouch when active
  | 'warningMarker';  // non-deadly floor indicator placed before new AI hazards
export type TrapState = 'idle' | 'armed' | 'warning' | 'triggered' | 'spent';
export type RouteLayer = 'lower' | 'mid' | 'upper';

// AI modifier — behavior overlaid on existing obstacles by levelMutator
export type AiModifierType =
  | 'risingSpike'        // rises from flat → full height on a timed cycle
  | 'pulsingSpike'       // pulses full → flat → full with safe windows
  | 'droppingPlatform'   // shakes then falls when player touches
  | 'temporaryBlocker'   // low ceiling cycles inactive → warning → active → gone
  | 'patrollingHazard'   // spike patrols left-right on predictable route
  | 'crumblePlatform';   // platform crumbles fast on touch with orange crack visual

export type AiModState =
  | 'inactive'   // safe / not present
  | 'warning'    // visible warning, not yet deadly
  | 'rising'     // animating to dangerous (spikes)
  | 'active'     // dangerous
  | 'hold'       // dangerous, held at peak
  | 'retracting' // animating away
  | 'dropping'   // platform falling
  | 'invisible'  // platform fully gone mid-cycle
  | 'spawning'   // platform rising back
  | 'crushing';  // crusher ceiling descending toward player

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
  aiModVisualHeight?: number; // current animated height for spikes (0..height) OR current clearance for crusherCeiling
  aiModDropOffset?: number;   // pixels fallen for droppingPlatform / crumblePlatform
  // Patrol movement fields (patrollingHazard modifier)
  patrolMinX?: number;        // leftmost patrol position
  patrolMaxX?: number;        // rightmost patrol position
  patrolSpeed?: number;       // patrol speed in pixels/second
  patrolDir?: number;         // current direction: 1 = right, -1 = left
  // Warning marker type (warningMarker kind)
  warningType?: 'moving' | 'electric' | 'crusher' | 'crumble';
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
  | 'APPLY_TEMP_BLOCKER'
  // New AI toolbox actions (5 new mechanics)
  | 'APPLY_PATROL_SPIKE'      // makes a spike patrol left-right — counters easy spike solvers
  | 'ADD_ELECTRIC_FIELD'      // timed deadly ground zone — counters fast/careless runners
  | 'ADD_CRUSHER_CEILING'     // overhead crusher section — counters jump-heavy players
  | 'APPLY_CRUMBLE_PLATFORM'  // fast-crumble platform — counters reliable-platform users
  | 'ADD_WARNING_MARKER';     // floor warning indicator auto-placed before new hazards

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
