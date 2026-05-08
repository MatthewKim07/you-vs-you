import {
  Obstacle,
  LevelMutationAction,
  LevelMutationActionType,
  DifficultyBudget,
  RouteLayer,
} from './types';
import { PlayerModel, RunData } from './telemetry';
import { calculateMaxJumpDistance } from './movementTuning';

const MUTATION_COSTS: Record<LevelMutationActionType, number> = {
  ADD_SPIKE: 1,
  ADD_LANDING_HAZARD: 1,
  MAKE_PLATFORM_DISAPPEAR: 2,
  INCREASE_GAP: 2,
  ADD_ROUTE_BLOCKER: 3,
  APPLY_RISING_SPIKE: 2,
  APPLY_PULSING_SPIKE: 2,
  APPLY_DROPPING_PLATFORM: 2,
  APPLY_TEMP_BLOCKER: 3,
  APPLY_PATROL_SPIKE: 2,
  ADD_ELECTRIC_FIELD: 3,
  ADD_CRUSHER_CEILING: 3,
  APPLY_CRUMBLE_PLATFORM: 2,
  ADD_WARNING_MARKER: 0,
};

const SAFE_SPAWN_END = 320;

// Disappearing platform timing constants (ms)
export const DISAPPEAR_FLICKER_MS = 400;
export const DISAPPEAR_INVISIBLE_MS = 2000;
export const DISAPPEAR_REAPPEAR_MS = 400;

// Rising spike cycle (ms)
export const RISING_INACTIVE_MS = 1200;
export const RISING_WARNING_MS  = 600;
export const RISING_RISE_MS     = 400;
export const RISING_HOLD_MS     = 1800;
export const RISING_RETRACT_MS  = 400;

// Pulsing spike cycle (ms)
export const PULSE_ACTIVE_MS    = 1200;
export const PULSE_RETRACT_MS   = 300;
export const PULSE_INACTIVE_MS  = 800;
export const PULSE_RISE_MS      = 300;

// Dropping platform (ms)
export const DROP_WARNING_MS    = 700;
export const DROP_FALL_MS       = 400;
export const DROP_INVISIBLE_MS  = 2000;
export const DROP_SPAWN_MS      = 500;

// Temporary blocker ceiling (ms)
export const BLOCKER_INACTIVE_MS = 2200;
export const BLOCKER_WARNING_MS  = 500;
export const BLOCKER_ACTIVE_MS   = 1800;
export const BLOCKER_RETRACT_MS  = 400;

// Patrolling hazard
export const PATROL_RANGE        = 80;   // px each direction from center
export const PATROL_SPEED_DEFAULT = 80;  // px/s

// Electric field cycle (ms)
export const ELECTRIC_INACTIVE_MS = 3000;
export const ELECTRIC_WARNING_MS  = 800;
export const ELECTRIC_ACTIVE_MS   = 1200;
// Electric field dimensions (px)
export const ELECTRIC_WIDTH       = 160;
export const ELECTRIC_HEIGHT      = 52;

// Crusher ceiling cycle (ms)
export const CRUSHER_RAISED_MS   = 2800;
export const CRUSHER_WARNING_MS  = 700;
export const CRUSHER_CRUSHING_MS = 400;
export const CRUSHER_LOWERED_MS  = 2000;
export const CRUSHER_RAISING_MS  = 400;
// Crusher ceiling geometry (px)
export const CRUSHER_RAISED_H    = 68;   // clearance when raised (player stands freely)
export const CRUSHER_LOWERED_H   = 32;   // clearance when crushed (must crouch; crouch height=30)
export const CRUSHER_WIDTH       = 200;

// Crumble platform (ms) — faster than droppingPlatform, distinct orange visual
export const CRUMBLE_WARNING_MS  = 300;
export const CRUMBLE_FALL_MS     = 250;
export const CRUMBLE_INVISIBLE_MS = 1500;
export const CRUMBLE_SPAWN_MS    = 400;

export interface MutatorOutput {
  obstacles: Obstacle[];
  budget: DifficultyBudget;
  appliedMutations: LevelMutationAction[];
  debugLines: string[];
}

