import { LevelData } from './level';
import { Obstacle, ObstacleKind } from './types';
import { PlayerModel, PlayerProfile, RunData } from './telemetry';

const GROUND_TOP = 0;
const SAFE_SPAWN_END = 320;
const SAFE_FLAG_GAP = 240;

const SPIKE_W = 44;
const SPIKE_H = 52;
const GAP_MIN_W = 108;
const GAP_MAX_W = 145;
const LOW_CEILING_MIN_W = 150;
const LOW_CEILING_MAX_W = 220;
const LOW_CEILING_CLEARANCE = 34;

const MAX_OBSTACLES = 7;

type Strategy =
  | 'punishJumpBias'
  | 'punishCrouchBias'
  | 'punishPredictability'
  | 'punishLateReactions'
  | 'balancedEscalation';

interface GenerationContext {
  pathStart: number;
  pathEnd: number;
  worldWidth: number;
  flagX: number;
  sourceRuns: RunData[];
  latestRun?: RunData;
  latestSuccess?: RunData;
  latestDeath?: RunData;
}

interface Signal {
  x: number;
  source: 'landing' | 'death' | 'profile';
}

export function generateAdaptiveLevel(
  previousRuns: RunData[],
  profile: PlayerProfile,
  playerModel: PlayerModel,
  levelIndex: number,
  canvasWidth: number,
): LevelData {
  const worldWidth = clamp(Math.round(canvasWidth * 2.5), 1900, 3000);
  const flagX = worldWidth - 280;
  const pathStart = SAFE_SPAWN_END;
  const pathEnd = flagX - SAFE_FLAG_GAP;

  const sourceLevel = Math.max(0, levelIndex - 1);
  const sourceRuns = previousRuns.filter((r) => r.levelIndex === sourceLevel);
  const latestRun = sourceRuns[sourceRuns.length - 1];
  const latestSuccess = [...sourceRuns].reverse().find((r) => r.completed);
  const latestDeath = [...sourceRuns].reverse().find((r) => !r.completed && r.deathX !== undefined);

  const ctx: GenerationContext = {
    pathStart,
    pathEnd,
    worldWidth,
    flagX,
    sourceRuns,
    latestRun,
    latestSuccess,
    latestDeath,
  };

  const strategy = selectStrategy(playerModel);
  const targetCount = obstacleCountForLevel(levelIndex);

  const notes: string[] = [];
  notes.push(`Strategy: ${strategy}`);

  const carried = carryForwardObstacles(ctx, levelIndex);
  if (carried.length > 0) {
    notes.push(`Carried ${carried.length} obstacle(s) from previous level`);
  }

  const newCount = clampInt(targetCount - carried.length, 1, targetCount);
  const kindPattern = buildPatternKinds(strategy, playerModel, newCount, levelIndex);

  const signals = collectSignals(ctx, profile);
  const created = placeCounterObstacles(kindPattern, carried, signals, strategy, playerModel, levelIndex, ctx, notes);

  const obstacles = [...carried, ...created]
    .sort((a, b) => a.x - b.x)
    .slice(0, MAX_OBSTACLES);

  const markerSource = latestSuccess ?? latestRun;
  const landingMarkers = (markerSource?.landings ?? [])
    .map((l) => clamp(Math.round(l.x), pathStart, pathEnd))
    .filter((x, i, arr) => arr.indexOf(x) === i)
    .slice(-8);

  notes.push(`Generated ${obstacles.length} obstacle(s)`);

  return {
    index: levelIndex,
    worldWidth,
    groundY: GROUND_TOP,
    flagX,
    obstacles,
    aiLandingMarkersX: landingMarkers,
    aiDebug: {
      notes,
      placementXs: obstacles.map((o) => Math.round(o.x)),
      obstacleCount: obstacles.length,
    },
  };
}

function selectStrategy(model: PlayerModel): Strategy {
  if (model.jumpFrequency - model.crouchFrequency > 0.2) return 'punishJumpBias';
  if (model.crouchFrequency - model.jumpFrequency > 0.2) return 'punishCrouchBias';
  if (model.consistency === 'predictable') return 'punishPredictability';
  if (model.reactionTiming === 'late') return 'punishLateReactions';
  return 'balancedEscalation';
}

function carryForwardObstacles(ctx: GenerationContext, levelIndex: number): Obstacle[] {
  const snapshot = ctx.latestRun?.obstaclesSnapshot;
  if (!snapshot || snapshot.length === 0) return [];

  const carryTarget = carryCountForLevel(levelIndex);
  const sorted = [...snapshot].sort((a, b) => a.x - b.x);
  const picked = sorted.slice(0, carryTarget);

  const carried: Obstacle[] = [];
  for (const obs of picked) {
    const normalized = normalizeObstacle(obs, levelIndex);
    const shiftedX = clamp(
      Math.round(normalized.x + randomSigned(18, 40)),
      ctx.pathStart,
      ctx.pathEnd - normalized.width,
    );
    carried.push({ ...normalized, x: shiftedX });
  }

  // ensure carried obstacles are safe among themselves
  return enforceSafety(carried, levelIndex, ctx.pathEnd);
}

