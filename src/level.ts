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
  preferredRoute?: string;
  routeConfidence?: number;
  routeRiskStyle?: string;
  routeUsage?: { lower: number; mid: number; upper: number };
  routesUsed?: string[];
  routeSwitchPoints?: number;
  routeConnectivityStatus?: 'valid' | 'weak';
  routeTargeted?: string;
  routeMutationCounts?: { lower: number; mid: number; upper: number };
  // Level mutator fields
  mutatorBudget?: { total: number; spent: number };
  appliedMutations?: Array<{ type: string; targetX: number; reason: string }>;
  mutatorDebugLines?: string[];
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
    // Level 1 baseline: no AI mutations, full obstacle arsenal, multi-route learning map.
    // Lower route is always viable; upper route provides alternate decisions and drop-downs.
    obstacles: [
      // Ground route core hazards.
      { kind: 'spike', x: 620, width: 44, height: 52, routeLayer: 'lower', routeId: 'tutorial_lower' },
      { kind: 'lowCeiling', x: 1020, width: 190, height: 34, routeLayer: 'lower', routeId: 'tutorial_lower' },
      { kind: 'gap', x: 1300, width: 84, height: 0, routeLayer: 'lower', routeId: 'tutorial_lower' },
      { kind: 'doubleSpike', x: 1540, width: 104, height: 52, routeLayer: 'lower', routeId: 'tutorial_lower' },
      { kind: 'choiceObstacle', x: 1760, width: 116, height: 34, trapType: 'adaptiveChoiceGate', trapGroupId: 'tutorial_choice_1', routeLayer: 'lower', routeId: 'tutorial_lower' },
      { kind: 'spike', x: 1970, width: 44, height: 52, routeLayer: 'lower', routeId: 'tutorial_lower' },

      // Upper route: fewer tiles, each one intentional, every transition requires a jump.
      { kind: 'platform', x: 760, width: 110, height: 84, solid: true, routeLayer: 'upper', routeId: 'tutorial_upper' },
      { kind: 'platform', x: 940, width: 112, height: 148, solid: true, routeLayer: 'upper', routeId: 'tutorial_upper' },
      { kind: 'platform', x: 1138, width: 116, height: 156, solid: true, routeLayer: 'upper', routeId: 'tutorial_upper' },
      { kind: 'platform', x: 1368, width: 120, height: 208, solid: true, routeLayer: 'upper', routeId: 'tutorial_upper' },
      { kind: 'platform', x: 1608, width: 124, height: 208, solid: true, routeLayer: 'upper', routeId: 'tutorial_upper' },
      { kind: 'platform', x: 1848, width: 132, height: 208, solid: true, routeLayer: 'upper', routeId: 'tutorial_upper' },
    ],
  },
];

export function buildLevel(index: number, canvasHeight: number): LevelData {
  const def = LEVEL_DEFINITIONS[index] ?? LEVEL_DEFINITIONS[0];
  return {
    index,
    worldWidth: 2580,
    groundY: canvasHeight - 80,
    flagX: 2340,
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
