import { LevelData } from './level';
import { Obstacle, ObstacleKind } from './types';
import { PlayerModel, PlayerProfile, RunData } from './telemetry';
import {
  Difficulty,
  levelDifficulty,
  calculateReactionSpacing,
  calculateSafeJumpDistance,
  calculateMaxJumpDistance,
  calculateStaircaseHeights,
  calculateStepGapHeights,
} from './movementTuning';

const GROUND_TOP = 0;
const SAFE_SPAWN_END = 320;
const SAFE_FLAG_GAP = 240;

const SPIKE_W = 44;
const SPIKE_H = 52;
const DOUBLE_SPIKE_W = 104;
const DOUBLE_SPIKE_H = 52;
const GAP_MIN_W = 108;
const GAP_MAX_W = 150;
const LOW_CEILING_MIN_W = 150;
const LOW_CEILING_MAX_W = 230;
const LOW_CEILING_CLEARANCE = 34;
const CHOICE_OBS_W = 100;
const CHOICE_OBS_H = 34;

const MAX_NEW_PATTERNS = 10;

type Strategy =
  | 'punishJumpBias'
  | 'punishCrouchBias'
  | 'punishPredictability'
  | 'punishLateReactions'
  | 'balancedEscalation';

type DensityLabel = 'low' | 'medium' | 'high' | 'extreme';

type PatternKind =
  | 'singleSpike'
  | 'doubleSpike'
  | 'lowCeiling'
  | 'wideGap'
  | 'stepGap'
  | 'staircase'
  | 'choiceObstacle'
  | 'pressureSequence'
  | 'jumpThenCrouch'
  | 'crouchThenJump';

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

interface PerformanceTuning {
  zoneDelta: number;
  spacingAdjust: number;
  advancedReduction: number;
  note: string;
}

interface CompositionPlan {
  zoneCount: number;
  density: DensityLabel;
  minAdvanced: number;
  minCombo: number;
}

interface VariantContext {
  levelIndex: number;
  difficulty: Difficulty;
  strategy: Strategy;
  playerModel: PlayerModel;
  reactionSpacing: number;
  safeJumpDistance: number;
  maxJumpDistance: number;
}

interface PatternVariant {
  name: string;
  kind: PatternKind;
  difficulties: Difficulty[];
  advanced: boolean;
  combo: boolean;
  firstKind: ObstacleKind;
  build: (startX: number, ctx: VariantContext) => Obstacle[];
}

interface SelectedVariant {
  kind: PatternKind;
  variant: PatternVariant;
}

interface PlaceResult {
  obstacles: Obstacle[];
  usedPatterns: string[];
  usedVariants: string[];
  droppedVariants: string[];
}