function buildPatternKinds(
  strategy: Strategy,
  model: PlayerModel,
  count: number,
  levelIndex: number,
): ObstacleKind[] {
  const kinds: ObstacleKind[] = [];

  const pushSeq = (seq: ObstacleKind[]) => {
    for (const k of seq) {
      if (kinds.length >= count) return;
      kinds.push(k);
    }
  };

  while (kinds.length < count) {
    if (strategy === 'punishJumpBias') {
      pushSeq(jumpThenCrouch(levelIndex));
    } else if (strategy === 'punishCrouchBias') {
      pushSeq(crouchThenJump(levelIndex));
    } else if (strategy === 'punishPredictability') {
      pushSeq(baitPattern(model));
    } else if (strategy === 'punishLateReactions') {
      pushSeq(pressureSequence(levelIndex));
    } else {
      pushSeq(balancedEscalationPattern(levelIndex));
    }
  }

  return kinds.slice(0, count);
}

function jumpThenCrouch(levelIndex: number): ObstacleKind[] {
  return [levelIndex % 2 === 0 ? 'gap' : 'spike', 'lowCeiling'];
}

function crouchThenJump(levelIndex: number): ObstacleKind[] {
  return ['lowCeiling', levelIndex % 2 === 0 ? 'spike' : 'gap'];
}

function baitPattern(model: PlayerModel): ObstacleKind[] {
  const familiar: ObstacleKind = model.prefersJump ? 'spike' : 'lowCeiling';
  const breaker: ObstacleKind = familiar === 'lowCeiling' ? 'gap' : 'lowCeiling';
  return [familiar, familiar, breaker];
}

function pressureSequence(levelIndex: number): ObstacleKind[] {
  if (levelIndex > 5) {
    return ['spike', 'lowCeiling', 'gap'];
  }
  return ['spike', 'gap'];
}

function balancedEscalationPattern(levelIndex: number): ObstacleKind[] {
  if (levelIndex > 5) {
    return ['spike', 'lowCeiling', 'gap'];
  }
  return ['spike', 'lowCeiling'];
}

function collectSignals(ctx: GenerationContext, profile: PlayerProfile): Signal[] {
  const out: Signal[] = [];

  for (const l of ctx.latestSuccess?.landings.slice(-4) ?? []) {
    out.push({ x: clamp(Math.round(l.x + 72), ctx.pathStart, ctx.pathEnd), source: 'landing' });
  }

  if (ctx.latestDeath?.deathX !== undefined) {
    out.push({
      x: clamp(Math.round(ctx.latestDeath.deathX + 34), ctx.pathStart, ctx.pathEnd),
      source: 'death',
    });
  }

  for (const zone of profile.commonLandingZones.slice(0, 3)) {
    out.push({ x: clamp(Math.round(zone + 58), ctx.pathStart, ctx.pathEnd), source: 'profile' });
  }

  return out;
}

function placeCounterObstacles(
  kinds: ObstacleKind[],
  carried: Obstacle[],
  signals: Signal[],
  strategy: Strategy,
  model: PlayerModel,
  levelIndex: number,
  ctx: GenerationContext,
  notes: string[],
): Obstacle[] {
  const placed: Obstacle[] = [...carried].sort((a, b) => a.x - b.x);
  const created: Obstacle[] = [];

  const minSpacing = levelIndex > 5 ? 145 : 170;
  const latePressureBonus = strategy === 'punishLateReactions' ? -20 : 0;

  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    const candidate = makeObstacle(kind, levelIndex);

    const signal = signals[i % Math.max(1, signals.length)];
    const defaultX = defaultPlacementX(i, kinds.length, ctx.pathStart, ctx.pathEnd);
    let x = signal ? signal.x : defaultX;
    x += randomSigned(20, 50);

    const prev = placed[placed.length - 1];
    if (prev) {
      const need = requiredSpacing(prev.kind, kind, minSpacing + latePressureBonus, levelIndex);
      x = Math.max(x, prev.x + prev.width + need);
    }

    x = clamp(Math.round(x), ctx.pathStart, ctx.pathEnd - candidate.width);
    candidate.x = x;

    if (!isPlacementSafe(candidate, placed, levelIndex, ctx.pathEnd, minSpacing)) {
      continue;
    }

    placed.push(candidate);
    created.push(candidate);
    addReasonNote(notes, strategy, model, candidate, signal);
  }

  return created;
}

