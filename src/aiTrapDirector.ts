import { Obstacle } from './types';
import { PlayerModel, PlayerProfile } from './telemetry';
import {
  AIKnowledge,
  AIPhase,
  isTrapUnlocked,
  getMaxTrapHosts,
} from './aiKnowledge';
import { calculateMaxJumpDistance } from './movementTuning';

export interface TrapDirectiveOutput {
  obstacles: Obstacle[]; // full list, mutated + any new ones added
  activeTraps: string[];
  trapReasons: string[];
  phase: AIPhase;
  predictedLandingX?: number;
}

// Main trap director - decides which traps to activate
export function directTraps(
  phase: AIPhase,
  knowledge: AIKnowledge,
  model: PlayerModel,
  profile: PlayerProfile,
  obstacles: Obstacle[],
  levelIndex: number,
  reactionSpacing: number,
): TrapDirectiveOutput {
  const activeTraps: string[] = [];
  const trapReasons: string[] = [];
  let predictedLandingX: number | undefined;

  // Observe phase: no traps
  if (phase === 'observe') {
    return {
      obstacles,
      activeTraps: [],
      trapReasons: [],
      phase,
    };
  }

  const maxHosts = getMaxTrapHosts(phase);
  if (maxHosts === 0) {
    return {
      obstacles,
      activeTraps: [],
      trapReasons: [],
      phase,
    };
  }

  // Create a copy of obstacles to mutate
  const mutatedObstacles: Obstacle[] = obstacles.map((o) => ({ ...o }));
  let hostsApplied = 0;

  // Try to apply traps in order of intelligence/impact
  // Phase 2 (test): mild traps
  // Phase 3 (counter): active counter traps
  // Phase 4 (predict): prediction-based traps

  // 1. Reactive low ceiling - punish jump preference
  if (
    hostsApplied < maxHosts &&
    isTrapUnlocked('reactiveLowCeiling', knowledge) &&
    model.prefersJump
  ) {
    const result = applyReactiveLowCeiling(mutatedObstacles, levelIndex);
    if (result.applied) {
      hostsApplied++;
      activeTraps.push('reactiveLowCeiling');
      trapReasons.push(`Lowered ceiling height by ${result.amount}px to punish jump preference`);
    }
  }

  // 2. Fake choice obstacle - follow up choice with punishment
  if (
    hostsApplied < maxHosts &&
    isTrapUnlocked('fakeChoiceObstacle', knowledge) &&
    (model.prefersJump || model.prefersCrouch)
  ) {
    const result = applyFakeChoiceObstacle(mutatedObstacles, reactionSpacing, model.prefersJump);
    if (result.applied) {
      hostsApplied++;
      activeTraps.push('fakeChoiceObstacle');
      trapReasons.push(
        model.prefersJump
          ? 'Added spike after choice to punish jump bias'
          : 'Added low ceiling after choice to punish crouch bias',
      );
    }
  }

  // 3. Shifting gap - punish late reactions
  if (hostsApplied < maxHosts && isTrapUnlocked('shiftingGap', knowledge)) {
    const result = applyShiftingGap(mutatedObstacles, levelIndex);
    if (result.applied) {
      hostsApplied++;
      activeTraps.push('shiftingGap');
      trapReasons.push(`Widened gap by ${result.amount}px to punish late reactions`);
    }
  }

  // 4. Landing punisher - predict and punish landing (phase 4+)
  if (
    phase === 'predict' &&
    hostsApplied < maxHosts &&
    isTrapUnlocked('landingPunisher', knowledge) &&
    profile.commonLandingZones.length > 0
  ) {
    predictedLandingX = profile.commonLandingZones[0];
    const result = applyLandingPunisher(mutatedObstacles, predictedLandingX);
    if (result.applied) {
      hostsApplied++;
      activeTraps.push('landingPunisher');
      trapReasons.push(`Placed spike at predicted landing x=${Math.round(predictedLandingX)}px`);
    }
  }

  // 5. Collapsing platform - punish platform reliance (phase 4+)
  if (
    phase === 'predict' &&
    hostsApplied < maxHosts &&
    isTrapUnlocked('collapsingPlatform', knowledge)
  ) {
    const result = applyCollapsingPlatform(mutatedObstacles);
    if (result.applied) {
      hostsApplied++;
      activeTraps.push('collapsingPlatform');
      trapReasons.push('Marked platform as collapsing to punish platform reliance');
    }
  }

  // NEW: Choice-specific counter traps
  // If player consistently jumps through choices, add a low ceiling right after
  if (
    hostsApplied < maxHosts &&
    (phase === 'counter' || phase === 'predict') &&
    model.preferredChoiceAction === 'jump'
  ) {
    const result = applyCounterJumpChoice(mutatedObstacles, reactionSpacing, levelIndex);
    if (result.applied) {
      hostsApplied++;
      activeTraps.push('counterJumpChoice');
      trapReasons.push('Added low ceiling after choice gate to punish jump preference');
    }
  }

  // If player consistently crouches through choices, add a spike right after
  if (
    hostsApplied < maxHosts &&
    (phase === 'counter' || phase === 'predict') &&
    model.preferredChoiceAction === 'crouch'
  ) {
    const result = applyCounterCrouchChoice(mutatedObstacles, reactionSpacing, levelIndex);
    if (result.applied) {
      hostsApplied++;
      activeTraps.push('counterCrouchChoice');
      trapReasons.push('Added spike after choice gate to punish crouch preference');
    }
  }

  // 6. Chain mutation - apply two traps at once (phase 4+ only, level 5+)
  if (
    phase === 'predict' &&
    levelIndex >= 5 &&
    knowledge.overallConfidence > 0.75 &&
    hostsApplied < maxHosts
  ) {
    const chainResult = applyChainMutation(
      mutatedObstacles,
      knowledge,
      model,
      profile,
      levelIndex,
      reactionSpacing,
      hostsApplied,
      maxHosts,
    );
    if (chainResult.trapsApplied > 0) {
      activeTraps.push('chainMutation');
      trapReasons.push('Applied chained trap mutations');
      hostsApplied += chainResult.trapsApplied;
      if (chainResult.predictedLandingX !== undefined) {
        predictedLandingX = chainResult.predictedLandingX;
      }
    }
  }

  // Fairness check: ensure at least one valid path remains
  if (!verifyValidPathExists(mutatedObstacles)) {
    // Revert mutations if they made the level impossible
    return {
      obstacles,
      activeTraps: [],
      trapReasons: ['Traps would block all paths - reverted'],
      phase,
    };
  }

  return {
    obstacles: mutatedObstacles,
    activeTraps,
    trapReasons,
    phase,
    predictedLandingX,
  };
}