export function generateAdaptiveLevel(
  previousRuns: RunData[],
  _profile: PlayerProfile,
  playerModel: PlayerModel,
  levelIndex: number,
  canvasWidth: number,
): LevelData {
  const difficulty = levelDifficulty(levelIndex);
  const strategy = selectStrategy(playerModel);
  const worldWidth = worldWidthForLevel(levelIndex, canvasWidth);
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

  const tuning = evaluatePerformance(sourceRuns);
  const composition = compositionForLevel(levelIndex, difficulty, tuning.zoneDelta, tuning.advancedReduction);

  const reactionSpacing = clampInt(calculateReactionSpacing(difficulty) + tuning.spacingAdjust, 120, 260);
  const variantCtx: VariantContext = {
    levelIndex,
    difficulty,
    strategy,
    playerModel,
    reactionSpacing,
    safeJumpDistance: calculateSafeJumpDistance(difficulty),
    maxJumpDistance: calculateMaxJumpDistance(),
  };

  const planKinds = buildPatternPlan(strategy, composition.zoneCount, levelIndex, difficulty, composition.minAdvanced, composition.minCombo);
  const recentVariantMemory = collectRecentVariantMemory(previousRuns, 3);
  const antiRepeatNotes: string[] = [];

  const selected = selectVariantsForPlan(planKinds, variantCtx, recentVariantMemory, antiRepeatNotes, levelIndex);

  const carried = carryForwardObstacles(ctx, levelIndex, reactionSpacing);
  const placed = placeSelectedVariants(selected, carried, variantCtx, levelIndex, ctx, reactionSpacing);
  const obstacles = [...carried, ...placed.obstacles].sort((a, b) => a.x - b.x);

  const notes: string[] = [];
  notes.push(`Strategy: ${strategy}`);
  notes.push(`Difficulty: ${difficulty}`);
  notes.push(`Smoothing: ${tuning.note}`);
  if (latestDeath?.deathX !== undefined) {
    notes.push(`near death x=${Math.round(latestDeath.deathX)}`);
  }
  const lastSuccessLanding = latestSuccess?.landings.slice(-1)[0];
  if (lastSuccessLanding) {
    notes.push(`near landing x=${Math.round(lastSuccessLanding.x)}`);
  }
  notes.push(`Generated ${obstacles.length} obstacle(s)`);

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
      strategy,
      patterns: placed.usedPatterns,
      variants: placed.usedVariants,
      antiRepeat: antiRepeatNotes,
      density: composition.density,
      attempted: selected.length,
      dropped: placed.droppedVariants,
      difficulty,
      safeJumpDistance: variantCtx.safeJumpDistance,
      maxJumpDistance: variantCtx.maxJumpDistance,
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

function worldWidthForLevel(levelIndex: number, canvasWidth: number): number {
  const raw = Math.round(canvasWidth * 2.7);
  if (levelIndex >= 8) return clamp(raw + 900, 4200, 6000);
  if (levelIndex >= 5) return clamp(raw + 500, 3400, 5200);
  if (levelIndex >= 3) return clamp(raw + 250, 2800, 4200);
  return clamp(raw, 2200, 3200);
}

function evaluatePerformance(sourceRuns: RunData[]): PerformanceTuning {
  if (sourceRuns.length === 0) {
    return {
      zoneDelta: 0,
      spacingAdjust: 0,
      advancedReduction: 0,
      note: 'baseline',
    };
  }

  const recent = sourceRuns.slice(-5);
  const deaths = recent.filter((r) => !r.completed).length;
  const deathRate = deaths / recent.length;
  const latestSuccess = [...recent].reverse().find((r) => r.completed);
  const clearedQuickly = !!latestSuccess && latestSuccess.attemptNumber <= 2 && deathRate <= 0.25;

  if (deathRate >= 0.65) {
    return {
      zoneDelta: -1,
      spacingAdjust: 24,
      advancedReduction: 1,
      note: 'struggle-high (density down, spacing up)',
    };
  }
  if (deathRate >= 0.45) {
    return {
      zoneDelta: -1,
      spacingAdjust: 14,
      advancedReduction: 1,
      note: 'struggle-medium (slightly forgiving)',
    };
  }
  if (clearedQuickly) {
    return {
      zoneDelta: 1,
      spacingAdjust: -10,
      advancedReduction: 0,
      note: 'clear-fast (density up)',
    };
  }

  return {
    zoneDelta: 0,
    spacingAdjust: 0,
    advancedReduction: 0,
    note: 'balanced',
  };
}

function compositionForLevel(
  levelIndex: number,
  difficulty: Difficulty,
  zoneDelta: number,
  advancedReduction: number,
): CompositionPlan {
  let minZones = 3;
  let maxZones = 3;
  let density: DensityLabel = 'low';
  let minAdvanced = 0;
  let minCombo = 0;

  if (difficulty === 'medium') {
    minZones = 3;
    maxZones = 4;
    density = 'medium';
    minAdvanced = 1;
    minCombo = 1;
  } else if (difficulty === 'hard') {
    minZones = 4;
    maxZones = 5;
    density = 'high';
    minAdvanced = 2;
    minCombo = 2;
  } else if (difficulty === 'expert') {
    minZones = 5;
    maxZones = 7;
    density = 'extreme';
    minAdvanced = 3;
    minCombo = 3;
  }

  const spread = maxZones - minZones;
  const deterministicOffset = spread > 0 ? ((levelIndex + 1) % (spread + 1)) : 0;
  const baseZones = minZones + deterministicOffset;
  const zoneCount = clampInt(baseZones + zoneDelta, minZones, maxZones);

  return {
    zoneCount,
    density,
    minAdvanced: Math.max(0, minAdvanced - advancedReduction),
    minCombo: Math.max(0, minCombo - advancedReduction),
  };
}

function buildPatternPlan(
  strategy: Strategy,
  zoneCount: number,
  levelIndex: number,
  difficulty: Difficulty,
  minAdvanced: number,
  minCombo: number,
): PatternKind[] {
  const plan: PatternKind[] = [...requiredKindsForProgression(levelIndex)];
  const pool = strategyPool(strategy, difficulty);

  let i = 0;
  while (plan.length < zoneCount) {
    plan.push(pool[i % pool.length]);
    i++;
  }

  enforceCount(plan, isAdvancedPattern, minAdvanced, ['stepGap', 'staircase', 'pressureSequence', 'choiceObstacle']);
  enforceCount(plan, isComboPattern, minCombo, ['pressureSequence', 'jumpThenCrouch', 'crouchThenJump', 'stepGap', 'choiceObstacle']);

  return plan.slice(0, zoneCount);
}

function requiredKindsForProgression(levelIndex: number): PatternKind[] {
  const out: PatternKind[] = [];
  if (levelIndex >= 1) out.push('lowCeiling');
  if (levelIndex >= 2) out.push('doubleSpike');
  if (levelIndex >= 3) out.push('choiceObstacle');
  if (levelIndex >= 4) out.push('stepGap');
  if (levelIndex >= 5) out.push('staircase');
  return out;
}

function strategyPool(strategy: Strategy, difficulty: Difficulty): PatternKind[] {
  switch (strategy) {
    case 'punishJumpBias':
      return difficulty === 'easy'
        ? ['lowCeiling', 'choiceObstacle', 'doubleSpike', 'jumpThenCrouch']
        : ['lowCeiling', 'choiceObstacle', 'crouchThenJump', 'pressureSequence', 'staircase'];
    case 'punishCrouchBias':
      return difficulty === 'easy'
        ? ['wideGap', 'doubleSpike', 'jumpThenCrouch', 'stepGap']
        : ['wideGap', 'stepGap', 'pressureSequence', 'doubleSpike', 'staircase'];
    case 'punishPredictability':
      return ['choiceObstacle', 'pressureSequence', 'stepGap', 'staircase', 'jumpThenCrouch', 'crouchThenJump'];
    case 'punishLateReactions':
      return ['doubleSpike', 'pressureSequence', 'jumpThenCrouch', 'lowCeiling', 'choiceObstacle'];
    case 'balancedEscalation':
      return ['doubleSpike', 'lowCeiling', 'stepGap', 'choiceObstacle', 'pressureSequence', 'staircase', 'wideGap'];
  }
}

function enforceCount(
  plan: PatternKind[],
  predicate: (kind: PatternKind) => boolean,
  minCount: number,
  replacementPool: PatternKind[],
) {
  let count = plan.filter(predicate).length;
  let cursor = 0;
  for (let i = plan.length - 1; i >= 0 && count < minCount; i--) {
    if (predicate(plan[i])) continue;
    plan[i] = replacementPool[cursor % replacementPool.length];
    cursor++;
    count++;
  }
}

function isAdvancedPattern(kind: PatternKind): boolean {
  return kind === 'stepGap' || kind === 'staircase' || kind === 'pressureSequence' || kind === 'choiceObstacle';
}

function isComboPattern(kind: PatternKind): boolean {
  return kind === 'pressureSequence' || kind === 'jumpThenCrouch' || kind === 'crouchThenJump' || kind === 'choiceObstacle' || kind === 'stepGap';
}

function collectRecentVariantMemory(runs: RunData[], levelWindow: number): string[] {
  const out: string[] = [];
  const seenLevels = new Set<number>();

  for (let i = runs.length - 1; i >= 0 && seenLevels.size < levelWindow; i--) {
    const run = runs[i];
    if (!run.generatedVariants || run.generatedVariants.length === 0) continue;
    if (seenLevels.has(run.levelIndex)) continue;
    seenLevels.add(run.levelIndex);
    out.push(...run.generatedVariants);
  }

  return out;
}

function selectVariantsForPlan(
  kinds: PatternKind[],
  ctx: VariantContext,
  recentMemory: string[],
  antiRepeatNotes: string[],
  levelIndex: number,
): SelectedVariant[] {
  const selected: SelectedVariant[] = [];
  const usedThisLevel = new Set<string>();

  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    const chosen = chooseVariant(kind, ctx, recentMemory, usedThisLevel, levelIndex + i, antiRepeatNotes);
    selected.push({ kind, variant: chosen });
    usedThisLevel.add(chosen.name);
  }

  return selected;
}

