import { LevelData } from './level';
import { Obstacle, ObstacleKind } from './types';
import { PlayerModel, PlayerProfile, RunData } from './telemetry';

const GROUND_TOP = 0;
const SAFE_SPAWN_END = 320;
const SAFE_FLAG_GAP = 240;

const SPIKE_W = 44;
const SPIKE_H = 52;
const DOUBLE_SPIKE_W = 104; // 44 + 16 gap + 44
const DOUBLE_SPIKE_H = 52;
const GAP_MIN_W = 108;
const GAP_MAX_W = 145;
const LOW_CEILING_MIN_W = 150;
const LOW_CEILING_MAX_W = 220;
const LOW_CEILING_CLEARANCE = 34;
const CHOICE_OBS_W = 100;
const CHOICE_OBS_H = 34; // clearance from ground to bar bottom

const MAX_NEW_OBSTACLES = 8;

type Strategy =
  | 'punishJumpBias'
  | 'punishCrouchBias'
  | 'punishPredictability'
  | 'punishLateReactions'
  | 'balancedEscalation';

type PatternKind =
  | 'singleSpike'
  | 'doubleSpike'
  | 'lowCeiling'
  | 'wideGap'
  | 'stepGap'
  | 'jumpThenCrouch'
  | 'crouchThenJump'
  | 'pressureSequence'
  | 'staircase'
  | 'choiceThenPunish';

type DensityLabel = 'low' | 'medium' | 'high' | 'extreme';

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

