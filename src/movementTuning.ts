import { GRAVITY, JUMP_FORCE, MOVE_SPEED } from './player';

export { GRAVITY, JUMP_FORCE, MOVE_SPEED };
export const PLAYER_WIDTH = 32;
export const PLAYER_HEIGHT = 48;
export const CROUCH_HEIGHT = 30;

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

// levelIndex is 0-based (Level 1 displayed = index 0, tutorial)
export function levelDifficulty(levelIndex: number): Difficulty {
  if (levelIndex <= 2) return 'easy';   // displayed L1–3
  if (levelIndex <= 4) return 'medium'; // displayed L4–5
  if (levelIndex <= 7) return 'hard';   // displayed L6–8
  return 'expert';
}

// Maximum height player reaches at apex of a full jump (px above takeoff)
// = JUMP_FORCE² / (2 * GRAVITY) ≈ 137px
export function calculateJumpApexHeight(): number {
  return Math.round((JUMP_FORCE * JUMP_FORCE) / (2 * GRAVITY));
}

// Time player spends in the air for a full jump (s)
// = 2 * |JUMP_FORCE| / GRAVITY ≈ 0.886s
export function calculateTotalAirTime(): number {
  return (2 * Math.abs(JUMP_FORCE)) / GRAVITY;
}

// Maximum horizontal distance covered in a full jump (px)
// = MOVE_SPEED * airTime ≈ 204px
export function calculateMaxJumpDistance(): number {
  return Math.round(MOVE_SPEED * calculateTotalAirTime());
}

// Percentage of max distance considered "safe" at each difficulty
const SAFE_FACTORS: Record<Difficulty, number> = {
  easy:   0.45, // 92px — forgiving
  medium: 0.60, // 122px — requires good timing
  hard:   0.75, // 153px — demands near-peak jumps
  expert: 0.85, // 173px — near-maximum
};

export function calculateSafeJumpDistance(difficulty: Difficulty): number {
  return Math.round(calculateMaxJumpDistance() * SAFE_FACTORS[difficulty]);
}

// Distance between obstacles in combos — shrinks with difficulty (less reaction time)
const REACTION_FACTORS: Record<Difficulty, number> = {
  easy:   1.00,
  medium: 0.85,
  hard:   0.70,
  expert: 0.55,
};

// Base reaction spacing at easy = MOVE_SPEED * 0.75s ≈ 173px
export function calculateReactionSpacing(difficulty: Difficulty): number {
  return Math.round(MOVE_SPEED * 0.75 * REACTION_FACTORS[difficulty]);
}

// Spacing used after a crouch obstacle — slightly shorter than reaction gap
export function calculateCrouchWindow(difficulty: Difficulty): number {
  return Math.round(MOVE_SPEED * 0.65 * REACTION_FACTORS[difficulty]);
}

// Edge-to-edge gap between stepGap platforms.
// Based on max jump distance so tiles are not bunched too closely.
const STEP_GAP_FACTORS: Record<Difficulty, number> = {
  easy: 0.52,
  medium: 0.58,
  hard: 0.64,
  expert: 0.70,
};
export function calculateStepGapLandingGap(difficulty: Difficulty): number {
  return Math.round(calculateMaxJumpDistance() * STEP_GAP_FACTORS[difficulty]);
}

// Horizontal gap between staircase steps — grows with difficulty
const STAIRCASE_H_GAP_FACTORS: Record<Difficulty, number> = {
  easy:   0.42,
  medium: 0.48,
  hard:   0.54,
  expert: 0.60,
};
export function calculateStaircaseHGap(difficulty: Difficulty): number {
  return Math.round(calculateMaxJumpDistance() * STAIRCASE_H_GAP_FACTORS[difficulty]);
}

// Step heights for staircase as fractions of apex height
// [20%, 35%, 50%, 65%] of ~137px ≈ [27, 48, 69, 89]px
export function calculateStaircaseHeights(): [number, number, number, number] {
  const apex = calculateJumpApexHeight();
  return [
    Math.round(apex * 0.20),
    Math.round(apex * 0.35),
    Math.round(apex * 0.50),
    Math.round(apex * 0.65),
  ];
}

// StepGap platform heights: low-high-low arc [~15%, ~26%, ~15%] of apex ≈ [21, 36, 21]px
export function calculateStepGapHeights(): [number, number, number] {
  const apex = calculateJumpApexHeight();
  return [
    Math.round(apex * 0.15),
    Math.round(apex * 0.26),
    Math.round(apex * 0.15),
  ];
}

// Variable jump: cut upward velocity to this fraction on early button release.
// Full hold = max jump; instant tap = min jump ≈ MOVE_SPEED * 2 * |JUMP_FORCE| * factor / GRAVITY ≈ 92px.
export const JUMP_CUT_FACTOR = 0.45;

export function calculateMinJumpDistance(): number {
  const minVy = Math.abs(JUMP_FORCE) * JUMP_CUT_FACTOR;
  return Math.round(MOVE_SPEED * (2 * minVy) / GRAVITY);
}