// Trap 1: Lower the clearance of an existing lowCeiling
function applyReactiveLowCeiling(
  obstacles: Obstacle[],
  levelIndex: number,
): { applied: boolean; amount: number } {
  const lowCeilings = obstacles.filter((o) => o.kind === 'lowCeiling' && !o.trapHost);
  if (lowCeilings.length === 0) return { applied: false, amount: 0 };

  // Pick the first available lowCeiling
  const target = lowCeilings[0];
  const reduction = 10; // pixels to reduce clearance by
  const newHeight = Math.max(24, target.height - reduction); // minimum 24px clearance
  const actualReduction = target.height - newHeight;

  target.height = newHeight;
  target.trapHost = true;
  target.trapType = 'reactiveLowCeiling';
  target.trapState = 'idle';
  target.trapReason = `Reduced clearance to punish jumping (level ${levelIndex})`;

  return { applied: true, amount: actualReduction };
}

// Trap 2: Add follow-up obstacle after choiceObstacle
function applyFakeChoiceObstacle(
  obstacles: Obstacle[],
  reactionSpacing: number,
  jumpBiased: boolean,
): { applied: boolean } {
  const choiceObstacles = obstacles.filter((o) => o.kind === 'choiceObstacle' && !o.trapHost);
  if (choiceObstacles.length === 0) return { applied: false };

  const choiceObs = choiceObstacles[0];
  const followUpX = choiceObs.x + choiceObs.width + reactionSpacing * 0.75;

  // If jump-biased, place a spike (jumpers hit it)
  // If crouch-biased, place a low ceiling (crouchers get stuck)
  const newObstacle: Obstacle = jumpBiased
    ? {
        kind: 'spike',
        x: followUpX,
        width: 44,
        height: 52,
        trapHost: true,
        trapType: 'fakeChoiceObstacle',
        trapState: 'idle',
        trapReason: 'Follow-up spike to punish jump choice',
      }
    : {
        kind: 'lowCeiling',
        x: followUpX,
        width: 100,
        height: 34,
        trapHost: true,
        trapType: 'fakeChoiceObstacle',
        trapState: 'idle',
        trapReason: 'Follow-up low ceiling to punish crouch choice',
      };

  obstacles.push(newObstacle);
  choiceObs.trapHost = true;
  choiceObs.trapType = 'fakeChoiceObstacle';
  choiceObs.trapState = 'idle';

  return { applied: true };
}

