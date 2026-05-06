import { Obstacle } from './types';

export interface AdaptiveDebugInfo {
  notes: string[];
  placementXs: number[];
  obstacleCount: number;
  strategy: string;
  patterns: string[];
  variants: string[];
  requiredPatterns: string[];
  placedRequiredPatterns: string[];
  density: 'low' | 'medium' | 'high' | 'extreme';
  antiRepeat: string[];
  attempted: number;
  dropped: string[];
  difficulty: string;
  challengeZones: number;
  uniquePatternTypes: number;
  comboCount: number;
  advancedCount: number;
  platformUsed: boolean;
  difficultyIncreasing: boolean;
  safeJumpDistance: number;
  maxJumpDistance: number;
  validationStatus: 'valid' | 'repaired' | 'fallback';
  validationWarnings: string[];
  totalDifficultyScore: number;
  requiredDifficultyScore: number;
  segmentScores: number[];
  counterTargets: string[];
  adaptationReasons: string[];
  // AI Learning fields (Task 5)
  aiPhase: string; // 'observe' | 'test' | 'counter' | 'predict' | 'dominate'
  activeTraps: string[];
  trapReasons: string[];
  overallConfidence: number;
  topLearnedHabit: string;
  predictedLandingX?: number;
  mutationFallbackUsed?: boolean;
  mutationTargetObstacleId?: string;
}

export interface LevelData {
  index: number;       // 0-based
  worldWidth: number;
  groundY: number;     // top of ground, derived from canvas height at build time
  flagX: number;
  obstacles: Obstacle[];
  aiLandingMarkersX?: number[];
  aiDebug?: AdaptiveDebugInfo;
  aiKnowledge?: import('./aiKnowledge').AIKnowledge; // Task 5: AI learning data
}

export interface GroundSegment {
  x: number;
  width: number;
}

// Static tutorial fallback only. Levels 2+ are adaptive in game.ts.
const LEVEL_DEFINITIONS: Array<{ obstacles: Obstacle[] }> = [
  {
    // Level 1 tutorial challenge: jump + crouch + decision.
    obstacles: [
      { kind: 'spike', x: 430, width: 44, height: 52 },
      { kind: 'lowCeiling', x: 760, width: 170, height: 34 },
      { kind: 'choiceObstacle', x: 1110, width: 100, height: 34, trapType: 'adaptiveChoiceGate', trapGroupId: 'tutorial_choice_1' },
    ],
  },
];

export function buildLevel(index: number, canvasHeight: number): LevelData {
  const def = LEVEL_DEFINITIONS[index] ?? LEVEL_DEFINITIONS[0];
  return {
    index,
    worldWidth: 1900,
    groundY: canvasHeight - 80,
    flagX: 1620,
    obstacles: def.obstacles,
  };
}

// Returns ground segments with gap holes punched out — used by renderer and collision
export function getGroundSegments(worldWidth: number, obstacles: Obstacle[]): GroundSegment[] {
  const gaps = obstacles
    .filter(o => o.kind === 'gap')
    .sort((a, b) => (a.currentX ?? a.x) - (b.currentX ?? b.x));

  const segments: GroundSegment[] = [];
  let cursor = 0;

  for (const gap of gaps) {
    const gapX = gap.currentX ?? gap.x;
    const gapW = gap.currentWidth ?? gap.width;
    if (gapX > cursor) {
      segments.push({ x: cursor, width: gapX - cursor });
    }
    cursor = gapX + gapW;
  }
  if (cursor < worldWidth) {
    segments.push({ x: cursor, width: worldWidth - cursor });
  }
  return segments;
}