export function generateAdaptiveLevel(
  previousRuns: RunData[],
  _profile: PlayerProfile,
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
  const zoneCount = zoneCountForLevel(levelIndex);
  const density = densityForZoneCount(zoneCount);
  const notes: string[] = [];

  notes.push(`Strategy: ${strategy}`);

  if (latestDeath?.deathX !== undefined) {
    notes.push(`near death x=${Math.round(latestDeath.deathX)}`);
  }
  const lastSuccessLanding = latestSuccess?.landings.slice(-1)[0];
  if (lastSuccessLanding) {
    notes.push(`near landing x=${Math.round(lastSuccessLanding.x)}`);
  }

  const carried = carryForwardObstacles(ctx, levelIndex);
  if (carried.length > 0) {
    notes.push(`Carried ${carried.length} obstacle(s) from previous level`);
  }

  const patternKinds = buildPatternPlan(strategy, zoneCount, levelIndex);
  const { newObstacles, usedPatterns } = placePatterns(patternKinds, carried, levelIndex, ctx);

  const obstacles = [...carried, ...newObstacles].sort((a, b) => a.x - b.x);

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
      strategy,
      patterns: usedPatterns,
      density,
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

function zoneCountForLevel(levelIndex: number): number {
  return clampInt(levelIndex + 1, 2, 8);
}

function densityForZoneCount(count: number): DensityLabel {
  if (count <= 3) return 'low';
  if (count <= 5) return 'medium';
  if (count <= 7) return 'high';
  return 'extreme';
}

function patternPoolForStrategy(strategy: Strategy, levelIndex: number): PatternKind[] {
  switch (strategy) {
    case 'punishJumpBias':
      return ['lowCeiling', 'crouchThenJump', 'choiceThenPunish', 'lowCeiling', 'wideGap'];
    case 'punishCrouchBias':
      return ['wideGap', 'jumpThenCrouch', 'pressureSequence', 'singleSpike', 'stepGap'];
    case 'punishPredictability':
      return ['jumpThenCrouch', 'crouchThenJump', 'choiceThenPunish', 'staircase'];
    case 'punishLateReactions':
      return ['pressureSequence', 'doubleSpike', 'staircase', 'stepGap', 'pressureSequence'];
    case 'balancedEscalation':
      if (levelIndex > 5) return ['jumpThenCrouch', 'doubleSpike', 'crouchThenJump', 'staircase', 'choiceThenPunish'];
      if (levelIndex > 3) return ['jumpThenCrouch', 'wideGap', 'lowCeiling', 'pressureSequence'];
      return ['singleSpike', 'lowCeiling', 'wideGap', 'jumpThenCrouch'];
  }
}

function buildPatternPlan(strategy: Strategy, zoneCount: number, levelIndex: number): PatternKind[] {
  const pool = patternPoolForStrategy(strategy, levelIndex);
  const result: PatternKind[] = [];
  for (let i = 0; i < zoneCount; i++) {
    result.push(pool[i % pool.length]);
  }
  return result;
}

function patternFirstKind(kind: PatternKind): ObstacleKind {
  switch (kind) {
    case 'singleSpike': return 'spike';
    case 'doubleSpike': return 'doubleSpike';
    case 'lowCeiling': return 'lowCeiling';
    case 'wideGap': return 'gap';
    case 'stepGap': return 'gap';
    case 'jumpThenCrouch': return 'spike';
    case 'crouchThenJump': return 'lowCeiling';
    case 'pressureSequence': return 'spike';
    case 'staircase': return 'spike';
    case 'choiceThenPunish': return 'choiceObstacle';
  }
}

function patternWidth(kind: PatternKind, levelIndex: number): number {
  const ceilW = clampInt(LOW_CEILING_MIN_W + levelIndex * 10, LOW_CEILING_MIN_W, LOW_CEILING_MAX_W);
  const tightGap = levelIndex > 5 ? 185 : 205;
  const pressureGap = levelIndex > 5 ? 150 : 175;
  switch (kind) {
    case 'singleSpike': return SPIKE_W;
    case 'doubleSpike': return DOUBLE_SPIKE_W;
    case 'lowCeiling': return ceilW;
    case 'wideGap': return clampInt(GAP_MIN_W + levelIndex * 6, GAP_MIN_W, GAP_MAX_W);
    case 'stepGap': return 280;
    case 'jumpThenCrouch': return SPIKE_W + tightGap + ceilW;
    case 'crouchThenJump': return ceilW + tightGap + SPIKE_W;
    case 'pressureSequence': return SPIKE_W + pressureGap + SPIKE_W;
    case 'staircase': return 390;
    case 'choiceThenPunish': return CHOICE_OBS_W + tightGap + SPIKE_W;
  }
}

function buildPatternObstacles(kind: PatternKind, startX: number, levelIndex: number): Obstacle[] {
  const ceilW = clampInt(LOW_CEILING_MIN_W + levelIndex * 10, LOW_CEILING_MIN_W, LOW_CEILING_MAX_W);
  const tightGap = levelIndex > 5 ? 185 : 205;
  const pressureGap = levelIndex > 5 ? 150 : 175;
  switch (kind) {
    case 'singleSpike':
      return [{ kind: 'spike', x: startX, width: SPIKE_W, height: SPIKE_H }];
    case 'doubleSpike':
      return [{ kind: 'doubleSpike', x: startX, width: DOUBLE_SPIKE_W, height: DOUBLE_SPIKE_H }];
    case 'lowCeiling':
      return [{ kind: 'lowCeiling', x: startX, width: ceilW, height: LOW_CEILING_CLEARANCE }];
    case 'wideGap': {
      const w = clampInt(GAP_MIN_W + levelIndex * 6, GAP_MIN_W, GAP_MAX_W);
      return [{ kind: 'gap', x: startX, width: w, height: 0 }];
    }
    case 'stepGap':
      return [
        { kind: 'gap', x: startX, width: 280, height: 0 },
        { kind: 'platform', x: startX + 50, width: 70, height: 0 },
        { kind: 'platform', x: startX + 160, width: 70, height: 0 },
      ];
    case 'jumpThenCrouch':
      return [
        { kind: 'spike', x: startX, width: SPIKE_W, height: SPIKE_H },
        { kind: 'lowCeiling', x: startX + SPIKE_W + tightGap, width: ceilW, height: LOW_CEILING_CLEARANCE },
      ];
    case 'crouchThenJump':
      return [
        { kind: 'lowCeiling', x: startX, width: ceilW, height: LOW_CEILING_CLEARANCE },
        { kind: 'spike', x: startX + ceilW + tightGap, width: SPIKE_W, height: SPIKE_H },
      ];
    case 'pressureSequence':
      return [
        { kind: 'spike', x: startX, width: SPIKE_W, height: SPIKE_H },
        { kind: 'spike', x: startX + SPIKE_W + pressureGap, width: SPIKE_W, height: SPIKE_H },
      ];
    case 'staircase':
      return [
        { kind: 'gap', x: startX, width: 390, height: 0 },
        { kind: 'platform', x: startX + 20, width: 70, height: 15 },
        { kind: 'platform', x: startX + 140, width: 70, height: 30 },
        { kind: 'platform', x: startX + 260, width: 70, height: 45 },
      ];
    case 'choiceThenPunish':
      return [
        { kind: 'choiceObstacle', x: startX, width: CHOICE_OBS_W, height: CHOICE_OBS_H },
        { kind: 'spike', x: startX + CHOICE_OBS_W + tightGap, width: SPIKE_W, height: SPIKE_H },
      ];
  }
}

function placePatterns(
  patternKinds: PatternKind[],
  carried: Obstacle[],
  levelIndex: number,
  ctx: GenerationContext,
): { newObstacles: Obstacle[]; usedPatterns: string[] } {
  const challengeSpace = ctx.pathEnd - ctx.pathStart;
  const n = patternKinds.length;
  const baseSpacing = levelIndex > 5 ? 145 : 170;

  const placed: Obstacle[] = [...carried];
  const newObstacles: Obstacle[] = [];
  const usedPatterns: string[] = [];

  for (let i = 0; i < n; i++) {
    if (newObstacles.length >= MAX_NEW_OBSTACLES) break;

    const kind = patternKinds[i];
    const pWidth = patternWidth(kind, levelIndex);

    // Ideal center: evenly distributed across challenge space
    const idealCenter = ctx.pathStart + Math.round(challengeSpace * (i + 1) / (n + 1));
    let startX = idealCenter - Math.floor(pWidth / 2);
    startX = Math.max(startX, ctx.pathStart);

    // Enforce minimum gap from last placed obstacle
    if (placed.length > 0) {
      const lastObs = placed[placed.length - 1];
      const lastEnd = lastObs.x + lastObs.width;
      const firstKind = patternFirstKind(kind);
      const minGap = requiredSpacing(lastObs.kind, firstKind, baseSpacing, levelIndex);
      startX = Math.max(startX, lastEnd + minGap);
    }

    if (startX + pWidth > ctx.pathEnd) continue;

    const pObs = buildPatternObstacles(kind, startX, levelIndex);
    // Check each pattern obstacle only against pre-pattern placed obstacles
    const snapshot = [...placed];

    const allFit = pObs.every((obs) => {
      if (obs.x < SAFE_SPAWN_END || obs.x + obs.width > ctx.pathEnd) return false;
      return !snapshot.some((ext) => {
        if (rectsOverlap(obs, ext)) return true;
        const gap = obs.x > ext.x
          ? obs.x - (ext.x + ext.width)
          : ext.x - (obs.x + obs.width);
        return gap < requiredSpacing(ext.kind, obs.kind, baseSpacing, levelIndex);
      });
    });

    if (allFit) {
      placed.push(...pObs);
      newObstacles.push(...pObs);
      usedPatterns.push(kind);
    }
  }

  return { newObstacles, usedPatterns };
}

function carryForwardObstacles(ctx: GenerationContext, levelIndex: number): Obstacle[] {
  const snapshot = ctx.latestRun?.obstaclesSnapshot;
  if (!snapshot || snapshot.length === 0) return [];

  const carryTarget = levelIndex > 5 ? 2 : 1;
  // Skip gap/platform — they form paired units that are meaningless when separated
  const carryable = snapshot.filter(o => o.kind !== 'gap' && o.kind !== 'platform');
  const sorted = [...carryable].sort((a, b) => a.x - b.x);
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

  return enforceSafety(carried, levelIndex, ctx.pathEnd);
}

function makeObstacle(kind: ObstacleKind, levelIndex: number): Obstacle {
  switch (kind) {
    case 'gap': {
      const w = clampInt(GAP_MIN_W + levelIndex * 6, GAP_MIN_W, GAP_MAX_W);
      return { kind, x: 0, width: w, height: 0 };
    }
    case 'lowCeiling': {
      const w = clampInt(LOW_CEILING_MIN_W + levelIndex * 10, LOW_CEILING_MIN_W, LOW_CEILING_MAX_W);
      return { kind, x: 0, width: w, height: LOW_CEILING_CLEARANCE };
    }
    case 'doubleSpike':
      return { kind, x: 0, width: DOUBLE_SPIKE_W, height: DOUBLE_SPIKE_H };
    case 'choiceObstacle':
      return { kind, x: 0, width: CHOICE_OBS_W, height: CHOICE_OBS_H };
    case 'platform':
      return { kind, x: 0, width: 70, height: 0 };
    case 'spike':
      return { kind, x: 0, width: SPIKE_W, height: SPIKE_H };
  }
}

function normalizeObstacle(obs: Obstacle, levelIndex: number): Obstacle {
  const base = makeObstacle(obs.kind, levelIndex);
  return { kind: obs.kind, x: obs.x, width: base.width, height: base.height };
}

function enforceSafety(obstacles: Obstacle[], levelIndex: number, pathEnd: number): Obstacle[] {
  const sorted = [...obstacles].sort((a, b) => a.x - b.x);
  const safe: Obstacle[] = [];
  const baseSpacing = levelIndex > 5 ? 145 : 170;

  for (const obs of sorted) {
    const clamped = { ...obs, x: clamp(obs.x, SAFE_SPAWN_END, pathEnd - obs.width) };
    const ok = !safe.some((ext) => {
      if (rectsOverlap(clamped, ext)) return true;
      const gap = clamped.x > ext.x
        ? clamped.x - (ext.x + ext.width)
        : ext.x - (clamped.x + clamped.width);
      return gap < requiredSpacing(ext.kind, clamped.kind, baseSpacing, levelIndex);
    });
    if (ok) safe.push(clamped);
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
  const isOverhead = (k: ObstacleKind) => k === 'lowCeiling' || k === 'choiceObstacle';
  const isGround = (k: ObstacleKind) => k === 'spike' || k === 'gap' || k === 'doubleSpike';
  const pairHasOverhead =
    (isOverhead(prevKind) && isGround(nextKind)) ||
    (isOverhead(nextKind) && isGround(prevKind));
  if (pairHasOverhead) {
    return Math.max(spacing, levelIndex > 5 ? 180 : 200);
  }
  return spacing;
}

function rectsOverlap(a: Obstacle, b: Obstacle): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x;
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