function chooseVariant(
  kind: PatternKind,
  ctx: VariantContext,
  recentMemory: string[],
  usedThisLevel: Set<string>,
  seed: number,
  antiRepeatNotes: string[],
): PatternVariant {
  const candidates = variantsForKind(kind, ctx).filter((v) => v.difficulties.includes(ctx.difficulty));

  const available = candidates.filter((v) => !usedThisLevel.has(v.name));
  const nonRepeat = available.filter((v) => !recentMemory.includes(v.name));

  if (nonRepeat.length > 0) {
    const blocked = available.filter((v) => recentMemory.includes(v.name)).map((v) => v.name);
    if (blocked.length > 0) {
      antiRepeatNotes.push(`avoided ${blocked[0]}`);
    }
    return deterministicPick(nonRepeat, seed);
  }

  if (available.length > 0) {
    const forced = deterministicPick(available, seed);
    antiRepeatNotes.push(`forced repeat ${forced.name}`);
    return forced;
  }

  return deterministicPick(candidates, seed);
}

function variantsForKind(kind: PatternKind, ctx: VariantContext): PatternVariant[] {
  switch (kind) {
    case 'singleSpike':
      return [
        {
          name: 'singleSpike_standard',
          kind,
          difficulties: ['easy', 'medium', 'hard', 'expert'],
          advanced: false,
          combo: false,
          firstKind: 'spike',
          build: (x) => [{ kind: 'spike', x, width: SPIKE_W, height: SPIKE_H }],
        },
      ];

    case 'doubleSpike': {
      const shortGap = clampInt(ctx.reactionSpacing - 30, 130, 230);
      const ceilW = clampInt(LOW_CEILING_MIN_W + ctx.levelIndex * 8, LOW_CEILING_MIN_W, LOW_CEILING_MAX_W);
      const afterGapW = clampInt(ctx.safeJumpDistance * 0.68, GAP_MIN_W, GAP_MAX_W);
      return [
        {
          name: 'doubleSpike_standard',
          kind,
          difficulties: ['easy', 'medium', 'hard', 'expert'],
          advanced: false,
          combo: false,
          firstKind: 'doubleSpike',
          build: (x) => [{ kind: 'doubleSpike', x, width: DOUBLE_SPIKE_W, height: DOUBLE_SPIKE_H }],
        },
        {
          name: 'doubleSpike_wide',
          kind,
          difficulties: ['medium', 'hard', 'expert'],
          advanced: true,
          combo: false,
          firstKind: 'doubleSpike',
          build: (x) => [{ kind: 'doubleSpike', x, width: 126, height: DOUBLE_SPIKE_H }],
        },
        {
          name: 'doubleSpike_afterGap',
          kind,
          difficulties: ['hard', 'expert'],
          advanced: true,
          combo: true,
          firstKind: 'gap',
          build: (x) => [
            { kind: 'gap', x, width: afterGapW, height: 0 },
            { kind: 'doubleSpike', x: x + afterGapW + shortGap, width: DOUBLE_SPIKE_W, height: DOUBLE_SPIKE_H },
          ],
        },
        {
          name: 'doubleSpike_beforeLowCeiling',
          kind,
          difficulties: ['medium', 'hard', 'expert'],
          advanced: true,
          combo: true,
          firstKind: 'doubleSpike',
          build: (x) => [
            { kind: 'doubleSpike', x, width: DOUBLE_SPIKE_W, height: DOUBLE_SPIKE_H },
            { kind: 'lowCeiling', x: x + DOUBLE_SPIKE_W + shortGap, width: ceilW, height: LOW_CEILING_CLEARANCE },
          ],
        },
      ];
    }

    case 'choiceObstacle': {
      const comboGap = clampInt(ctx.reactionSpacing, 140, 250);
      const gapW = clampInt(ctx.safeJumpDistance * 0.62, GAP_MIN_W, GAP_MAX_W);
      const ceilW = clampInt(LOW_CEILING_MIN_W + ctx.levelIndex * 9, LOW_CEILING_MIN_W, LOW_CEILING_MAX_W);
      return [
        {
          name: 'choice_single',
          kind,
          difficulties: ['easy', 'medium', 'hard', 'expert'],
          advanced: false,
          combo: false,
          firstKind: 'choiceObstacle',
          build: (x) => [{ kind: 'choiceObstacle', x, width: CHOICE_OBS_W, height: CHOICE_OBS_H }],
        },
        {
          name: 'choice_then_spike',
          kind,
          difficulties: ['medium', 'hard', 'expert'],
          advanced: true,
          combo: true,
          firstKind: 'choiceObstacle',
          build: (x) => [
            { kind: 'choiceObstacle', x, width: CHOICE_OBS_W, height: CHOICE_OBS_H },
            { kind: 'spike', x: x + CHOICE_OBS_W + comboGap, width: SPIKE_W, height: SPIKE_H },
          ],
        },
        {
          name: 'choice_then_gap',
          kind,
          difficulties: ['hard', 'expert'],
          advanced: true,
          combo: true,
          firstKind: 'choiceObstacle',
          build: (x) => [
            { kind: 'choiceObstacle', x, width: CHOICE_OBS_W, height: CHOICE_OBS_H },
            { kind: 'gap', x: x + CHOICE_OBS_W + comboGap, width: gapW, height: 0 },
          ],
        },
        {
          name: 'choice_then_lowCeiling',
          kind,
          difficulties: ['hard', 'expert'],
          advanced: true,
          combo: true,
          firstKind: 'choiceObstacle',
          build: (x) => [
            { kind: 'choiceObstacle', x, width: CHOICE_OBS_W, height: CHOICE_OBS_H },
            { kind: 'lowCeiling', x: x + CHOICE_OBS_W + comboGap, width: ceilW, height: LOW_CEILING_CLEARANCE },
          ],
        },
      ];
    }

    case 'pressureSequence': {
      const short = clampInt(ctx.reactionSpacing - 28, 125, 220);
      const mid = clampInt(ctx.reactionSpacing, 140, 250);
      const gapW = clampInt(ctx.safeJumpDistance * 0.58, GAP_MIN_W, GAP_MAX_W);
      const ceilW = clampInt(LOW_CEILING_MIN_W + ctx.levelIndex * 7, LOW_CEILING_MIN_W, LOW_CEILING_MAX_W);
      return [
        {
          name: 'pressure_spike_spike',
          kind,
          difficulties: ['medium', 'hard', 'expert'],
          advanced: true,
          combo: true,
          firstKind: 'spike',
          build: (x) => [
            { kind: 'spike', x, width: SPIKE_W, height: SPIKE_H },
            { kind: 'spike', x: x + SPIKE_W + short, width: SPIKE_W, height: SPIKE_H },
          ],
        },
        {
          name: 'pressure_spike_lowCeiling',
          kind,
          difficulties: ['hard', 'expert'],
          advanced: true,
          combo: true,
          firstKind: 'spike',
          build: (x) => [
            { kind: 'spike', x, width: SPIKE_W, height: SPIKE_H },
            { kind: 'lowCeiling', x: x + SPIKE_W + mid, width: ceilW, height: LOW_CEILING_CLEARANCE },
          ],
        },
        {
          name: 'pressure_lowCeiling_spike',
          kind,
          difficulties: ['hard', 'expert'],
          advanced: true,
          combo: true,
          firstKind: 'lowCeiling',
          build: (x) => [
            { kind: 'lowCeiling', x, width: ceilW, height: LOW_CEILING_CLEARANCE },
            { kind: 'spike', x: x + ceilW + short, width: SPIKE_W, height: SPIKE_H },
          ],
        },
        {
          name: 'pressure_gap_lowCeiling_spike',
          kind,
          difficulties: ['expert'],
          advanced: true,
          combo: true,
          firstKind: 'gap',
          build: (x) => [
            { kind: 'gap', x, width: gapW, height: 0 },
            { kind: 'lowCeiling', x: x + gapW + short, width: ceilW, height: LOW_CEILING_CLEARANCE },
            { kind: 'spike', x: x + gapW + short + ceilW + short, width: SPIKE_W, height: SPIKE_H },
          ],
        },
      ];
    }

    case 'stepGap':
      return stepGapVariants(ctx);

    case 'staircase':
      return staircaseVariants(ctx);

    case 'lowCeiling': {
      const wShort = clampInt(LOW_CEILING_MIN_W + ctx.levelIndex * 6, LOW_CEILING_MIN_W, LOW_CEILING_MAX_W);
      const wLong = clampInt(wShort + 42, LOW_CEILING_MIN_W, LOW_CEILING_MAX_W);
      return [
        {
          name: 'lowCeiling_short',
          kind,
          difficulties: ['easy', 'medium', 'hard', 'expert'],
          advanced: false,
          combo: false,
          firstKind: 'lowCeiling',
          build: (x) => [{ kind: 'lowCeiling', x, width: wShort, height: LOW_CEILING_CLEARANCE }],
        },
        {
          name: 'lowCeiling_long',
          kind,
          difficulties: ['medium', 'hard', 'expert'],
          advanced: true,
          combo: false,
          firstKind: 'lowCeiling',
          build: (x) => [{ kind: 'lowCeiling', x, width: wLong, height: LOW_CEILING_CLEARANCE }],
        },
      ];
    }

    case 'wideGap': {
      const easyGap = clampInt(ctx.safeJumpDistance * 0.55, GAP_MIN_W, GAP_MAX_W);
      const longGap = clampInt(ctx.safeJumpDistance * 0.78, GAP_MIN_W, GAP_MAX_W);
      return [
        {
          name: 'wideGap_safe',
          kind,
          difficulties: ['easy', 'medium', 'hard', 'expert'],
          advanced: false,
          combo: false,
          firstKind: 'gap',
          build: (x) => [{ kind: 'gap', x, width: easyGap, height: 0 }],
        },
        {
          name: 'wideGap_long',
          kind,
          difficulties: ['hard', 'expert'],
          advanced: true,
          combo: false,
          firstKind: 'gap',
          build: (x) => [{ kind: 'gap', x, width: longGap, height: 0 }],
        },
      ];
    }

    case 'jumpThenCrouch': {
      const gap = clampInt(ctx.reactionSpacing, 140, 250);
      const ceilW = clampInt(LOW_CEILING_MIN_W + ctx.levelIndex * 8, LOW_CEILING_MIN_W, LOW_CEILING_MAX_W);
      return [
        {
          name: 'jumpThenCrouch_standard',
          kind,
          difficulties: ['easy', 'medium', 'hard', 'expert'],
          advanced: true,
          combo: true,
          firstKind: 'spike',
          build: (x) => [
            { kind: 'spike', x, width: SPIKE_W, height: SPIKE_H },
            { kind: 'lowCeiling', x: x + SPIKE_W + gap, width: ceilW, height: LOW_CEILING_CLEARANCE },
          ],
        },
      ];
    }

    case 'crouchThenJump': {
      const gap = clampInt(ctx.reactionSpacing, 140, 250);
      const ceilW = clampInt(LOW_CEILING_MIN_W + ctx.levelIndex * 8, LOW_CEILING_MIN_W, LOW_CEILING_MAX_W);
      return [
        {
          name: 'crouchThenJump_standard',
          kind,
          difficulties: ['medium', 'hard', 'expert'],
          advanced: true,
          combo: true,
          firstKind: 'lowCeiling',
          build: (x) => [
            { kind: 'lowCeiling', x, width: ceilW, height: LOW_CEILING_CLEARANCE },
            { kind: 'spike', x: x + ceilW + gap, width: SPIKE_W, height: SPIKE_H },
          ],
        },
      ];
    }
  }
}

