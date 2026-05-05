import { LevelData } from './level';
import { Obstacle, ObstacleKind } from './types';
import { PlayerProfile, RunData } from './telemetry';

const GROUND_TOP = 0;
const SAFE_SPAWN_END = 320;
const SAFE_FLAG_GAP = 240;
const MIN_OBSTACLE_CLEARANCE = 160;
const MAX_OBSTACLES = 5;

const SPIKE_W = 44;
const SPIKE_H = 52;
const GAP_MIN_W = 108;
const GAP_MAX_W = 142;
const LOW_CEILING_MIN_W = 150;
const LOW_CEILING_MAX_W = 220;
const LOW_CEILING_CLEARANCE = 34;

type SignalReason = 'landing' | 'death' | 'profile' | 'default';

interface Anchor {
  x: number;
  weight: number;
  reason: SignalReason;
}

interface ForcedSignal {
  slot: number;
  x: number;
  reason: SignalReason;
  sourceX: number;
}

/**
 * Adaptive generator with no side effects.
 * Level 1 is static in game.ts; this function is for Level 2+.
 */
export function generateAdaptiveLevel(
  previousRuns: RunData[],
  profile: PlayerProfile,
  levelIndex: number,
  canvasWidth: number,
): LevelData {
  const worldWidth = clamp(Math.round(canvasWidth * 2.5), 1850, 2800);
  const flagX = worldWidth - 280;
  const pathStart = SAFE_SPAWN_END;
  const pathEnd = flagX - SAFE_FLAG_GAP;

  const obstacleCount = obstacleCountForLevel(levelIndex);
  const sourceLevel = Math.max(0, levelIndex - 1);

  const levelRuns = previousRuns.filter((r) => r.levelIndex === sourceLevel);
  const latestRun = levelRuns[levelRuns.length - 1];
  const latestSuccess = [...levelRuns].reverse().find((r) => r.completed);
  const recentRuns = levelRuns.slice(-8);
  const latestDeath = [...recentRuns].reverse().find((r) => !r.completed && r.deathX !== undefined);

  const notes: string[] = [];
  notes.push(`Generated ${obstacleCount} obstacle(s)`);

  const anchors = collectAnchors(latestSuccess, recentRuns, profile, pathStart, pathEnd);
  let positions = defaultPositions(obstacleCount, pathStart, pathEnd);
  positions = pullTowardAnchors(positions, anchors, profile, pathStart, pathEnd);

  const forced = forcePrimaryPlacements(positions, latestSuccess, latestDeath, pathStart, pathEnd);
  positions = forced.positions;

  const types = chooseTypes(recentRuns, obstacleCount, levelIndex);
  const obstacles = materializeObstacles(positions, types, levelIndex, pathStart, pathEnd);

  addPlacementNotes(notes, obstacles, forced.forcedSignals);

  const markerSource = latestSuccess ?? latestRun;
  const landingMarkers = (markerSource?.landings ?? [])
    .map((l) => clamp(Math.round(l.x), pathStart, pathEnd))
    .filter((x, i, arr) => arr.indexOf(x) === i)
    .slice(-8);

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

function collectAnchors(
  latestSuccess: RunData | undefined,
  recentRuns: RunData[],
  profile: PlayerProfile,
  pathStart: number,
  pathEnd: number,
): Anchor[] {
  const anchors: Anchor[] = [];

  if (latestSuccess) {
    for (const landing of latestSuccess.landings.slice(-5)) {
      anchors.push({
        x: clamp(Math.round(landing.x + 70), pathStart, pathEnd),
        weight: 3.4,
        reason: 'landing',
      });
    }
  }

  for (const run of recentRuns.slice(-4)) {
    if (run.deathX === undefined) continue;
    const offset = run.deathReason === 'gap' ? 42 : 28;
    anchors.push({
      x: clamp(Math.round(run.deathX + offset), pathStart, pathEnd),
      weight: 2.6,
      reason: 'death',
    });
  }

  for (const zone of profile.commonLandingZones.slice(0, 3)) {
    anchors.push({
      x: clamp(Math.round(zone + 58), pathStart, pathEnd),
      weight: 1.4,
      reason: 'profile',
    });
  }

  return anchors;
}

function defaultPositions(count: number, start: number, end: number): number[] {
  const points: number[] = [];
  const span = end - start;
  for (let i = 0; i < count; i++) {
    points.push(start + Math.round((span * (i + 1)) / (count + 1)));
  }
  return points;
}

function pullTowardAnchors(
  defaults: number[],
  anchors: Anchor[],
  profile: PlayerProfile,
  pathStart: number,
  pathEnd: number,
): number[] {
  const pullRadius = 330;

  const pulled = defaults.map((base, idx) => {
    const nearby = anchors.filter((a) => Math.abs(a.x - base) <= pullRadius);
    if (nearby.length === 0) return base;

    const totalWeight = nearby.reduce((acc, a) => acc + a.weight, 0);
    const weightedX = nearby.reduce((acc, a) => acc + a.x * a.weight, 0) / totalWeight;
    const blended = Math.round(base * 0.4 + weightedX * 0.6);

    const styleAdjusted = applyJumpStyleOffset(blended, profile.jumpStyle, idx);
    const jittered = styleAdjusted + randomSigned(20, 50);
    return clamp(jittered, pathStart, pathEnd);
  });

  return pulled;
}

function forcePrimaryPlacements(
  current: number[],
  latestSuccess: RunData | undefined,
  latestDeath: RunData | undefined,
  pathStart: number,
  pathEnd: number,
): { positions: number[]; forcedSignals: ForcedSignal[] } {
  const positions = [...current];
  const forcedSignals: ForcedSignal[] = [];

  const latestLanding = latestSuccess?.landings[latestSuccess.landings.length - 1];
  if (latestLanding && positions.length > 0) {
    const target = clamp(Math.round(latestLanding.x + 70 + randomSigned(20, 40)), pathStart, pathEnd);
    positions[0] = target;
    forcedSignals.push({ slot: 0, x: target, reason: 'landing', sourceX: latestLanding.x });
  }

  if (latestDeath && latestDeath.deathX !== undefined && positions.length > 1) {
    const target = clamp(Math.round(latestDeath.deathX + 32 + randomSigned(20, 40)), pathStart, pathEnd);
    positions[1] = target;
    forcedSignals.push({ slot: 1, x: target, reason: 'death', sourceX: latestDeath.deathX });
  }

  return { positions, forcedSignals };
}

function applyJumpStyleOffset(x: number, style: PlayerProfile['jumpStyle'], index: number): number {
  switch (style) {
    case 'early':
      return x + 60;
    case 'late':
      return x - 60;
    case 'balanced':
      return x + (index % 2 === 0 ? 20 : -20);
    case 'unknown':
      return x;
  }
}

function chooseTypes(recentRuns: RunData[], count: number, levelIndex: number): ObstacleKind[] {
  const types: ObstacleKind[] = [];
  const spikeDeaths = recentRuns.filter((r) => r.deathReason === 'spike').length;
  const gapDeaths = recentRuns.filter((r) => r.deathReason === 'gap').length;

  for (let i = 0; i < count; i++) {
    if (i === 0) {
      types.push('spike');
      continue;
    }
    if (i === 1 && levelIndex >= 1) {
      types.push('lowCeiling');
      continue;
    }

    if (gapDeaths > spikeDeaths) {
      types.push(i % 2 === 1 ? 'gap' : 'spike');
    } else if (spikeDeaths > gapDeaths) {
      types.push(i % 3 === 0 ? 'gap' : 'spike');
    } else {
      types.push((i + levelIndex) % 2 === 0 ? 'spike' : 'gap');
    }
  }

  return types;
}

function materializeObstacles(
  rawPositions: number[],
  types: ObstacleKind[],
  levelIndex: number,
  pathStart: number,
  pathEnd: number,
): Obstacle[] {
  const ordered = [...rawPositions].sort((a, b) => a - b);
  const safe: Obstacle[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const kind = types[i] ?? 'spike';
    const width = kind === 'gap'
      ? gapWidthFor(levelIndex)
      : kind === 'lowCeiling'
        ? lowCeilingWidth(levelIndex)
        : SPIKE_W;
    const height = kind === 'spike'
      ? SPIKE_H
      : kind === 'lowCeiling'
        ? LOW_CEILING_CLEARANCE
        : 0;

    const desiredX = clamp(Math.round(ordered[i]), pathStart, pathEnd - width);
    let x = desiredX;

    if (safe.length > 0) {
      const prev = safe[safe.length - 1];
      const minAllowed = prev.x + prev.width + MIN_OBSTACLE_CLEARANCE;
      if (x < minAllowed) {
        x = minAllowed;
      }
    }

    if (x + width > pathEnd) continue;

    safe.push({ kind, x, width, height });
  }

  return safe;
}

function addPlacementNotes(notes: string[], obstacles: Obstacle[], forced: ForcedSignal[]) {
  for (const signal of forced) {
    if (signal.reason === 'landing') {
      notes.push(`Placed obstacle near landing at ${Math.round(signal.sourceX)}`);
    } else if (signal.reason === 'death') {
      notes.push(`Added challenge near death at ${Math.round(signal.sourceX)}`);
    }
  }

  if (obstacles.length > 0) {
    const compact = obstacles
      .slice(0, 4)
      .map((o) => `${o.kind}@${Math.round(o.x)}`)
      .join(', ');
    notes.push(`Layout: ${compact}`);
  }
}

function gapWidthFor(levelIndex: number): number {
  return clampInt(GAP_MIN_W + levelIndex * 6, GAP_MIN_W, GAP_MAX_W);
}

function lowCeilingWidth(levelIndex: number): number {
  return clampInt(LOW_CEILING_MIN_W + levelIndex * 10, LOW_CEILING_MIN_W, LOW_CEILING_MAX_W);
}

function obstacleCountForLevel(levelIndex: number): number {
  // Level 2+ should not be easier than Level 1 (which has 2 test obstacles).
  // L2=3, L3=4, L4+=5 (capped).
  return clampInt(2 + levelIndex, 3, MAX_OBSTACLES);
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