function makeObstacle(kind: ObstacleKind, levelIndex: number): Obstacle {
  if (kind === 'gap') {
    return {
      kind,
      x: 0,
      width: clampInt(GAP_MIN_W + levelIndex * 6, GAP_MIN_W, GAP_MAX_W),
      height: 0,
    };
  }
  if (kind === 'lowCeiling') {
    return {
      kind,
      x: 0,
      width: clampInt(LOW_CEILING_MIN_W + levelIndex * 10, LOW_CEILING_MIN_W, LOW_CEILING_MAX_W),
      height: LOW_CEILING_CLEARANCE,
    };
  }
  return { kind: 'spike', x: 0, width: SPIKE_W, height: SPIKE_H };
}

function normalizeObstacle(obs: Obstacle, levelIndex: number): Obstacle {
  const base = makeObstacle(obs.kind, levelIndex);
  return {
    kind: obs.kind,
    x: obs.x,
    width: base.width,
    height: base.height,
  };
}

function enforceSafety(obstacles: Obstacle[], levelIndex: number, pathEnd: number): Obstacle[] {
  const sorted = obstacles.sort((a, b) => a.x - b.x);
  const safe: Obstacle[] = [];
  const minSpacing = levelIndex > 5 ? 145 : 170;

  for (const obs of sorted) {
    const clamped = { ...obs, x: clamp(obs.x, SAFE_SPAWN_END, pathEnd - obs.width) };
    if (!isPlacementSafe(clamped, safe, levelIndex, pathEnd, minSpacing)) continue;
    safe.push(clamped);
  }

  return safe;
}

function requiredSpacing(
  prevKind: ObstacleKind,
  nextKind: ObstacleKind,
  baseSpacing: number,
  levelIndex: number,
): number {
  const spacing = Math.max(130, baseSpacing);
  const pairHasLowCeiling = (prevKind === 'lowCeiling' && (nextKind === 'spike' || nextKind === 'gap'))
    || (nextKind === 'lowCeiling' && (prevKind === 'spike' || prevKind === 'gap'));

  if (pairHasLowCeiling) {
    return Math.max(spacing, levelIndex > 5 ? 180 : 200);
  }
  return spacing;
}

function isPlacementSafe(
  candidate: Obstacle,
  existing: Obstacle[],
  levelIndex: number,
  pathEnd: number,
  minSpacing: number,
): boolean {
  if (candidate.x < SAFE_SPAWN_END) return false;
  if (candidate.x + candidate.width > pathEnd) return false;

  for (const obs of existing) {
    if (rectsOverlap(candidate, obs)) return false;
    const gap = candidate.x > obs.x ? candidate.x - (obs.x + obs.width) : obs.x - (candidate.x + candidate.width);
    const need = requiredSpacing(obs.kind, candidate.kind, minSpacing, levelIndex);
    if (gap < need) return false;
  }

  return true;
}

function rectsOverlap(a: Obstacle, b: Obstacle): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x;
}

function obstacleCountForLevel(levelIndex: number): number {
  // L2-L5: 4..5 obstacles, L6+: 6..7 obstacles (capped).
  const base = levelIndex > 5 ? 6 + Math.floor((levelIndex - 5) / 4) : 4 + Math.floor(levelIndex / 2);
  return clampInt(base, 4, MAX_OBSTACLES);
}

function carryCountForLevel(levelIndex: number): number {
  return levelIndex > 5 ? 2 : 1;
}

function defaultPlacementX(slot: number, total: number, start: number, end: number): number {
  const span = end - start;
  return start + Math.round((span * (slot + 1)) / (total + 1));
}

function addReasonNote(
  notes: string[],
  strategy: Strategy,
  model: PlayerModel,
  obstacle: Obstacle,
  signal: Signal | undefined,
) {
  if (strategy === 'punishJumpBias' && obstacle.kind === 'lowCeiling') {
    notes.push('Added low ceiling because player prefers jumping');
    return;
  }
  if (strategy === 'punishCrouchBias' && obstacle.kind === 'gap') {
    notes.push('Added gap because player prefers crouching');
    return;
  }
  if (strategy === 'punishPredictability') {
    notes.push('Broke familiar pattern to punish predictability');
    return;
  }
  if (strategy === 'punishLateReactions') {
    notes.push('Tighter reaction window for late decisions');
    return;
  }

  if (signal?.source === 'death') {
    notes.push('Countered recent death position');
  } else if (signal?.source === 'landing') {
    notes.push('Countered recent landing position');
  } else if (model.prefersCrouch && obstacle.kind !== 'lowCeiling') {
    notes.push('Mixed jump obstacle against crouch bias');
  } else {
    notes.push('Balanced escalation mix');
  }
}

function randomSigned(minAbs: number, maxAbs: number): number {
  const magnitude = minAbs + Math.random() * (maxAbs - minAbs);
  return Math.random() < 0.5 ? -Math.round(magnitude) : Math.round(magnitude);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}
