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
    // Level 1 tutorial challenge: one clear split.
    // Option A: crouch under black->purple section.
    // Option B: jump to upper route tile over black section.
    obstacles: [
      // First hazard.
      { kind: 'spike', x: 636, width: 44, height: 52, routeLayer: 'lower', routeId: 'tutorial_lower' },

      // One setup tile after spike, before black ceiling (slightly above standing height).
      { kind: 'platform', x: 770, width: 108, height: 64, solid: true, routeLayer: 'upper', routeId: 'tutorial_upper' },

      // Black crouch section.
      { kind: 'lowCeiling', x: 1028, width: 186, height: 34, routeLayer: 'lower', routeId: 'tutorial_lower' },

      // Upper bypass tile above black section.
      { kind: 'platform', x: 1086, width: 152, height: 114, solid: true, routeLayer: 'upper', routeId: 'tutorial_upper' },

      // Purple section with explicit spacing from black for actual decision window.
      { kind: 'choiceObstacle', x: 1368, width: 116, height: 34, trapType: 'adaptiveChoiceGate', trapGroupId: 'tutorial_choice_1', routeLayer: 'lower', routeId: 'tutorial_lower' },

      // Final ground hazard. No extra end tiles near flag.
      { kind: 'spike', x: 1664, width: 44, height: 52, routeLayer: 'lower', routeId: 'tutorial_lower' },
    ],
  },
];

export function buildLevel(index: number, canvasHeight: number): LevelData {
  const def = LEVEL_DEFINITIONS[index] ?? LEVEL_DEFINITIONS[0];
  return {
    index,
    worldWidth: 2200,
    groundY: canvasHeight - 80,
    flagX: 1980,
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
