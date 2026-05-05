import { Obstacle } from './types';

export interface AdaptiveDebugInfo {
  notes: string[];
  placementXs: number[];
  obstacleCount: number;
  strategy: string;
  patterns: string[];
  variants: string[];
  density: 'low' | 'medium' | 'high' | 'extreme';
  antiRepeat: string[];
  attempted: number;
  dropped: string[];
  difficulty: string;
  safeJumpDistance: number;
  maxJumpDistance: number;
}

export interface LevelData {
  index: number;       // 0-based
  worldWidth: number;
  groundY: number;     // top of ground, derived from canvas height at build time
  flagX: number;
  obstacles: Obstacle[];
  aiLandingMarkersX?: number[];
  aiDebug?: AdaptiveDebugInfo;
}

export interface GroundSegment {
  x: number;
  width: number;
}

// Static tutorial fallback only. Levels 2+ are adaptive in game.ts.
const LEVEL_DEFINITIONS: Array<{ obstacles: Obstacle[] }> = [
  {
    // Level 1 starter: spike + low ceiling to teach jump and crouch.
    obstacles: [
      { kind: 'spike', x: 520, width: 44, height: 52 },
      { kind: 'lowCeiling', x: 980, width: 168, height: 34 },
    ],
  },
];

export function buildLevel(index: number, canvasHeight: number): LevelData {
  const def = LEVEL_DEFINITIONS[index] ?? LEVEL_DEFINITIONS[0];
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