function stepGapVariants(ctx: VariantContext): PatternVariant[] {
  const baseStep = clampInt(ctx.maxJumpDistance * 0.52, 86, ctx.maxJumpDistance - 28);
  const [h1, h2, h3] = calculateStepGapHeights();

  return [
    {
      name: 'stepGap_easy_2platforms',
      kind: 'stepGap',
      difficulties: ['easy'],
      advanced: false,
      combo: true,
      firstKind: 'gap',
      build: (x) => buildGapWithPlatforms(
        x,
        [92, 92],
        [Math.max(10, h1 - 6), Math.max(14, h2 - 10)],
        [Math.round(baseStep * 0.72), Math.round(baseStep * 0.88), Math.round(baseStep * 0.70)],
      ),
    },
    {
      name: 'stepGap_medium_3platforms',
      kind: 'stepGap',
      difficulties: ['medium'],
      advanced: true,
      combo: true,
      firstKind: 'gap',
      build: (x) => buildGapWithPlatforms(
        x,
        [84, 82, 84],
        [h1, h2, h1],
        [Math.round(baseStep * 0.78), Math.round(baseStep * 0.92), Math.round(baseStep * 0.92), Math.round(baseStep * 0.76)],
      ),
    },
    {
      name: 'stepGap_hard_3platforms_raised',
      kind: 'stepGap',
      difficulties: ['hard'],
      advanced: true,
      combo: true,
      firstKind: 'gap',
      build: (x) => {
        const longStep = clampInt(baseStep + 16, 96, ctx.maxJumpDistance - 18);
        return buildGapWithPlatforms(
          x,
          [76, 72, 76],
          [Math.max(h1 + 6, 22), Math.max(h3 + 2, 40), Math.max(h2, 30)],
          [Math.round(baseStep * 0.84), baseStep, longStep, Math.round(baseStep * 0.82)],
        );
      },
    },
    {
      name: 'stepGap_expert_4platforms_mixedHeights',
      kind: 'stepGap',
      difficulties: ['expert'],
      advanced: true,
      combo: true,
      firstKind: 'gap',
      build: (x) => {
        const longStep = clampInt(baseStep + 24, 104, ctx.maxJumpDistance - 12);
        return buildGapWithPlatforms(
          x,
          [68, 64, 68, 74],
          [Math.max(h1, 20), Math.max(h3 + 8, 48), Math.max(h2 - 2, 24), Math.max(h3 + 12, 56)],
          [Math.round(baseStep * 0.82), baseStep, longStep, Math.round(baseStep * 0.9), Math.round(baseStep * 0.76)],
        );
      },
    },
  ];
}