export function mutateLevelObstacles(
  obstacles: Obstacle[],
  model: PlayerModel,
  runs: RunData[],
  levelIndex: number,
): MutatorOutput {
  if (levelIndex < 1) {
    return {
      obstacles,
      budget: { total: 0, spent: 0 },
      appliedMutations: [],
      debugLines: ['Level 1: observe only, no mutations'],
    };
  }

  const budget = computeDifficultyBudget(runs, levelIndex);
  if (budget.total === 0) {
    return {
      obstacles,
      budget,
      appliedMutations: [],
      debugLines: ['Budget: 0 — player struggling, no mutations added'],
    };
  }

  const mutated = obstacles.map(o => ({ ...o }));
  const applied: LevelMutationAction[] = [];
  const debugLines: string[] = [`Budget: ${budget.total} pts (level ${levelIndex})`];
  let spent = 0;

  const candidates = selectCandidateMutations(mutated, model, runs, levelIndex);

  for (const mutation of candidates) {
    if (spent + mutation.difficultyCost > budget.total) {
      debugLines.push(`Skip ${mutation.type}@${Math.round(mutation.targetX)}: over budget (${mutation.difficultyCost} > ${budget.total - spent} remaining)`);
      continue;
    }
    if (!isMutationSafe(mutated, mutation)) {
      debugLines.push(`Skip ${mutation.type}@${Math.round(mutation.targetX)}: safety check failed`);
      continue;
    }
    applyMutation(mutated, mutation);
    applied.push(mutation);
    spent += mutation.difficultyCost;
    debugLines.push(`Apply ${mutation.type}@${Math.round(mutation.targetX)}: ${mutation.reason}`);
  }

  if (applied.length === 0) {
    debugLines.push('No mutations applied this level');
  }

  return {
    obstacles: mutated,
    budget: { total: budget.total, spent },
    appliedMutations: applied,
    debugLines,
  };
}

// Reset disappearing platforms to visible state between runs on the same level.
export function resetDisappearingPlatforms(obstacles: Obstacle[]): void {
  for (const o of obstacles) {
    if (o.kind !== 'platform' || o.disappearMode === undefined) continue;
    o.disappearState = 'visible';
    o.disappearTimer = 0;
    // Preserve disappearCount across runs to track total uses
  }
}

// Reset all AI modifier state machines to their initial states for the next run.
export function resetAiModifiers(obstacles: Obstacle[]): void {
  for (const o of obstacles) {
    if (!o.aiModifier) continue;
    o.aiModTimer = 0;
    switch (o.aiModifier) {
      case 'risingSpike':
        o.aiModState = 'inactive';
        o.aiModVisualHeight = 0;
        break;
      case 'pulsingSpike':
        o.aiModState = 'active';
        o.aiModVisualHeight = o.height;
        break;
      case 'droppingPlatform':
        o.aiModState = 'inactive';
        o.aiModDropOffset = 0;
        break;
      case 'temporaryBlocker':
        o.aiModState = 'inactive';
        break;
      case 'patrollingHazard':
        o.currentX = o.x;
        o.patrolDir = 1;
        break;
      case 'crumblePlatform':
        o.aiModState = 'inactive';
        o.aiModDropOffset = 0;
        break;
    }
  }
}

// Reset electricField and crusherCeiling obstacle kinds to initial state for next run.
export function resetNewHazardKinds(obstacles: Obstacle[]): void {
  for (const o of obstacles) {
    if (o.kind === 'electricField') {
      o.aiModState = 'inactive';
      o.aiModTimer = 0;
    } else if (o.kind === 'crusherCeiling') {
      o.aiModState = 'inactive';
      o.aiModTimer = 0;
      o.aiModVisualHeight = o.height;
    }
  }
}

function computeDifficultyBudget(runs: RunData[], levelIndex: number): DifficultyBudget {
  const recentRuns = runs.slice(-6);
  const completions = recentRuns.filter(r => r.completed).length;
  const deaths = recentRuns.filter(r => !r.completed).length;

  // Don't mutate if player is struggling hard
  if (deaths >= 5 && completions === 0) {
    return { total: 0, spent: 0 };
  }

  // Budget grows slowly; cap at 6 to prevent dumping many mutations at once
  const base = Math.min(1 + Math.floor(levelIndex * 0.4), 4);
  // Success adds budget, deaths reduce it (less aggressive growth)
  const delta = completions * 1 - Math.floor(deaths * 0.7);
  const total = Math.max(0, Math.min(6, base + delta));

  return { total, spent: 0 };
}