// Trap 3: Widen an existing gap
function applyShiftingGap(
  obstacles: Obstacle[],
  levelIndex: number,
): { applied: boolean; amount: number } {
  const gaps = obstacles.filter((o) => o.kind === 'gap' && !o.trapHost);
  if (gaps.length === 0) return { applied: false, amount: 0 };

  // Pick a gap that's not too wide already
  const maxJump = calculateMaxJumpDistance();
  const target = gaps.find((g) => g.width < maxJump * 0.85);
  if (!target) return { applied: false, amount: 0 };

  const minWiden = 30;
  const maxWiden = 50;
  const widenAmount = minWiden + Math.floor(Math.random() * (maxWiden - minWiden + 1));

  // Ensure we don't make it impossible
  const newWidth = Math.min(target.width + widenAmount, Math.floor(maxJump * 0.9));
  const actualWiden = newWidth - target.width;

  if (actualWiden <= 0) return { applied: false, amount: 0 };

  target.width = newWidth;
  target.trapHost = true;
  target.trapType = 'shiftingGap';
  target.trapState = 'idle';
  target.trapReason = `Widened gap to punish late reactions (level ${levelIndex})`;

  return { applied: true, amount: actualWiden };
}

// Trap 4: Place spike at predicted landing location
function applyLandingPunisher(
  obstacles: Obstacle[],
  predictedLandingX: number,
): { applied: boolean } {
  // Check if there's a safe zone at the predicted landing
  const safeZoneStart = predictedLandingX - 60;
  const safeZoneEnd = predictedLandingX + 60;

  // Check for existing obstacles in the zone
  const hasObstacle = obstacles.some(
    (o) =>
      o.kind !== 'gap' &&
      o.x < safeZoneEnd &&
      o.x + o.width > safeZoneStart,
  );

  if (hasObstacle) return { applied: false };

  // Place a spike in the middle of the predicted zone
  const spike: Obstacle = {
    kind: 'spike',
    x: predictedLandingX - 22, // center it
    width: 44,
    height: 52,
    trapHost: true,
    trapType: 'landingPunisher',
    trapState: 'idle',
    trapReason: `Spike placed at predicted landing x=${Math.round(predictedLandingX)}`,
  };

  obstacles.push(spike);
  return { applied: true };
}

// Trap 5: Mark a platform as collapsing
function applyCollapsingPlatform(obstacles: Obstacle[]): { applied: boolean } {
  const platforms = obstacles.filter(
    (o) => o.kind === 'platform' && !o.trapHost && !o.trapType,
  );
  if (platforms.length === 0) return { applied: false };

  // Pick a platform that's not at the very start or end
  const candidates = platforms.filter((p) => p.width >= 40);
  if (candidates.length === 0) return { applied: false };

  const target = candidates[Math.floor(candidates.length / 2)]; // middle one

  target.trapHost = true;
  target.trapType = 'collapsingPlatform';
  target.trapState = 'idle';
  target.trapReason = 'Platform will collapse when player lands on it';

  return { applied: true };
}

// Trap 6: Chain two traps together
function applyChainMutation(
  obstacles: Obstacle[],
  knowledge: AIKnowledge,
  _model: PlayerModel,
  profile: PlayerProfile,
  levelIndex: number,
  _reactionSpacing: number,
  currentHosts: number,
  maxHosts: number,
): { trapsApplied: number; predictedLandingX?: number } {
  let trapsApplied = 0;
  let predictedLandingX: number | undefined;

  // Try to apply two different traps
  if (currentHosts + trapsApplied < maxHosts && isTrapUnlocked('shiftingGap', knowledge)) {
    const result = applyShiftingGap(obstacles, levelIndex);
    if (result.applied) trapsApplied++;
  }

  if (
    currentHosts + trapsApplied < maxHosts &&
    isTrapUnlocked('landingPunisher', knowledge) &&
    profile.commonLandingZones.length > 0
  ) {
    predictedLandingX = profile.commonLandingZones[0];
    const result = applyLandingPunisher(obstacles, predictedLandingX);
    if (result.applied) trapsApplied++;
  }

  if (
    currentHosts + trapsApplied < maxHosts &&
    isTrapUnlocked('collapsingPlatform', knowledge)
  ) {
    const result = applyCollapsingPlatform(obstacles);
    if (result.applied) trapsApplied++;
  }

  return { trapsApplied, predictedLandingX };
}