function staircaseVariants(ctx: VariantContext): PatternVariant[] {
  const [s1, s2, s3, s4] = calculateStaircaseHeights();
  const baseStep = clampInt(ctx.maxJumpDistance * 0.46, 76, ctx.maxJumpDistance - 34);

  return [
    {
      name: 'staircase_easy_3steps',
      kind: 'staircase',
      difficulties: ['easy'],
      advanced: false,
      combo: true,
      firstKind: 'gap',
      build: (x) => buildGapWithPlatforms(
        x,
        [86, 84, 82],
        [Math.max(s1 - 8, 18), Math.max(s2 - 8, 28), Math.max(s3 - 8, 40)],
        [Math.round(baseStep * 0.70), baseStep, baseStep, Math.round(baseStep * 0.72)],
      ),
    },
    {
      name: 'staircase_medium_4steps',
      kind: 'staircase',
      difficulties: ['medium'],
      advanced: true,
      combo: true,
      firstKind: 'gap',
      build: (x) => buildGapWithPlatforms(
        x,
        [80, 78, 76, 74],
        [Math.max(s1 - 4, 22), Math.max(s2 - 4, 32), Math.max(s3 - 4, 44), Math.max(s4 - 4, 56)],
        [Math.round(baseStep * 0.72), baseStep, baseStep, baseStep, Math.round(baseStep * 0.68)],
      ),
    },
    {
      name: 'staircase_hard_ascendingThenDrop',
      kind: 'staircase',
      difficulties: ['hard'],
      advanced: true,
      combo: true,
      firstKind: 'gap',
      build: (x) => buildGapWithPlatforms(
        x,
        [76, 74, 74, 78],
        [Math.max(s1, 24), Math.max(s3 - 2, 46), Math.max(s4 + 2, 60), Math.max(s2 - 2, 32)],
        [Math.round(baseStep * 0.78), baseStep, Math.round(baseStep * 1.05), baseStep, Math.round(baseStep * 0.74)],
      ),
    },
    {
      name: 'staircase_expert_splitSteps',
      kind: 'staircase',
      difficulties: ['expert'],
      advanced: true,
      combo: true,
      firstKind: 'gap',
      build: (x) => {
        const split = clampInt(baseStep + 26, 104, ctx.maxJumpDistance - 10);
        const seq = buildGapWithPlatforms(
          x,
          [72, 70, 66, 70, 74],
          [Math.max(s1 - 2, 24), Math.max(s2 + 2, 38), Math.max(s1, 28), Math.max(s3 + 6, 56), Math.max(s2 + 8, 44)],
          [Math.round(baseStep * 0.74), baseStep, split, baseStep, Math.round(baseStep * 0.96), Math.round(baseStep * 0.7)],
        );
        const end = Math.max(...seq.map((o) => o.x + o.width));
        seq.push({ kind: 'spike', x: end + clampInt(ctx.reactionSpacing - 34, 120, 200), width: SPIKE_W, height: SPIKE_H });
        return seq;
      },
    },
  ];
}

