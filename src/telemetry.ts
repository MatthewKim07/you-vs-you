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

// Task: decision-based obstacle tracking
export interface ChoiceDecisionEvent {
  obstacleId: string;     // e.g. "choice_1"
  obstacleKind: string;   // e.g. "choiceObstacle"
  x: number;              // x-position of the obstacle
  chosenAction: 'jump' | 'crouch';
  timeMs: number;
  success: boolean;       // did the player survive the choice?
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
}

export interface PlayerModel {
  prefersJump: boolean;
  prefersCrouch: boolean;
  jumpFrequency: number;
  crouchFrequency: number;
  reactionTiming: 'early' | 'balanced' | 'late';
  consistency: 'predictable' | 'mixed' | 'random';
  riskProfile: 'safe' | 'balanced' | 'aggressive';
  // NEW: choice-specific learning
  choiceJumpRate: number;
  choiceCrouchRate: number;
  preferredChoiceAction: 'jump' | 'crouch' | 'mixed' | 'unknown';
  choiceConsistency: 'predictable' | 'mixed' | 'unknown';
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
