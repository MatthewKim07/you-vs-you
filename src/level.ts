import { Obstacle } from './types';

export interface LevelData {
  index: number;       // 0-based
  worldWidth: number;
  groundY: number;     // top of ground, derived from canvas height at build time
  flagX: number;
  obstacles: Obstacle[];
  // AI HOOK (Milestone 3+): replace static obstacles with generator output
}

export interface GroundSegment {
  x: number;
  width: number;
}

// Static level definitions — obstacles placed in world-space pixels
const LEVEL_DEFINITIONS: Array<{ obstacles: Obstacle[] }> = [
  {
    // Level 1: flat run, no obstacles — tutorial
    obstacles: [],
  },
  {
    // Level 2: one spike, learn to jump
    obstacles: [
      { kind: 'spike', x: 700, width: 44, height: 52 },
    ],
  },
  {
    // Level 3: spike + gap — two distinct challenges
    obstacles: [
      { kind: 'spike', x: 620, width: 44, height: 52 },
      { kind: 'gap',   x: 1100, width: 130, height: 0 },
    ],
  },
];

export const TOTAL_LEVELS = LEVEL_DEFINITIONS.length;

export function buildLevel(index: number, canvasHeight: number): LevelData {
  const def = LEVEL_DEFINITIONS[index];
  return {
    index,
    worldWidth: 2000,
    groundY: canvasHeight - 80,
    flagX: 1700,
    obstacles: def.obstacles,
  };
}

// Returns ground segments with gap holes punched out — used by renderer and collision
export function getGroundSegments(worldWidth: number, obstacles: Obstacle[]): GroundSegment[] {
  const gaps = obstacles
    .filter(o => o.kind === 'gap')
    .sort((a, b) => a.x - b.x);

  const segments: GroundSegment[] = [];
  let cursor = 0;

  for (const gap of gaps) {
    if (gap.x > cursor) {
      segments.push({ x: cursor, width: gap.x - cursor });
    }
    cursor = gap.x + gap.width;
  }
  if (cursor < worldWidth) {
    segments.push({ x: cursor, width: worldWidth - cursor });
  }
  return segments;
}