function buildGapWithPlatforms(
  startX: number,
  platformWidths: number[],
  platformHeights: number[],
  edgeGaps: number[],
): Obstacle[] {
  const safeWidths = platformWidths.map((w) => clampInt(w, 56, 110));
  const safeHeights = platformHeights.map((h) => clampInt(h, 8, 92));
  const safeEdges = edgeGaps.map((g) => clampInt(g, 54, 190));

  const gapWidth = safeWidths.reduce((a, b) => a + b, 0) + safeEdges.reduce((a, b) => a + b, 0);
  const out: Obstacle[] = [{ kind: 'gap', x: startX, width: gapWidth, height: 0 }];

  let cursor = startX + safeEdges[0];
  for (let i = 0; i < safeWidths.length; i++) {
    out.push({ kind: 'platform', x: cursor, width: safeWidths[i], height: safeHeights[i] });
    cursor += safeWidths[i] + safeEdges[i + 1];
  }

  return out;
}

function placeSelectedVariants(
  selected: SelectedVariant[],
  carried: Obstacle[],
  variantCtx: VariantContext,
  levelIndex: number,
  ctx: GenerationContext,
  baseSpacing: number,
): PlaceResult {
  const placedExternal: Obstacle[] = [...carried].sort((a, b) => a.x - b.x);
  const obstacles: Obstacle[] = [];
  const usedPatterns: string[] = [];
  const usedVariants: string[] = [];
  const droppedVariants: string[] = [];

  const n = Math.min(selected.length, MAX_NEW_PATTERNS);
  const challengeSpace = ctx.pathEnd - ctx.pathStart;

  for (let i = 0; i < n; i++) {
    const sel = selected[i];
    const variant = sel.variant;
    const preview = variant.build(0, variantCtx);
    const width = measureObstacleWidth(preview, 0);

    const center = ctx.pathStart + Math.round((challengeSpace * (i + 1)) / (n + 1));
    const jitter = deterministicJitter(levelIndex * 97 + i * 41, 28);
    const idealStart = clamp(center - Math.floor(width / 2) + jitter, ctx.pathStart, ctx.pathEnd - width);

    const last = placedExternal[placedExternal.length - 1];
    const lastEnd = last ? last.x + last.width : ctx.pathStart;
    const minLeadGap = last ? requiredSpacing(last.kind, variant.firstKind, baseSpacing, levelIndex) : 0;
    const baseStart = Math.max(idealStart, lastEnd + minLeadGap);

    const tries = [baseStart, baseStart + 50, baseStart - 50, baseStart + 110, baseStart - 110, ctx.pathEnd - width - 20];

    let placed: Obstacle[] | null = null;
    for (const startX of tries) {
      if (startX < ctx.pathStart || startX + width > ctx.pathEnd) continue;
      const built = variant.build(Math.round(startX), variantCtx);
      if (!isPlacementSafe(built, placedExternal, baseSpacing, levelIndex, ctx.pathStart, ctx.pathEnd)) continue;
      placed = built;
      break;
    }

    if (!placed) {
      droppedVariants.push(variant.name);
      continue;
    }

    placedExternal.push(...placed);
    placedExternal.sort((a, b) => a.x - b.x);

    obstacles.push(...placed);
    usedPatterns.push(sel.kind);
    usedVariants.push(variant.name);
  }

  return {
    obstacles,
    usedPatterns,
    usedVariants,
    droppedVariants,
  };
}