function selectCandidateMutations(
  obstacles: Obstacle[],
  model: PlayerModel,
  runs: RunData[],
  levelIndex: number,
): LevelMutationAction[] {
  const candidates: LevelMutationAction[] = [];
  const recentRuns = runs.slice(-5);
  const deathRate = recentRuns.length > 0
    ? recentRuns.filter(r => !r.completed).length / recentRuns.length
    : 0;

  if (deathRate > 0.8 && recentRuns.length >= 3) return [];

  const interactionStats = model.perObstacleInteractionStats;
  const hasStats = Object.keys(interactionStats).length > 0;

  // 1. MAKE_PLATFORM_DISAPPEAR — target platforms the player actually relies on.
  //    Use per-obstacle interaction data: high passCount + low failureRate = player depends on it.
  //    Fall back to preferred-route middle-pick only if no interaction data exists.
  if (levelIndex >= 2) {
    const preferredRoute: RouteLayer | null =
      model.preferredRoute === 'mixed' ? null : model.preferredRoute;

    if (hasStats) {
      // Find platforms player has actually passed 2+ times with low death rate
      const reliablePlatforms = obstacles
        .filter(o =>
          o.kind === 'platform' &&
          o.disappearMode === undefined &&
          !o.trapHost,
        )
        .map(o => {
          const id = `platform_${Math.round(o.x)}_${Math.round(o.width)}`;
          const stats = interactionStats[id];
          return { obs: o, stats };
        })
        .filter(({ stats }) => stats && stats.passCount >= 2 && stats.failureRate < 0.4)
        .sort((a, b) => (b.stats?.passCount ?? 0) - (a.stats?.passCount ?? 0));

      for (const { obs, stats } of reliablePlatforms.slice(0, 2)) {
        candidates.push({
          id: `disappear_${Math.round(obs.x)}`,
          type: 'MAKE_PLATFORM_DISAPPEAR',
          targetX: obs.x,
          targetRouteLayer: obs.routeLayer as RouteLayer | undefined,
          difficultyCost: MUTATION_COSTS.MAKE_PLATFORM_DISAPPEAR,
          reason: `Platform at x=${Math.round(obs.x)} passed ${stats!.passCount}x, fail ${(stats!.failureRate * 100).toFixed(0)}% — player relies on it`,
        });
      }
    } else if (model.routeConfidence > 0.35 && preferredRoute) {
      // No interaction data yet — fall back to route-based structural pick
      const routePlatforms = obstacles.filter(o =>
        o.kind === 'platform' &&
        o.disappearMode === undefined &&
        !o.trapHost &&
        o.routeLayer === preferredRoute,
      );
      const midIdx = Math.floor(routePlatforms.length / 2);
      for (const p of routePlatforms.slice(Math.max(0, midIdx - 1), Math.min(routePlatforms.length, midIdx + 1))) {
        candidates.push({
          id: `disappear_${Math.round(p.x)}`,
          type: 'MAKE_PLATFORM_DISAPPEAR',
          targetX: p.x,
          targetRouteLayer: preferredRoute,
          difficultyCost: MUTATION_COSTS.MAKE_PLATFORM_DISAPPEAR,
          reason: `${preferredRoute} route structural pick (no interaction data yet)`,
        });
      }
    }
  }

  // 2. ADD_LANDING_HAZARD — use confirmed ground landings (y near groundY) from hot zones.
  //    Weight by actual landing count so spike lands exactly where player repeatedly touches down.
  const recentLandings = recentRuns.flatMap(r => r.landings);
  if (recentLandings.length >= 4) {
    const buckets = new Map<number, number>();
    for (const l of recentLandings) {
      const key = Math.floor(l.x / 80) * 80;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const hotZones = [...buckets.entries()]
      .filter(([x]) => x >= SAFE_SPAWN_END + 80)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
    for (const [x, count] of hotZones) {
      candidates.push({
        id: `landing_hazard_${Math.round(x)}`,
        type: 'ADD_LANDING_HAZARD',
        targetX: x + 8,
        difficultyCost: MUTATION_COSTS.ADD_LANDING_HAZARD,
        reason: `Hot landing zone x≈${Math.round(x)} (${count} landings across ${recentRuns.length} runs)`,
      });
    }
  }

  // 3. ADD_SPIKE — place at approach position of an obstacle player CONSISTENTLY passes.
  //    Use avgApproachX from interaction stats: player jumps from this exact spot each time.
  //    Prefer obstacles with consistent jump action + high pass rate — that's a learned pattern.
  if (deathRate < 0.6) {
    const preferredRoute: RouteLayer | null =
      model.preferredRoute === 'mixed' ? null : model.preferredRoute;

    if (hasStats) {
      // Find the obstacle where player has the most consistent jump pattern and highest pass rate
      const jumpPatternObstacle = Object.values(interactionStats)
        .filter(s =>
          s.total >= 2 &&
          s.preferredAction === 'jump' &&
          s.failureRate < 0.4 &&
          s.avgApproachX >= SAFE_SPAWN_END + 80 &&
          // Only obstacles the player approaches predictably (tight approach cluster)
          s.confidence >= 0.5,
        )
        .sort((a, b) => b.passCount - a.passCount)[0];

      if (jumpPatternObstacle) {
        // Place spike at their avg approach x — exactly where they launch from
        const spikeX = findClearX(obstacles, jumpPatternObstacle.avgApproachX - 40, jumpPatternObstacle.avgApproachX + 40, 90)
          ?? findClearX(obstacles, SAFE_SPAWN_END + 80, 1850, 90);
        if (spikeX !== null) {
          candidates.push({
            id: `approach_spike_${Math.round(spikeX)}`,
            type: 'ADD_SPIKE',
            targetX: spikeX,
            targetRouteLayer: preferredRoute ?? undefined,
            difficultyCost: MUTATION_COSTS.ADD_SPIKE,
            reason: `Spike at player's jump-off x≈${Math.round(jumpPatternObstacle.avgApproachX)} (passes ${jumpPatternObstacle.obstacleId} ${jumpPatternObstacle.passCount}x by jumping)`,
          });
        }
      }
    } else if (preferredRoute) {
      // No interaction data — place on preferred route at any clear position
      const spikeX = findClearX(obstacles, SAFE_SPAWN_END + 80, 1850, 90);
      if (spikeX !== null) {
        candidates.push({
          id: `route_spike_${Math.round(spikeX)}`,
          type: 'ADD_SPIKE',
          targetX: spikeX,
          targetRouteLayer: preferredRoute,
          difficultyCost: MUTATION_COSTS.ADD_SPIKE,
          reason: `Spike on ${preferredRoute} route (no approach data yet)`,
        });
      }
    }
  }

  // 4. INCREASE_GAP — target the gap player crosses most easily (lowest failure rate in stats).
  //    If no stats, fall back to the gap with the lowest current width (easiest to cross).
  const hasCompletions = recentRuns.some(r => r.completed);
  if (deathRate < 0.3 && hasCompletions && levelIndex >= 2) {
    const gapObstacles = obstacles.filter(o => o.kind === 'gap' && !o.trapHost);
    if (gapObstacles.length > 0) {
      let targetGap: Obstacle | undefined;

      if (hasStats) {
        // Find gap player crosses with lowest failure rate = easiest for them
        const gapWithStats = gapObstacles
          .map(o => {
            const id = `gap_${Math.round(o.x)}_${Math.round(o.width)}`;
            return { obs: o, stats: interactionStats[id] };
          })
          .filter(({ stats }) => stats && stats.total >= 2)
          .sort((a, b) => (a.stats?.failureRate ?? 1) - (b.stats?.failureRate ?? 1));

        targetGap = gapWithStats[0]?.obs ?? gapObstacles[Math.floor(gapObstacles.length / 2)];
      } else {
        targetGap = gapObstacles[Math.floor(gapObstacles.length / 2)];
      }

      if (targetGap) {
        const statsEntry = interactionStats[`gap_${Math.round(targetGap.x)}_${Math.round(targetGap.width)}`];
        candidates.push({
          id: `widen_gap_${Math.round(targetGap.x)}`,
          type: 'INCREASE_GAP',
          targetX: targetGap.x,
          difficultyCost: MUTATION_COSTS.INCREASE_GAP,
          reason: statsEntry
            ? `Easiest gap (x=${Math.round(targetGap.x)}, fail ${(statsEntry.failureRate * 100).toFixed(0)}%/${statsEntry.total} runs) — widening`
            : `Gap at x=${Math.round(targetGap.x)} widened (death rate ${(deathRate * 100).toFixed(0)}%)`,
        });
      }
    }
  }

  // 5. APPLY_RISING_SPIKE — turn a static spike into a rising spike where player predictably jumps.
  //    Trigger: spike exists on player's preferred route, player has passed it (not died).
  if (levelIndex >= 3 && deathRate < 0.7) {
    const unmodifiedSpikes = obstacles.filter(o =>
      (o.kind === 'spike' || o.kind === 'doubleSpike') &&
      !o.aiModifier &&
      (o.currentX ?? o.x) >= SAFE_SPAWN_END + 80,
    );
    // Prefer spikes the player has passed before (interaction data) — those are "solved" patterns
    const targetSpike = hasStats
      ? unmodifiedSpikes.find(o => {
          const id = `${o.kind}_${Math.round(o.x)}_${Math.round(o.width)}`;
          const s = interactionStats[id];
          return s && s.passCount >= 2 && s.preferredAction === 'jump' && s.failureRate < 0.5;
        }) ?? unmodifiedSpikes[0]
      : unmodifiedSpikes[0];

    if (targetSpike) {
      candidates.push({
        id: `rising_spike_${Math.round(targetSpike.x)}`,
        type: 'APPLY_RISING_SPIKE',
        targetX: targetSpike.x,
        targetRouteLayer: targetSpike.routeLayer as RouteLayer | undefined,
        difficultyCost: MUTATION_COSTS.APPLY_RISING_SPIKE,
        reason: `Static spike at x=${Math.round(targetSpike.x)} solved by player — now rises on cycle`,
      });
    }
  }

  // 6. APPLY_PULSING_SPIKE — turn a static spike into a pulsing spike with safe windows.
  //    Trigger: player frequently jumps but hasn't died at this spike (too easy for them).
  if (levelIndex >= 4 && deathRate < 0.5 && hasCompletions) {
    const unmodifiedSpikes = obstacles.filter(o =>
      (o.kind === 'spike' || o.kind === 'doubleSpike') &&
      !o.aiModifier &&
      (o.currentX ?? o.x) >= SAFE_SPAWN_END + 80,
    );
    // Pick a different spike than rising spike (furthest from spawn to add end-game pressure)
    const targetSpike = unmodifiedSpikes.slice(-1)[0];
    if (targetSpike) {
      candidates.push({
        id: `pulsing_spike_${Math.round(targetSpike.x)}`,
        type: 'APPLY_PULSING_SPIKE',
        targetX: targetSpike.x,
        targetRouteLayer: targetSpike.routeLayer as RouteLayer | undefined,
        difficultyCost: MUTATION_COSTS.APPLY_PULSING_SPIKE,
        reason: `Level ${levelIndex} pressure: spike at x=${Math.round(targetSpike.x)} now pulses`,
      });
    }
  }

  // 7. APPLY_DROPPING_PLATFORM — mark a platform the player relies on as dropping.
  //    Trigger: player uses upper route heavily.
  if (levelIndex >= 3 && model.routeUsage) {
    const total = (model.routeUsage.upper ?? 0) + (model.routeUsage.mid ?? 0) + (model.routeUsage.lower ?? 0);
    const upperRatio = total > 0 ? (model.routeUsage.upper ?? 0) / total : 0;
    if (upperRatio > 0.45 || model.preferredRoute === 'upper') {
      const upperPlatforms = obstacles.filter(o =>
        o.kind === 'platform' &&
        !o.aiModifier &&
        !o.disappearMode &&
        !o.trapHost &&
        o.routeLayer === 'upper',
      );
      if (upperPlatforms.length >= 2) {
        // Target a non-first, non-last platform so player can still make it
        const targetIdx = Math.max(1, Math.floor(upperPlatforms.length / 2));
        const target = upperPlatforms[targetIdx];
        candidates.push({
          id: `dropping_platform_${Math.round(target.x)}`,
          type: 'APPLY_DROPPING_PLATFORM',
          targetX: target.x,
          targetRouteLayer: 'upper',
          difficultyCost: MUTATION_COSTS.APPLY_DROPPING_PLATFORM,
          reason: `Upper route usage ${(upperRatio * 100).toFixed(0)}% — platform at x=${Math.round(target.x)} now drops`,
        });
      }
    }
  }

  // 8. APPLY_TEMP_BLOCKER — make a platform temporarily invisible on a cycle.
  //    Targets a platform the player regularly jumps on (lower or mid route).
  //    Trigger: player uses mid/lower route heavily and has reliable platform passes.
  if (levelIndex >= 5) {
    const total = (model.routeUsage?.upper ?? 0) + (model.routeUsage?.mid ?? 0) + (model.routeUsage?.lower ?? 0);
    const nonUpperRatio = total > 0 ? ((model.routeUsage?.mid ?? 0) + (model.routeUsage?.lower ?? 0)) / total : 0;
    if (nonUpperRatio > 0.5 || model.preferredRoute === 'mid' || model.preferredRoute === 'lower') {
      const candidatePlatforms = obstacles.filter(o =>
        o.kind === 'platform' &&
        !o.aiModifier &&
        o.disappearMode === undefined &&
        !o.trapHost &&
        (o.routeLayer === 'mid' || o.routeLayer === 'lower') &&
        (o.currentX ?? o.x) >= SAFE_SPAWN_END + 80,
      );
      if (candidatePlatforms.length > 0) {
        // Prefer a platform the player has passed multiple times
        const target = hasStats
          ? candidatePlatforms.find(o => {
              const id = `platform_${Math.round(o.x)}_${Math.round(o.width)}`;
              const s = interactionStats[id];
              return s && s.passCount >= 2 && s.failureRate < 0.4;
            }) ?? candidatePlatforms[Math.floor(candidatePlatforms.length / 2)]
          : candidatePlatforms[Math.floor(candidatePlatforms.length / 2)];
        if (target) {
          candidates.push({
            id: `temp_blocker_${Math.round(target.x)}`,
            type: 'APPLY_TEMP_BLOCKER',
            targetX: target.x,
            targetRouteLayer: target.routeLayer as RouteLayer | undefined,
            difficultyCost: MUTATION_COSTS.APPLY_TEMP_BLOCKER,
            reason: `${target.routeLayer ?? 'mid'} route platform at x=${Math.round(target.x)} now cycles invisible`,
          });
        }
      }
    }
  }

  return candidates.sort((a, b) => a.difficultyCost - b.difficultyCost);
}

function isMutationSafe(obstacles: Obstacle[], mutation: LevelMutationAction): boolean {
  const maxJump = calculateMaxJumpDistance();

  switch (mutation.type) {
    case 'ADD_SPIKE':
    case 'ADD_LANDING_HAZARD': {
      if (mutation.targetX < SAFE_SPAWN_END) return false;
      // Minimum edge-to-edge gap: 2.5× player width (32px), giving comfortable run-up room.
      const MIN_CLEARANCE = 80;
      const newLeft  = mutation.targetX;
      const newRight = mutation.targetX + 44;
      const tooClose = obstacles.some(o => {
        if (o.kind === 'gap') {
          const gx = o.currentX ?? o.x;
          const gw = o.currentWidth ?? o.width;
          return newRight + 24 > gx && newLeft < gx + gw + 24;
        }
        const ox  = o.currentX ?? o.x;
        const ow  = o.currentWidth ?? o.width;
        const obsRight = ox + ow;
        // too close if gaps on either side are smaller than MIN_CLEARANCE, or they overlap
        const gapIfObsLeft  = newLeft  - obsRight;   // + if obs is to left of spike
        const gapIfObsRight = ox       - newRight;   // + if obs is to right of spike
        if (gapIfObsLeft  >= 0) return gapIfObsLeft  < MIN_CLEARANCE;
        if (gapIfObsRight >= 0) return gapIfObsRight < MIN_CLEARANCE;
        return true; // overlap
      });
      return !tooClose;
    }

    case 'MAKE_PLATFORM_DISAPPEAR': {
      const target = obstacles.find(o =>
        o.kind === 'platform' && Math.abs(o.x - mutation.targetX) < 5,
      );
      if (!target) return false;
      // At least one non-disappear platform must remain reachable as fallback
      const alternates = obstacles.filter(o =>
        o.kind === 'platform' &&
        o !== target &&
        o.disappearMode === undefined &&
        !o.trapHost &&
        Math.abs(o.x - target.x) < maxJump * 0.88,
      );
      return alternates.length >= 1;
    }

    case 'INCREASE_GAP': {
      const target = obstacles.find(o =>
        o.kind === 'gap' && Math.abs(o.x - mutation.targetX) < 5,
      );
      if (!target) return false;
      const currentWidth = target.currentWidth ?? target.width;
      // New width must stay within safe jump reach
      return currentWidth + 20 <= maxJump * 0.84;
    }

    case 'ADD_ROUTE_BLOCKER': {
      if (mutation.targetX < SAFE_SPAWN_END) return false;
      const nearby = obstacles.some(o =>
        (o.kind === 'lowCeiling' || o.kind === 'choiceObstacle') &&
        Math.abs((o.currentX ?? o.x) - mutation.targetX) < 148,
      );
      return !nearby;
    }

    case 'APPLY_RISING_SPIKE':
    case 'APPLY_PULSING_SPIKE': {
      // Spike must exist and not already have a modifier
      const target = obstacles.find(o =>
        (o.kind === 'spike' || o.kind === 'doubleSpike') &&
        Math.abs(o.x - mutation.targetX) < 5 &&
        !o.aiModifier,
      );
      return !!target && (target.currentX ?? target.x) >= SAFE_SPAWN_END;
    }

    case 'APPLY_DROPPING_PLATFORM': {
      const target = obstacles.find(o =>
        o.kind === 'platform' && Math.abs(o.x - mutation.targetX) < 5 && !o.aiModifier,
      );
      if (!target) return false;
      // Must have at least one alternate stable platform nearby
      const alternates = obstacles.filter(o =>
        o.kind === 'platform' &&
        o !== target &&
        !o.aiModifier &&
        o.disappearMode === undefined &&
        Math.abs(o.x - target.x) < maxJump * 0.88,
      );
      return alternates.length >= 1;
    }

    case 'APPLY_TEMP_BLOCKER': {
      const target = obstacles.find(o =>
        o.kind === 'platform' && Math.abs(o.x - mutation.targetX) < 5 && !o.aiModifier,
      );
      if (!target) return false;
      // Must have an alternate platform nearby so player has a fallback when this one is invisible
      const alternates = obstacles.filter(o =>
        o.kind === 'platform' &&
        o !== target &&
        !o.aiModifier &&
        o.disappearMode === undefined &&
        Math.abs(o.x - target.x) < maxJump * 0.88,
      );
      return alternates.length >= 1 && (target.currentX ?? target.x) >= SAFE_SPAWN_END;
    }

    default:
      return false;
  }
}

function applyMutation(obstacles: Obstacle[], mutation: LevelMutationAction): void {
  switch (mutation.type) {
    case 'ADD_SPIKE': {
      obstacles.push({
        kind: 'spike',
        x: mutation.targetX,
        width: 44,
        height: 52,
        routeLayer: mutation.targetRouteLayer,
        routeId: mutation.targetRouteLayer ? `mutated_${mutation.targetRouteLayer}` : undefined,
        triggeredByAI: true,
      });
      break;
    }

    case 'ADD_LANDING_HAZARD': {
      obstacles.push({
        kind: 'spike',
        x: mutation.targetX,
        width: 44,
        height: 36,
        triggeredByAI: true,
      });
      break;
    }

    case 'MAKE_PLATFORM_DISAPPEAR': {
      const target = obstacles.find(o =>
        o.kind === 'platform' && Math.abs(o.x - mutation.targetX) < 5,
      );
      if (target) {
        target.disappearMode = 'onTouch';
        target.disappearDelayMs = DISAPPEAR_FLICKER_MS;
        target.reappearDelayMs = DISAPPEAR_INVISIBLE_MS;
        target.maxDisappearCount = null;
        target.disappearState = 'visible';
        target.disappearTimer = 0;
        target.disappearCount = 0;
        target.triggeredByAI = true;
      }
      break;
    }

    case 'INCREASE_GAP': {
      const target = obstacles.find(o =>
        o.kind === 'gap' && Math.abs(o.x - mutation.targetX) < 5,
      );
      if (target) {
        const maxJump = calculateMaxJumpDistance();
        const newWidth = Math.min(
          (target.currentWidth ?? target.width) + 20,
          Math.floor(maxJump * 0.84),
        );
        target.width = newWidth;
        target.currentWidth = newWidth;
        target.targetWidth = newWidth;
        target.triggeredByAI = true;
      }
      break;
    }

    case 'ADD_ROUTE_BLOCKER': {
      obstacles.push({
        kind: 'doubleSpike',
        x: mutation.targetX,
        width: 104,
        height: 52,
        routeLayer: mutation.targetRouteLayer,
        routeId: mutation.targetRouteLayer ? `blocker_${mutation.targetRouteLayer}` : undefined,
        triggeredByAI: true,
      });
      break;
    }

    case 'APPLY_RISING_SPIKE': {
      const target = obstacles.find(o =>
        (o.kind === 'spike' || o.kind === 'doubleSpike') && Math.abs(o.x - mutation.targetX) < 5,
      );
      if (target) {
        target.aiModifier = 'risingSpike';
        target.aiModState = 'inactive';
        target.aiModTimer = 0;
        target.aiModVisualHeight = 0;
        target.triggeredByAI = true;
      }
      break;
    }

    case 'APPLY_PULSING_SPIKE': {
      const target = obstacles.find(o =>
        (o.kind === 'spike' || o.kind === 'doubleSpike') && Math.abs(o.x - mutation.targetX) < 5,
      );
      if (target) {
        target.aiModifier = 'pulsingSpike';
        target.aiModState = 'active';
        target.aiModTimer = 0;
        target.aiModVisualHeight = target.height;
        target.triggeredByAI = true;
      }
      break;
    }

    case 'APPLY_DROPPING_PLATFORM': {
      const target = obstacles.find(o =>
        o.kind === 'platform' && Math.abs(o.x - mutation.targetX) < 5,
      );
      if (target) {
        target.aiModifier = 'droppingPlatform';
        target.aiModState = 'inactive';
        target.aiModTimer = 0;
        target.aiModDropOffset = 0;
        target.triggeredByAI = true;
      }
      break;
    }

    case 'APPLY_TEMP_BLOCKER': {
      const target = obstacles.find(o =>
        o.kind === 'platform' && Math.abs(o.x - mutation.targetX) < 5,
      );
      if (target) {
        target.aiModifier = 'temporaryBlocker';
        target.aiModState = 'inactive';
        target.aiModTimer = 0;
        target.triggeredByAI = true;
      }
      break;
    }
  }
}

// Scan for a clear x position with no obstacles within clearRadius.
function findClearX(
  obstacles: Obstacle[],
  minX: number,
  maxX: number,
  clearRadius: number,
): number | null {
  const step = 100;
  for (let x = minX; x <= maxX; x += step) {
    const blocked = obstacles.some(o => {
      if (o.kind === 'gap') {
        const gx = o.currentX ?? o.x;
        const gw = o.currentWidth ?? o.width;
        return x + 44 > gx && x < gx + gw;
      }
      return Math.abs((o.currentX ?? o.x) - x) < clearRadius;
    });
    if (!blocked) return x;
  }
  return null;
}