// NEW: Counter-jump choice trap - add low ceiling right after a choice obstacle
function applyCounterJumpChoice(
  obstacles: Obstacle[],
  reactionSpacing: number,
  levelIndex: number,
): { applied: boolean } {
  const choiceObstacles = obstacles.filter(
    (o) => o.kind === 'choiceObstacle' && !o.trapHost,
  );
  if (choiceObstacles.length === 0) return { applied: false };

  const choiceObs = choiceObstacles[0];
  const ceilX = choiceObs.x + choiceObs.width + reactionSpacing * 0.5;

  // Place a low ceiling right after the choice - jumpers will hit it
  const newCeiling: Obstacle = {
    kind: 'lowCeiling',
    x: ceilX,
    width: clampInt(120 + levelIndex * 6, 100, 180),
    height: clampInt(30 + levelIndex, 28, 38),
    trapHost: true,
    trapType: 'counterJumpChoice',
    trapState: 'idle',
    trapReason: 'Low ceiling after choice gate to punish jump preference',
  };

  obstacles.push(newCeiling);
  choiceObs.trapHost = true;
  choiceObs.trapType = 'counterJumpChoice';

  return { applied: true };
}

// NEW: Counter-crouch choice trap - add spike right after a choice obstacle
function applyCounterCrouchChoice(
  obstacles: Obstacle[],
  reactionSpacing: number,
  _levelIndex: number,
): { applied: boolean } {
  const choiceObstacles = obstacles.filter(
    (o) => o.kind === 'choiceObstacle' && !o.trapHost,
  );
  if (choiceObstacles.length === 0) return { applied: false };

  // Pick a different choice obstacle than the jump counter would
  const choiceObs = choiceObstacles.length > 1 ? choiceObstacles[1] : choiceObstacles[0];
  const spikeX = choiceObs.x + choiceObs.width + reactionSpacing * 0.5;

  // Place a spike right after the choice - crouchers will hit it
  const newSpike: Obstacle = {
    kind: 'spike',
    x: spikeX,
    width: 44,
    height: 52,
    trapHost: true,
    trapType: 'counterCrouchChoice',
    trapState: 'idle',
    trapReason: 'Spike after choice gate to punish crouch preference',
  };

  obstacles.push(newSpike);
  choiceObs.trapHost = true;
  choiceObs.trapType = 'counterCrouchChoice';

  return { applied: true };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)));
}

// Fairness verification: ensure at least one valid path exists
function verifyValidPathExists(obstacles: Obstacle[]): boolean {
  const maxJump = calculateMaxJumpDistance();
  const gaps = obstacles.filter((o) => o.kind === 'gap');
  const platforms = obstacles.filter((o) => o.kind === 'platform');

  for (const gap of gaps) {
    // Skip gaps with platforms (they're crossable)
    const hasPlatforms = platforms.some(
      (p) => p.x >= gap.x && p.x + p.width <= gap.x + gap.width,
    );
    if (hasPlatforms) continue;

    // Check if gap is jumpable
    if (gap.width > maxJump * 0.9) {
      return false; // This gap would be impossible
    }
  }

  return true;
}

// Update collapsing platform state machine (called from game.ts)
export function updateCollapsingPlatform(
  platform: Obstacle,
  dt: number,
  playerOnPlatform: boolean,
): void {
  if (platform.trapType !== 'collapsingPlatform') return;

  switch (platform.trapState) {
    case 'idle':
      if (playerOnPlatform) {
        platform.trapState = 'armed';
        platform.trapTimer = 0;
      }
      break;
    case 'armed':
      platform.trapTimer = (platform.trapTimer || 0) + dt;
      if (platform.trapTimer >= 0.5) {
        platform.trapState = 'triggered';
      }
      break;
    case 'triggered':
      platform.trapTimer = (platform.trapTimer || 0) + dt;
      if (platform.trapTimer >= 0.8) {
        platform.trapState = 'spent';
      }
      break;
    case 'spent':
      // Platform is gone - handled by getEffectiveFloor
      break;
  }
}

// Check if player is standing on a specific platform
export function isPlayerOnPlatform(
  platform: Obstacle,
  playerX: number,
  playerY: number,
  playerWidth: number,
  playerHeight: number,
  groundY: number,
): boolean {
  const platformTop = groundY - platform.height;
  const playerBottom = playerY + playerHeight;

  // Check horizontal overlap
  const playerLeft = playerX;
  const playerRight = playerX + playerWidth;
  const platformLeft = platform.x;
  const platformRight = platform.x + platform.width;

  const horizontalOverlap = playerRight > platformLeft && playerLeft < platformRight;
  const verticalTouch = Math.abs(playerBottom - platformTop) < 5; // within 5px

  return horizontalOverlap && verticalTouch;
}