function measureObstacleWidth(obstacles: Obstacle[], startX: number): number {
  let end = startX;
  for (const o of obstacles) {
    end = Math.max(end, o.x + o.width);
  }
  return Math.max(1, Math.round(end - startX));
}

function isPlacementSafe(
  candidate: Obstacle[],
  existing: Obstacle[],
  baseSpacing: number,
  levelIndex: number,
  pathStart: number,
  pathEnd: number,
): boolean {
  for (const obs of candidate) {
    if (obs.x < pathStart || obs.x + obs.width > pathEnd) return false;
    for (const ext of existing) {
      if (rectsOverlap(obs, ext)) return false;
      const gap = obs.x > ext.x
        ? obs.x - (ext.x + ext.width)
        : ext.x - (obs.x + obs.width);
      if (gap < requiredSpacing(ext.kind, obs.kind, baseSpacing, levelIndex)) return false;
    }
  }
  return true;
}

function carryForwardObstacles(
  ctx: GenerationContext,
  levelIndex: number,
  baseSpacing: number,
): Obstacle[] {
  const snapshot = ctx.latestRun?.obstaclesSnapshot;
  if (!snapshot || snapshot.length === 0) return [];

  const carryTarget = levelIndex >= 6 ? 2 : 1;
  const carryable = snapshot.filter((o) => o.kind !== 'gap' && o.kind !== 'platform');
  const sorted = [...carryable].sort((a, b) => a.x - b.x);
  const picked = sorted.slice(0, carryTarget);

  const carried: Obstacle[] = [];
  for (let i = 0; i < picked.length; i++) {
    const obs = normalizeObstacle(picked[i], levelIndex);
    const shift = 20 + i * 28;
    const x = clampInt(obs.x + shift, ctx.pathStart, ctx.pathEnd - obs.width);
    carried.push({ ...obs, x });
  }

  return enforceSafety(carried, levelIndex, ctx.pathEnd, baseSpacing);
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

function makeObstacle(kind: ObstacleKind, levelIndex: number): Obstacle {
  if (kind === 'gap') {
    return {
      kind,
      x: 0,
      width: clampInt(GAP_MIN_W + levelIndex * 4, GAP_MIN_W, GAP_MAX_W),
      height: 0,
    };
  }
  if (kind === 'lowCeiling') {
    return {
      kind,
      x: 0,
      width: clampInt(LOW_CEILING_MIN_W + levelIndex * 8, LOW_CEILING_MIN_W, LOW_CEILING_MAX_W),
      height: LOW_CEILING_CLEARANCE,
    };
  }
  if (kind === 'doubleSpike') return { kind, x: 0, width: DOUBLE_SPIKE_W, height: DOUBLE_SPIKE_H };
  if (kind === 'choiceObstacle') return { kind, x: 0, width: CHOICE_OBS_W, height: CHOICE_OBS_H };
  if (kind === 'platform') return { kind, x: 0, width: 74, height: 20 };
  return { kind: 'spike', x: 0, width: SPIKE_W, height: SPIKE_H };
}

function enforceSafety(obstacles: Obstacle[], levelIndex: number, pathEnd: number, baseSpacing: number): Obstacle[] {
  const safe: Obstacle[] = [];
  const sorted = [...obstacles].sort((a, b) => a.x - b.x);

  for (const obs of sorted) {
    const clamped = { ...obs, x: clampInt(obs.x, SAFE_SPAWN_END, pathEnd - obs.width) };
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
  const difficulty = levelDifficulty(levelIndex);
  const base = Math.max(120, baseSpacing);
  const overhead = (k: ObstacleKind) => k === 'lowCeiling' || k === 'choiceObstacle';
  const ground = (k: ObstacleKind) => k === 'spike' || k === 'doubleSpike' || k === 'gap';

  if ((overhead(prevKind) && ground(nextKind)) || (overhead(nextKind) && ground(prevKind))) {
    return clampInt(base + 34, 145, 280);
  }
  if (prevKind === 'gap' || nextKind === 'gap') {
    return clampInt(base + 18, 130, 260);
  }
  if (prevKind === 'platform' || nextKind === 'platform') {
    return clampInt(base * 0.55, 70, 180);
  }
  if (difficulty === 'expert') {
    return clampInt(base - 8, 120, 240);
  }
  return base;
}

function rectsOverlap(a: Obstacle, b: Obstacle): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x;
}

function deterministicJitter(seed: number, magnitude: number): number {
  const x = Math.sin(seed * 91.73) * 10000;
  const frac = x - Math.floor(x);
  return Math.round((frac * 2 - 1) * magnitude);
}

function deterministicPick<T>(items: T[], seed: number): T {
  const idx = Math.abs(seed) % items.length;
  return items[idx];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}
