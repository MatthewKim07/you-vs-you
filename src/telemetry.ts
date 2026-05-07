import { Obstacle } from './types';

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

export interface ActionEvent {
  action: 'jump' | 'crouchStart' | 'crouchEnd';
  x: number;
  timeMs: number;
}

export type RouteId = 'lower' | 'mid' | 'upper';

export interface RouteChoiceEvent {
  routeId: RouteId;
  x: number;
  levelIndex: number;
  timeMs: number;
  success: boolean;
}

// Task: decision-based obstacle tracking
export interface ChoiceDecisionEvent {
  obstacleId: string;     // e.g. "choice_1"
  obstacleType: string;   // e.g. "adaptiveChoiceGate"
  obstacleKind?: string;  // backward-compatible alias
  x: number;              // x-position of the obstacle
  chosenAction: 'jump' | 'crouch';
  levelIndex: number;
  timeMs: number;
  success: boolean;       // did the player survive the choice?
}

export interface ObstacleInteractionEvent {
  obstacleId: string;
  obstacleKind: string;
  trapType?: string;
  routeLayer?: RouteId;
  x: number;
  levelIndex: number;
  action: 'jump' | 'crouch' | 'mixed' | 'none';
  outcome: 'passed' | 'death';
  timeMs: number;
}

export interface RunData {
  levelIndex: number;
  attemptNumber: number;
  startedAt: number;   // performance.now() wall time
  endedAt?: number;
  completed: boolean;
  obstaclesSnapshot?: Obstacle[];
  deathReason?: 'spike' | 'gap';
  deathX?: number;
  generatedDifficulty?: string;
  generatedStrategy?: string;
  generatedDensity?: string;
  generatedVariants?: string[];
  jumps: JumpEvent[];
  landings: LandingEvent[];
  samples: PositionSample[];
  actions: ActionEvent[];
  choiceDecisions: ChoiceDecisionEvent[]; // NEW
  obstacleInteractions: ObstacleInteractionEvent[];
  routeChoices: RouteChoiceEvent[];
  routeUsageCounts: Record<RouteId, number>;
}

// Per-obstacle choice stats — sourced only from ChoiceDecisionEvents, not global actions.
export interface ObstacleChoiceStats {
  obstacleId: string;
  jumpCount: number;
  crouchCount: number;
  total: number;
  jumpRate: number;
  crouchRate: number;
  confidence: number;
  preferred: 'jump' | 'crouch' | 'mixed';
}

export interface ObstacleInteractionStats {
  obstacleId: string;
  obstacleKind: string;
  trapType?: string;
  routeLayer?: RouteId;
  x: number;
  total: number;
  passCount: number;
  deathCount: number;
  jumpCount: number;
  crouchCount: number;
  mixedCount: number;
  noneCount: number;
  preferredAction: 'jump' | 'crouch' | 'mixed' | 'none';
  failureRate: number;
  confidence: number;
}

export interface PlayerModel {
  prefersJump: boolean;
  prefersCrouch: boolean;
  jumpFrequency: number;
  crouchFrequency: number;
  reactionTiming: 'early' | 'balanced' | 'late';
  consistency: 'predictable' | 'mixed' | 'random';
  riskProfile: 'safe' | 'balanced' | 'aggressive';
  // choice-specific learning (gate decisions only)
  choiceJumpRate: number;
  choiceCrouchRate: number;
  choiceConfidence: number;
  preferredChoiceAction: 'jump' | 'crouch' | 'mixed' | 'unknown';
  choiceConsistency: 'predictable' | 'mixed' | 'unknown';
  // per-obstacle breakdown (gate decisions scoped by obstacleId)
  perObstacleChoiceStats: Record<string, ObstacleChoiceStats>;
  // every obstacle gets a scoped behavior record: action used, coordinate, and outcome
  perObstacleInteractionStats: Record<string, ObstacleInteractionStats>;
  preferredRoute: RouteId | 'mixed';
  routeConfidence: number;
  routeRiskStyle: 'safe-switcher' | 'committed' | 'opportunist';
  routeUsage: Record<RouteId, number>;
}

// Derived summary across all stored runs.
export interface PlayerProfile {
  totalRuns: number;
  completedRuns: number;
  averageJumpXDistance: number;    // avg px gap between consecutive jumps within a run
  averageCompletionTimeMs: number; // avg of (endedAt - startedAt) for completed runs
  commonLandingZones: number[];    // top-3 bucket centers (100px buckets) by landing frequency
  jumpStyle: 'early' | 'balanced' | 'late' | 'unknown';
}
