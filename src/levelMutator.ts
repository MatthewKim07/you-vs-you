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
};

const SAFE_SPAWN_END = 320;

// Disappearing platform timing constants (ms)
export const DISAPPEAR_FLICKER_MS = 400;
export const DISAPPEAR_INVISIBLE_MS = 2000;
export const DISAPPEAR_REAPPEAR_MS = 400;

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

function computeDifficultyBudget(runs: RunData[], levelIndex: number): DifficultyBudget {
  const recentRuns = runs.slice(-6);
  const completions = recentRuns.filter(r => r.completed).length;
  const deaths = recentRuns.filter(r => !r.completed).length;

  // Don't mutate if player is struggling hard
  if (deaths >= 5 && completions === 0) {
    return { total: 0, spent: 0 };
  }

  // Base budget grows slightly with level, capped at 5 to avoid overwhelming
  const base = Math.min(2 + Math.floor(levelIndex * 0.5), 5);
  // Success adds budget, deaths reduce it
  const delta = completions * 2 - Math.floor(deaths * 0.5);
  const total = Math.max(0, Math.min(10, base + delta));

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

  // Back off if player is already struggling
  if (deathRate > 0.8 && recentRuns.length >= 3) {
    return [];
  }

  const preferredRoute: RouteLayer | null =
    model.preferredRoute === 'mixed' ? null : model.preferredRoute;

  // 1. Make platforms disappear on the player's preferred route (costs 2)
  if (model.routeConfidence > 0.35 && preferredRoute && levelIndex >= 2) {
    const routePlatforms = obstacles.filter(o =>
      o.kind === 'platform' &&
      o.disappearMode === undefined &&
      !o.trapHost &&
      o.routeLayer === preferredRoute,
    );
    // Target middle platforms — they're the most relied-upon stepping stones
    const midIdx = Math.floor(routePlatforms.length / 2);
    const targets = routePlatforms.slice(
      Math.max(0, midIdx - 1),
      Math.min(routePlatforms.length, midIdx + 1),
    );
    for (const p of targets) {
      candidates.push({
        id: `disappear_${Math.round(p.x)}`,
        type: 'MAKE_PLATFORM_DISAPPEAR',
        targetX: p.x,
        targetRouteLayer: preferredRoute,
        difficultyCost: MUTATION_COSTS.MAKE_PLATFORM_DISAPPEAR,
        reason: `${preferredRoute} route relied on (conf:${(model.routeConfidence * 100).toFixed(0)}%)`,
      });
    }
  }

  // 2. Place hazards at common landing zones (costs 1 each)
  const recentLandings = recentRuns.flatMap(r => r.landings).map(l => l.x);
  if (recentLandings.length >= 4) {
    const buckets = new Map<number, number>();
    for (const x of recentLandings) {
      const key = Math.floor(x / 80) * 80;
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
        reason: `Hot landing zone ~${Math.round(x)}px (${count} landings)`,
      });
    }
  }

  // 3. Add a spike on the preferred route (costs 1)
  if (preferredRoute && deathRate < 0.6) {
    const spikeX = findClearX(obstacles, 450, 1850, 90);
    if (spikeX !== null) {
      candidates.push({
        id: `route_spike_${Math.round(spikeX)}`,
        type: 'ADD_SPIKE',
        targetX: spikeX,
        targetRouteLayer: preferredRoute,
        difficultyCost: MUTATION_COSTS.ADD_SPIKE,
        reason: `Spike on ${preferredRoute} route (player committed)`,
      });
    }
  }

  // 4. Widen a gap if player clears levels easily (costs 2)
  const hasCompletions = recentRuns.some(r => r.completed);
  if (deathRate < 0.3 && hasCompletions && levelIndex >= 2) {
    const gapTargets = obstacles.filter(o => o.kind === 'gap' && !o.trapHost);
    if (gapTargets.length > 0) {
      const target = gapTargets[Math.floor(gapTargets.length / 2)];
      candidates.push({
        id: `widen_gap_${Math.round(target.x)}`,
        type: 'INCREASE_GAP',
        targetX: target.x,
        difficultyCost: MUTATION_COSTS.INCREASE_GAP,
        reason: `Death rate ${(deathRate * 100).toFixed(0)}%, widening gap`,
      });
    }
  }

  // Sort cheapest first to maximize use of budget
  return candidates.sort((a, b) => a.difficultyCost - b.difficultyCost);
}

function isMutationSafe(obstacles: Obstacle[], mutation: LevelMutationAction): boolean {
  const maxJump = calculateMaxJumpDistance();

  switch (mutation.type) {
    case 'ADD_SPIKE':
    case 'ADD_LANDING_HAZARD': {
      if (mutation.targetX < SAFE_SPAWN_END) return false;
      // No overlap with hazards or gap edges within 80px
      const tooClose = obstacles.some(o => {
        if (o.kind === 'gap') {
          const gx = o.currentX ?? o.x;
          const gw = o.currentWidth ?? o.width;
          return mutation.targetX + 44 > gx - 24 && mutation.targetX < gx + gw + 24;
        }
        const ox = o.currentX ?? o.x;
        return Math.abs(ox - mutation.targetX) < 80;
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
