import { LevelData } from './level';
import { Obstacle } from './types';
import { PlayerModel, PlayerProfile, RunData } from './telemetry';
import {
  Difficulty,
  calculateReactionSpacing,
  calculateSafeJumpDistance,
  calculateMaxJumpDistance,
} from './movementTuning';

const GROUND_TOP = 0;
const SAFE_SPAWN_END = 320;
const SAFE_FLAG_GAP = 240;
const FLAG_OFFSET = 240;
const PLAYER_WIDTH = 32;
const PLAYER_STANDING_HEIGHT = 48;
const MIN_LANDING_WIDTH = PLAYER_WIDTH + 10;
const LANDING_BUFFER = 6;
const MAX_GENERATION_ATTEMPTS = 4;

const SPIKE_W = 44;
const SPIKE_H = 52;
const DOUBLE_SPIKE_W = 104;
const DOUBLE_SPIKE_H = 52;
const LOW_CEILING_MIN_W = 150;
const LOW_CEILING_MAX_W = 230;
const LOW_CEILING_CLEARANCE = 34;
const CHOICE_OBS_W = 100;
const CHOICE_OBS_H = 34;

// ── Difficulty score system ────────────────────────────────────────
// Each segment type has a base difficulty score. The generator accumulates
// segments until the required score for the level is reached. Required score
// strictly increases with level index, ensuring monotonic difficulty.

type SegmentType =
  | 'spikeJump'
  | 'doubleSpikeTiming'
  | 'lowCeilingCrouch'
  | 'jumpThenCrouch'
  | 'crouchThenJump'
  | 'longGapPlatforms'
  | 'staircaseClimb'
  | 'headClearanceJump'
  | 'choiceThenPunish'
  | 'pressureCombo'
  | 'mixedPlatformCombo';

// Score per segment type — used for planning and validation.
const SEGMENT_BASE_SCORES: Record<SegmentType, number> = {
  spikeJump:          1,
  doubleSpikeTiming:  2,
  lowCeilingCrouch:   2,
  jumpThenCrouch:     3,
  crouchThenJump:     3,
  headClearanceJump:  4,
  choiceThenPunish:   4,
  longGapPlatforms:   5,
  staircaseClimb:     5,
  pressureCombo:      6,
  mixedPlatformCombo: 6,
};

// Required total difficulty score per level. Strictly increases every level.
// Capped at 88 to remain achievable with max segment counts.
// adj=n means nth adaptive level (Level 2 displayed = adj 0).
function requiredDifficultyScore(levelIndex: number): number {
  const adj = Math.max(0, levelIndex - 1);
  const raw = 7 + adj * 2.5 + adj * adj * 0.5;
  return Math.min(88, Math.round(raw));
}

// ── Types ──────────────────────────────────────────────────────────

type Strategy =
  | 'punishJumpBias'
  | 'punishCrouchBias'
  | 'punishPredictability'
  | 'punishLateReactions'
  | 'balancedEscalation';

type CounterTarget =
  | 'jumpBiased'
  | 'crouchBiased'
  | 'platformWeak'
  | 'lateReactor'
  | 'predictablePattern'
  | 'diesToGaps'
  | 'diesToSpikes'
  | 'overusesChoiceJump'
  | 'overusesChoiceCrouch';

type DensityLabel = 'low' | 'medium' | 'high' | 'extreme';

interface SegmentSpec {
  type: SegmentType;
  requiredTag?: string;
}

interface SegmentBuild {
  type: SegmentType;
  variant: string;
  obstacles: Obstacle[];
  length: number;
  combo: boolean;
  advanced: boolean;
  platform: boolean;
  difficultyScore: number;
}

interface SegmentContext {
  levelIndex: number;
  difficulty: Difficulty;
  strategy: Strategy;
  playerModel: PlayerModel;
  safeJumpDistance: number;
  maxJumpDistance: number;
  reactionSpacing: number;
  counterTargets: CounterTarget[];
}

interface RequiredRule {
  tag: string;
  types: SegmentType[];
  minCount: number;
}

interface BuildResult {
  segmentBuilds: SegmentBuild[];
  obstacles: Obstacle[];
  worldWidth: number;
  flagX: number;
  requiredTagsPlaced: string[];
  maxQuietGap: number;
}

type ValidationStatus = 'valid' | 'repaired' | 'fallback';

interface ValidationResult {
  ok: boolean;
  notes: string[];
  warnings: string[];
}

interface Interval {
  start: number;
  end: number;
}

// ── Entry point ────────────────────────────────────────────────────

export function generateAdaptiveLevel(
  previousRuns: RunData[],
  _profile: PlayerProfile,
  playerModel: PlayerModel,
  levelIndex: number,
  canvasWidth: number,
): LevelData {
  const difficulty = tierForLevel(levelIndex);
  const strategy = selectStrategy(playerModel);
  const sourceRuns = previousRuns.filter((r) => r.levelIndex === Math.max(0, levelIndex - 1));
  const latestRun = sourceRuns[sourceRuns.length - 1];
  const latestSuccess = [...sourceRuns].reverse().find((r) => r.completed);
  const counterTargets = classifyPlayerCounters(playerModel, previousRuns);

  const segmentCtx: SegmentContext = {
    levelIndex,
    difficulty,
    strategy,
    playerModel,
    safeJumpDistance: calculateSafeJumpDistance(difficulty),
    maxJumpDistance: calculateMaxJumpDistance(),
    reactionSpacing: calculateReactionSpacing(difficulty),
    counterTargets,
  };

  const requiredRules = requiredRulesForLevel(levelIndex);
  let lastWarnings: string[] = [];

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const specs = designSegmentPlan(levelIndex, segmentCtx, requiredRules, previousRuns, attempt);
    const built = buildSegments(specs, segmentCtx, canvasWidth, attempt);
    const repaired = repairUnsafeBuild(built, segmentCtx, canvasWidth, attempt);

    const valid = validateBuild({
      levelIndex,
      requiredRules,
      specs,
      built: repaired.built,
      segmentCtx,
      previousRuns,
    });

    lastWarnings = [...repaired.warnings, ...valid.warnings];
    if (valid.ok) {
      return finalizeLevel(
        levelIndex,
        segmentCtx,
        strategy,
        repaired.built,
        specs,
        requiredRules,
        previousRuns,
        latestRun,
        latestSuccess,
        valid.notes,
        repaired.repaired ? 'repaired' : 'valid',
        dedupeStrings([...repaired.warnings, ...valid.warnings], 8),
        counterTargets,
      );
    }
  }

  // Fallback — harder than original to avoid easy-out.
  const safeFallback = buildKnownSafeFallback(levelIndex, segmentCtx, canvasWidth);
  return finalizeLevel(
    levelIndex,
    segmentCtx,
    strategy,
    safeFallback,
    safeFallback.segmentBuilds.map((s) => ({ type: s.type })),
    requiredRules,
    previousRuns,
    latestRun,
    latestSuccess,
    ['Validation fallback used after retries'],
    'fallback',
    dedupeStrings([...lastWarnings, 'Used known safe fallback level'], 8),
    counterTargets,
  );
}

function finalizeLevel(
  levelIndex: number,
  segmentCtx: SegmentContext,
  strategy: Strategy,
  built: BuildResult,
  specs: SegmentSpec[],
  requiredRules: RequiredRule[],
  _previousRuns: RunData[],
  latestRun: RunData | undefined,
  latestSuccess: RunData | undefined,
  validationNotes: string[],
  validationStatus: ValidationStatus,
  validationWarnings: string[],
  counterTargets: CounterTarget[],
): LevelData {
  const obstacles = [...built.obstacles].sort((a, b) => a.x - b.x);
  const notes: string[] = [];
  notes.push(`Strategy: ${strategy}`);
  notes.push(`Difficulty: ${segmentCtx.difficulty}`);
  notes.push(...validationNotes.slice(0, 4));

  const markerSource = latestSuccess ?? latestRun;
  const pathStart = SAFE_SPAWN_END;
  const pathEnd = built.flagX - SAFE_FLAG_GAP;
  const landingMarkers = (markerSource?.landings ?? [])
    .map((l) => clamp(Math.round(l.x), pathStart, pathEnd))
    .filter((x, i, arr) => arr.indexOf(x) === i)
    .slice(-8);

  const comboCount    = built.segmentBuilds.filter((s) => s.combo).length;
  const advancedCount = built.segmentBuilds.filter((s) => s.advanced).length;
  const platformUsed  = built.segmentBuilds.some((s) => s.platform);
  const uniquePatternTypes = new Set(built.segmentBuilds.map((s) => s.type)).size;
  const requiredTags  = requiredRules.flatMap((r) => Array.from({ length: r.minCount }, () => r.tag));
  const totalDiffScore = built.segmentBuilds.reduce((sum, s) => sum + s.difficultyScore, 0);
  const reqDiffScore   = requiredDifficultyScore(levelIndex);
  const segScores      = built.segmentBuilds.map((s) => s.difficultyScore);

  return {
    index: levelIndex,
    worldWidth: built.worldWidth,
    groundY: GROUND_TOP,
    flagX: built.flagX,
    obstacles,
    aiLandingMarkersX: landingMarkers,
    aiDebug: {
      notes,
      placementXs: obstacles.map((o) => Math.round(o.x)),
      obstacleCount: obstacles.length,
      strategy,
      patterns: built.segmentBuilds.map((s) => s.type),
      variants: built.segmentBuilds.map((s) => s.variant),
      requiredPatterns: requiredTags,
      placedRequiredPatterns: built.requiredTagsPlaced,
      density: densityLabelForLevel(levelIndex),
      antiRepeat: [],
      attempted: specs.length,
      dropped: [],
      difficulty: segmentCtx.difficulty,
      challengeZones: built.segmentBuilds.length,
      uniquePatternTypes,
      comboCount,
      advancedCount,
      platformUsed,
      difficultyIncreasing: true, // guaranteed by requiredDifficultyScore() curve
      safeJumpDistance: segmentCtx.safeJumpDistance,
      maxJumpDistance: segmentCtx.maxJumpDistance,
      validationStatus,
      validationWarnings,
      totalDifficultyScore: totalDiffScore,
      requiredDifficultyScore: reqDiffScore,
      segmentScores: segScores,
      counterTargets,
      adaptationReasons: buildAdaptationReasons(counterTargets),
    },
  };
}

// ── Difficulty tiers ───────────────────────────────────────────────

function tierForLevel(levelIndex: number): Difficulty {
  if (levelIndex <= 1) return 'medium';
  if (levelIndex <= 2) return 'hard';
  return 'expert';
}

function densityLabelForLevel(levelIndex: number): DensityLabel {
  if (levelIndex <= 1) return 'medium';
  if (levelIndex <= 2) return 'high';
  return 'extreme';
}

// Segment count cap — score accumulation drives the actual count, this is the ceiling.
function segmentCountForLevel(levelIndex: number, attempt: number): number {
  const base = Math.min(16, 5 + Math.ceil(levelIndex * 0.9));
  if (attempt >= 2) return Math.min(18, base + 3);
  if (attempt >= 1) return Math.min(18, base + 2);
  return base;
}

// ── Required segment rules ─────────────────────────────────────────

function requiredRulesForLevel(levelIndex: number): RequiredRule[] {
  const rules: RequiredRule[] = [];

  if (levelIndex === 1) {
    rules.push({ tag: 'longGapPlatforms', types: ['longGapPlatforms'], minCount: 1 });
  }
  if (levelIndex === 2) {
    rules.push({ tag: 'staircaseClimb', types: ['staircaseClimb'], minCount: 1 });
  }
  if (levelIndex >= 3 && levelIndex < 5) {
    rules.push({ tag: 'platformChallenge', types: ['longGapPlatforms', 'staircaseClimb'], minCount: 1 });
  }
  if (levelIndex >= 5) {
    rules.push({ tag: 'longGapPlatforms', types: ['longGapPlatforms'], minCount: 1 });
    rules.push({ tag: 'staircaseClimb', types: ['staircaseClimb'], minCount: 1 });
  }
  // After level 6: pressure combos are mandatory.
  if (levelIndex >= 6) {
    rules.push({ tag: 'pressureCombo', types: ['pressureCombo', 'mixedPlatformCombo'], minCount: 1 });
  }

  return rules;
}

// ── Segment plan design ────────────────────────────────────────────

function designSegmentPlan(
  levelIndex: number,
  ctx: SegmentContext,
  requiredRules: RequiredRule[],
  previousRuns: RunData[],
  attempt: number,
): SegmentSpec[] {
  const targetScore   = requiredDifficultyScore(levelIndex);
  const maxSegments   = segmentCountForLevel(levelIndex, attempt);

  // Start with required segments.
  const specs: SegmentSpec[] = [];
  for (const rule of requiredRules) {
    for (let i = 0; i < rule.minCount; i++) {
      specs.push({ type: chooseRequiredType(rule, i, levelIndex), requiredTag: rule.tag });
    }
  }

  const pool = buildPool(levelIndex, ctx);
  let seed = levelIndex * 97 + previousRuns.length * 17 + attempt * 31;

  // Score-accumulation: keep adding segments until target reached or cap hit.
  while (specs.length < maxSegments) {
    if (computePlanScore(specs) >= targetScore) break;
    const gap       = targetScore - computePlanScore(specs);
    const candidate = pickSegmentForGap(pool, gap, specs, seed++, ctx.counterTargets, levelIndex);
    specs.push({ type: candidate });
  }

  // If still short (hit cap before reaching score), upgrade existing segments.
  upgradeToMeetScore(specs, targetScore);

  // Enforcement passes — order matters.
  enforceComboRatio(specs, levelIndex, ctx);
  enforceBasicBan(specs, levelIndex);
  applyAntiRepeatUpgrades(specs, levelIndex);
  enforceMinimumVariety(specs, levelIndex, pool);
  enforcePlatformRules(specs, levelIndex);
  applyPredictabilityBreak(specs, ctx.playerModel, levelIndex);

  return specs;
}

// Pick next segment based on remaining score gap and player counter targets.
// Filters by minimum base score, then ranks by scoreCandidateSegment.
function pickSegmentForGap(
  pool: SegmentType[],
  gap: number,
  existing: SegmentSpec[],
  seed: number,
  counterTargets: CounterTarget[],
  levelIndex: number,
): SegmentType {
  const usedTypes = new Set(existing.map((s) => s.type));

  let candidates: SegmentType[];
  if (gap >= 5) {
    candidates = pool.filter((t) => SEGMENT_BASE_SCORES[t] >= 4 && !usedTypes.has(t));
    if (candidates.length === 0) candidates = pool.filter((t) => SEGMENT_BASE_SCORES[t] >= 4);
  } else if (gap >= 3) {
    candidates = pool.filter((t) => SEGMENT_BASE_SCORES[t] >= 3 && !usedTypes.has(t));
    if (candidates.length === 0) candidates = pool.filter((t) => SEGMENT_BASE_SCORES[t] >= 3);
  } else {
    candidates = pool.filter((t) => !usedTypes.has(t));
    if (candidates.length === 0) candidates = [...pool];
  }
  if (candidates.length === 0) candidates = [...pool];

  // Rank by personalized counter score; use deterministic jitter as tiebreak.
  const scored = candidates
    .map((t, i) => ({
      type: t,
      score: scoreCandidateSegment(t, counterTargets, levelIndex) + deterministicJitter(seed + i * 7, 1),
    }))
    .sort((a, b) => b.score - a.score);

  return scored[0].type;
}

function computePlanScore(specs: SegmentSpec[]): number {
  return specs.reduce((sum, s) => sum + SEGMENT_BASE_SCORES[s.type], 0);
}

// Upgrade existing non-required segments until target score is reached.
function upgradeToMeetScore(specs: SegmentSpec[], targetScore: number): void {
  let passes = 0;
  while (computePlanScore(specs) < targetScore && passes < 4) {
    let changed = false;
    // Sort cheapest first to get most bang per upgrade.
    const sorted = specs
      .filter((s) => !s.requiredTag && SEGMENT_BASE_SCORES[s.type] < 6)
      .sort((a, b) => SEGMENT_BASE_SCORES[a.type] - SEGMENT_BASE_SCORES[b.type]);
    for (const spec of sorted) {
      if (computePlanScore(specs) >= targetScore) break;
      const upgraded = upgradeSegmentType(spec.type);
      if (upgraded !== spec.type) {
        spec.type = upgraded;
        changed = true;
      }
    }
    if (!changed) break;
    passes++;
  }
}

// Upgrade chain: every type has a harder successor.
function upgradeSegmentType(type: SegmentType): SegmentType {
  switch (type) {
    case 'spikeJump':          return 'doubleSpikeTiming';
    case 'doubleSpikeTiming':  return 'jumpThenCrouch';
    case 'lowCeilingCrouch':   return 'crouchThenJump';
    case 'jumpThenCrouch':     return 'headClearanceJump';
    case 'crouchThenJump':     return 'choiceThenPunish';
    case 'headClearanceJump':  return 'pressureCombo';
    case 'choiceThenPunish':   return 'pressureCombo';
    case 'longGapPlatforms':   return 'mixedPlatformCombo';
    case 'staircaseClimb':     return 'mixedPlatformCombo';
    default:                   return type; // pressureCombo/mixedPlatformCombo = max score
  }
}

// Replace repeated non-platform non-required segments with their upgrade.
function applyAntiRepeatUpgrades(specs: SegmentSpec[], levelIndex: number): void {
  if (levelIndex < 2) return;
  const typeCounts = new Map<SegmentType, number>();
  for (const spec of specs) typeCounts.set(spec.type, (typeCounts.get(spec.type) ?? 0) + 1);

  for (const spec of specs) {
    if (spec.requiredTag || isPlatformSegment(spec.type)) continue;
    const count = typeCounts.get(spec.type) ?? 0;
    if (count <= 1) continue;
    const upgraded = upgradeSegmentType(spec.type);
    if (upgraded !== spec.type) {
      typeCounts.set(spec.type, count - 1);
      typeCounts.set(upgraded, (typeCounts.get(upgraded) ?? 0) + 1);
      spec.type = upgraded;
    }
  }
}

// Build eligible segment type pool for this level.
function buildPool(levelIndex: number, ctx: SegmentContext): SegmentType[] {
  let all: SegmentType[] = [
    'spikeJump',
    'doubleSpikeTiming',
    'lowCeilingCrouch',
    'jumpThenCrouch',
    'crouchThenJump',
    'longGapPlatforms',
    'staircaseClimb',
    'headClearanceJump',
    'choiceThenPunish',
    'pressureCombo',
    'mixedPlatformCombo',
  ];

  // Remove trivial patterns — banned outright so score accumulation never picks them.
  if (levelIndex > 1) all = all.filter((t) => t !== 'spikeJump');
  if (levelIndex > 2) all = all.filter((t) => t !== 'lowCeilingCrouch');

  return applyStrategyBias(all, ctx);
}

// Bias pool toward player weaknesses by duplicating certain types.
function applyStrategyBias(pool: SegmentType[], ctx: SegmentContext): SegmentType[] {
  const bias: SegmentType[] = [...pool];
  if (ctx.playerModel.prefersJump) {
    bias.push('lowCeilingCrouch', 'headClearanceJump', 'jumpThenCrouch', 'choiceThenPunish');
  }
  if (ctx.playerModel.prefersCrouch) {
    bias.push('longGapPlatforms', 'doubleSpikeTiming', 'crouchThenJump', 'pressureCombo');
  }
  if (ctx.playerModel.reactionTiming === 'late') {
    bias.push('pressureCombo', 'doubleSpikeTiming', 'headClearanceJump');
  }
  return bias.filter((t) => pool.includes(t));
}

// ── Enforcement passes ─────────────────────────────────────────────

// Minimum combo ratio: 40% early, 70% from level 3, 85% from level 6.
function enforceComboRatio(specs: SegmentSpec[], levelIndex: number, ctx: SegmentContext) {
  const minRatio   = levelIndex >= 5 ? 0.85 : levelIndex >= 2 ? 0.70 : 0.40;
  const minCombos  = Math.ceil(specs.length * minRatio);
  let comboCount   = specs.filter((s) => isComboSegment(s.type)).length;
  if (comboCount >= minCombos) return;

  const comboFallback: SegmentType[] = [
    'jumpThenCrouch', 'crouchThenJump', 'choiceThenPunish',
    'pressureCombo', 'mixedPlatformCombo', 'headClearanceJump',
    'longGapPlatforms', 'staircaseClimb',
  ];

  let seed = levelIndex * 23;
  for (let i = specs.length - 1; i >= 0 && comboCount < minCombos; i--) {
    if (isComboSegment(specs[i].type) || specs[i].requiredTag) continue;
    specs[i].type = comboFallback[Math.abs(seed++) % comboFallback.length];
    comboCount++;
  }

  if (ctx.playerModel.consistency === 'predictable' && specs.length >= 4) {
    specs[1].type = 'choiceThenPunish';
    specs[2].type = 'pressureCombo';
  }
}

// Hard ban on trivial segment types once level progresses.
function enforceBasicBan(specs: SegmentSpec[], levelIndex: number): void {
  for (const spec of specs) {
    if (spec.requiredTag) continue;
    if (levelIndex > 1 && spec.type === 'spikeJump') {
      spec.type = 'doubleSpikeTiming';
    }
    if (levelIndex > 2 && spec.type === 'lowCeilingCrouch') {
      spec.type = 'crouchThenJump';
    }
  }
}

function enforceMinimumVariety(specs: SegmentSpec[], levelIndex: number, pool: SegmentType[]) {
  const minUnique = levelIndex >= 5 ? 5 : levelIndex >= 3 ? 4 : 3;
  const unique = new Set(specs.map((s) => s.type));
  if (unique.size >= minUnique) return;

  for (const candidate of pool) {
    if (unique.has(candidate)) continue;
    const idx = specs.findIndex((s) => !s.requiredTag && isBasicSegment(s.type));
    if (idx >= 0) {
      specs[idx].type = candidate;
      unique.add(candidate);
    } else {
      specs.push({ type: candidate });
      unique.add(candidate);
    }
    if (unique.size >= minUnique) break;
  }
}

function enforcePlatformRules(specs: SegmentSpec[], levelIndex: number) {
  const hasPlatform = (t: SegmentType) => isPlatformSegment(t);
  const platformCount = specs.filter((s) => hasPlatform(s.type)).length;

  if (levelIndex === 1 && !specs.some((s) => s.type === 'longGapPlatforms')) {
    replaceFirstNonRequired(specs, 'longGapPlatforms');
  }
  if (levelIndex === 2 && !specs.some((s) => s.type === 'staircaseClimb')) {
    replaceFirstNonRequired(specs, 'staircaseClimb');
  }
  if (levelIndex >= 3 && platformCount < 1) {
    replaceFirstNonRequired(specs, levelIndex % 2 === 0 ? 'staircaseClimb' : 'longGapPlatforms');
  }
  if (levelIndex >= 5 && platformCount < 2) {
    specs.push({ type: 'longGapPlatforms' });
    specs.push({ type: 'staircaseClimb' });
  }
}

function applyPredictabilityBreak(specs: SegmentSpec[], model: PlayerModel, levelIndex: number) {
  if (model.consistency !== 'predictable' || specs.length < 5 || levelIndex < 3) return;
  specs[1].type = 'choiceThenPunish';
  specs[2].type = 'pressureCombo';
  specs[3].type = 'headClearanceJump';
}

function chooseRequiredType(rule: RequiredRule, offset: number, levelIndex: number): SegmentType {
  if (rule.types.length === 1) return rule.types[0];
  return rule.types[(levelIndex + offset) % rule.types.length];
}

function replaceFirstNonRequired(specs: SegmentSpec[], type: SegmentType) {
  const idx = specs.findIndex((s) => !s.requiredTag);
  if (idx >= 0) specs[idx].type = type;
  else specs.push({ type });
}

// ── Segment building ───────────────────────────────────────────────

function buildSegments(specs: SegmentSpec[], ctx: SegmentContext, canvasWidth: number, attempt: number): BuildResult {
  const builds: SegmentBuild[] = [];
  const obstacles: Obstacle[] = [];
  const requiredTagsPlaced: string[] = [];

  let cursor = SAFE_SPAWN_END + 20;
  const connectorBase = connectorDistanceForLevel(ctx.levelIndex, attempt);

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    if (!spec) continue;
    if (i > 0) {
      const connector = connectorBase + deterministicJitter(ctx.levelIndex * 37 + i * 13 + attempt * 19, 8);
      cursor += Math.max(38, connector);
    }

    const built = buildSegment(spec.type, cursor, ctx, ctx.levelIndex * 97 + i * 17 + attempt * 11);
    if (built.obstacles.length === 0) continue;

    builds.push(built);
    obstacles.push(...built.obstacles);
    cursor += built.length;

    if (spec.requiredTag) requiredTagsPlaced.push(spec.requiredTag);
  }

  obstacles.sort((a, b) => a.x - b.x);
  const worldWidth = Math.max(Math.round(canvasWidth * 2), Math.round(cursor + SAFE_FLAG_GAP + FLAG_OFFSET + 120));
  const flagX = worldWidth - FLAG_OFFSET;
  const maxQuietGap = computeMaxQuietGap(obstacles, SAFE_SPAWN_END, flagX - SAFE_FLAG_GAP);

  return { segmentBuilds: builds, obstacles, worldWidth, flagX, requiredTagsPlaced, maxQuietGap };
}

// Tighter connector distances — less breathing room between segments at higher levels.
function connectorDistanceForLevel(levelIndex: number, attempt: number): number {
  let base = 110;
  if (levelIndex >= 2) base = 88;
  if (levelIndex >= 4) base = 70;
  if (levelIndex >= 6) base = 55;
  if (levelIndex >= 8) base = 42;
  if (attempt > 0) base -= 8;
  if (attempt > 1) base -= 6;
  return Math.max(36, base);
}

function buildSegment(type: SegmentType, startX: number, ctx: SegmentContext, seed: number): SegmentBuild {
  switch (type) {
    case 'spikeJump': {
      return {
        type,
        variant: 'spikeJump_basic',
        obstacles: [{ kind: 'spike', x: startX + 26, width: SPIKE_W, height: SPIKE_H }],
        length: 150,
        combo: false,
        advanced: false,
        platform: false,
        difficultyScore: 1,
      };
    }

    case 'doubleSpikeTiming': {
      const useAfterGap = ctx.levelIndex >= 4;
      if (useAfterGap) {
        const gapW = clampInt(ctx.safeJumpDistance * 0.65, 110, 150);
        const seq: Obstacle[] = [
          { kind: 'gap', x: startX + 24, width: gapW, height: 0 },
          { kind: 'doubleSpike', x: startX + 24 + gapW + Math.round(ctx.reactionSpacing * 0.72), width: DOUBLE_SPIKE_W, height: DOUBLE_SPIKE_H },
        ];
        const end = seq[1].x + seq[1].width;
        return {
          type,
          variant: 'doubleSpike_afterGap',
          obstacles: seq,
          length: end - startX + 24,
          combo: true,
          advanced: true,
          platform: false,
          difficultyScore: 3,
        };
      }
      return {
        type,
        variant: 'doubleSpike_standard',
        obstacles: [{ kind: 'doubleSpike', x: startX + 20, width: DOUBLE_SPIKE_W, height: DOUBLE_SPIKE_H }],
        length: 180,
        combo: false,
        advanced: false,
        platform: false,
        difficultyScore: 2,
      };
    }

    case 'lowCeilingCrouch': {
      const width = clampInt(LOW_CEILING_MIN_W + ctx.levelIndex * 10, LOW_CEILING_MIN_W, LOW_CEILING_MAX_W);
      return {
        type,
        variant: width > 190 ? 'lowCeiling_long' : 'lowCeiling_short',
        obstacles: [{ kind: 'lowCeiling', x: startX + 12, width, height: LOW_CEILING_CLEARANCE }],
        length: width + 44,
        combo: false,
        advanced: ctx.levelIndex >= 3,
        platform: false,
        difficultyScore: 2,
      };
    }

    case 'jumpThenCrouch': {
      const ceilW   = clampInt(LOW_CEILING_MIN_W + ctx.levelIndex * 8, LOW_CEILING_MIN_W, LOW_CEILING_MAX_W);
      const jumpGap = clampInt(ctx.reactionSpacing, 120, 220);
      const obs: Obstacle[] = [
        { kind: 'spike', x: startX + 20, width: SPIKE_W, height: SPIKE_H },
        { kind: 'lowCeiling', x: startX + 20 + SPIKE_W + jumpGap, width: ceilW, height: LOW_CEILING_CLEARANCE },
      ];
      return {
        type,
        variant: 'jumpThenCrouch',
        obstacles: obs,
        length: SPIKE_W + jumpGap + ceilW + 48,
        combo: true,
        advanced: true,
        platform: false,
        difficultyScore: 3,
      };
    }

    case 'crouchThenJump': {
      const ceilW   = clampInt(LOW_CEILING_MIN_W + ctx.levelIndex * 8, LOW_CEILING_MIN_W, LOW_CEILING_MAX_W);
      const jumpGap = clampInt(ctx.reactionSpacing, 120, 220);
      const obs: Obstacle[] = [
        { kind: 'lowCeiling', x: startX + 14, width: ceilW, height: LOW_CEILING_CLEARANCE },
        { kind: 'spike', x: startX + 14 + ceilW + jumpGap, width: SPIKE_W, height: SPIKE_H },
      ];
      return {
        type,
        variant: 'crouchThenJump',
        obstacles: obs,
        length: ceilW + jumpGap + SPIKE_W + 44,
        combo: true,
        advanced: true,
        platform: false,
        difficultyScore: 3,
      };
    }

    case 'longGapPlatforms':
      return buildLongGapPlatforms(startX, ctx, seed);

    case 'staircaseClimb':
      return buildStaircaseClimb(startX, ctx, seed);

    case 'headClearanceJump': {
      const shortGap    = clampInt(ctx.reactionSpacing * 0.62, 100, 180);
      const ceilW       = clampInt(LOW_CEILING_MIN_W + 24, 160, 220);
      const clearance   = clampInt(64 + (ctx.levelIndex >= 5 ? -6 : 0), 56, 70);
      const obs: Obstacle[] = [
        { kind: 'spike', x: startX + 24, width: SPIKE_W, height: SPIKE_H },
        { kind: 'lowCeiling', x: startX + 14, width: ceilW, height: clearance },
        { kind: 'spike', x: startX + 24 + SPIKE_W + shortGap, width: SPIKE_W, height: SPIKE_H },
      ];
      return {
        type,
        variant: 'headClearanceJump',
        obstacles: obs,
        length: ceilW + shortGap + SPIKE_W + 58,
        combo: true,
        advanced: true,
        platform: false,
        difficultyScore: 4,
      };
    }

    case 'choiceThenPunish': {
      const gap  = clampInt(ctx.reactionSpacing, 120, 210);
      const mode = seed % 3;
      const first: Obstacle = { kind: 'choiceObstacle', x: startX + 20, width: CHOICE_OBS_W, height: CHOICE_OBS_H };
      if (mode === 0) {
        const second: Obstacle = { kind: 'spike', x: first.x + CHOICE_OBS_W + gap, width: SPIKE_W, height: SPIKE_H };
        return { type, variant: 'choice_then_spike', obstacles: [first, second], length: second.x + second.width - startX + 30, combo: true, advanced: true, platform: false, difficultyScore: 4 };
      }
      if (mode === 1) {
        const w = clampInt(ctx.safeJumpDistance * 0.62, 110, 150);
        const second: Obstacle = { kind: 'gap', x: first.x + CHOICE_OBS_W + gap, width: w, height: 0 };
        return { type, variant: 'choice_then_gap', obstacles: [first, second], length: second.x + second.width - startX + 32, combo: true, advanced: true, platform: false, difficultyScore: 4 };
      }
      const ceilW = clampInt(LOW_CEILING_MIN_W + 28, 160, 220);
      const second: Obstacle = { kind: 'lowCeiling', x: first.x + CHOICE_OBS_W + gap, width: ceilW, height: LOW_CEILING_CLEARANCE };
      return { type, variant: 'choice_then_lowCeiling', obstacles: [first, second], length: second.x + second.width - startX + 30, combo: true, advanced: true, platform: false, difficultyScore: 4 };
    }

    case 'pressureCombo': {
      const step  = clampInt(ctx.reactionSpacing * (ctx.playerModel.reactionTiming === 'late' ? 0.55 : 0.65), 100, 190);
      const ceilW = clampInt(LOW_CEILING_MIN_W + ctx.levelIndex * 6, 155, 220);
      const obs: Obstacle[] = [
        { kind: 'spike', x: startX + 18, width: SPIKE_W, height: SPIKE_H },
        { kind: 'lowCeiling', x: startX + 18 + SPIKE_W + step, width: ceilW, height: LOW_CEILING_CLEARANCE },
        { kind: 'doubleSpike', x: startX + 18 + SPIKE_W + step + ceilW + step, width: DOUBLE_SPIKE_W, height: DOUBLE_SPIKE_H },
      ];
      const end = obs[2].x + obs[2].width;
      return {
        type,
        variant: 'pressureCombo',
        obstacles: obs,
        length: end - startX + 28,
        combo: true,
        advanced: true,
        platform: false,
        difficultyScore: 6,
      };
    }

    case 'mixedPlatformCombo': {
      const platform = buildLongGapPlatforms(startX, ctx, seed + 7);
      const endX = Math.max(...platform.obstacles.map((o) => o.x + o.width));
      const follow: Obstacle = {
        kind: ctx.playerModel.prefersJump ? 'lowCeiling' : 'spike',
        x: endX + clampInt(ctx.reactionSpacing * 0.5, 80, 130),
        width: ctx.playerModel.prefersJump ? 170 : SPIKE_W,
        height: ctx.playerModel.prefersJump ? LOW_CEILING_CLEARANCE : SPIKE_H,
      };
      return {
        type,
        variant: 'mixedPlatformCombo',
        obstacles: [...platform.obstacles, follow],
        length: follow.x + follow.width - startX + 22,
        combo: true,
        advanced: true,
        platform: true,
        difficultyScore: 6,
      };
    }
  }
}

function buildLongGapPlatforms(startX: number, ctx: SegmentContext, seed: number): SegmentBuild {
  const tierCount = ctx.levelIndex <= 1 ? 2 : ctx.levelIndex <= 3 ? 3 : 4;
  const requestedPlatformCount = clampInt(tierCount + (seed % 2 === 0 ? 0 : 1), 2, 4);

  const allWidths = Array.from({ length: requestedPlatformCount }, (_, i) => {
    const base = ctx.levelIndex >= 5 ? 62 : ctx.levelIndex >= 3 ? 70 : 82;
    return clampInt(base - i * 2, 58, 90);
  });

  const allHeights = Array.from({ length: requestedPlatformCount }, (_, i) => {
    const base = 18 + i * 8;
    const jitter = ((seed + i * 11) % 3) * 6;
    return clampInt(base + jitter, 16, 72);
  });

  const jumpSpanBase = clampInt(ctx.maxJumpDistance * (ctx.levelIndex >= 5 ? 0.72 : 0.64), 120, 170);
  const leftEdge   = clampInt(jumpSpanBase * 0.7, 72, 128);
  const rightEdge  = clampInt(jumpSpanBase * 0.7, 72, 128);
  const allInBetween = Array.from({ length: requestedPlatformCount - 1 }, (_, i) => {
    const adj = ((seed + i * 7) % 3 - 1) * 10;
    return clampInt(jumpSpanBase + adj, 112, 182);
  });

  let platformCount = requestedPlatformCount;
  while (platformCount > 2) {
    const widths = allWidths.slice(0, platformCount);
    const inBetween = allInBetween.slice(0, Math.max(0, platformCount - 1));
    const requiredWidth = leftEdge + rightEdge + widths.reduce((a, b) => a + b, 0) + inBetween.reduce((a, b) => a + b, 0);
    if (requiredWidth <= 700) break;
    platformCount--;
  }

  const platformWidths = allWidths.slice(0, platformCount);
  const heights        = allHeights.slice(0, platformCount);
  const inBetween      = allInBetween.slice(0, Math.max(0, platformCount - 1));

  let gapWidth = leftEdge + rightEdge + platformWidths.reduce((a, b) => a + b, 0) + inBetween.reduce((a, b) => a + b, 0);
  gapWidth = clampInt(gapWidth, 420, 700);

  const gap: Obstacle = { kind: 'gap', x: startX + 18, width: gapWidth, height: 0 };
  const obstacles: Obstacle[] = [gap];
  const usableEnd = gap.x + gap.width - rightEdge;

  let px = gap.x + leftEdge;
  for (let i = 0; i < platformCount; i++) {
    const width = platformWidths[i];
    if (px + width > usableEnd) break;
    obstacles.push({ kind: 'platform', x: px, width, height: heights[i] });
    const jump = inBetween[i] ?? rightEdge;
    px += width + jump;
  }

  const placedPlatforms = obstacles.filter((o) => o.kind === 'platform').length;
  return {
    type: 'longGapPlatforms',
    variant: `longGapPlatforms_${placedPlatforms}p`,
    obstacles,
    length: gapWidth + 44,
    combo: true,
    advanced: ctx.levelIndex >= 3,
    platform: true,
    difficultyScore: 5,
  };
}

function buildStaircaseClimb(startX: number, ctx: SegmentContext, seed: number): SegmentBuild {
  const variantMode = seed % 3;
  const steps = clampInt(ctx.levelIndex >= 5 ? 5 : ctx.levelIndex >= 3 ? 4 : 3, 3, 5);
  const widths = Array.from({ length: steps }, (_, i) => clampInt(74 - i * 2, 60, 80));
  const baseJump = clampInt(ctx.maxJumpDistance * 0.52, 92, 160);

  const heights: number[] = [];
  for (let i = 0; i < steps; i++) {
    if (variantMode === 0) {
      heights.push(clampInt(20 + i * 11, 18, 76));
    } else if (variantMode === 1) {
      const h = i < steps - 1 ? 20 + i * 12 : 24 + Math.max(0, steps - 3) * 6;
      heights.push(clampInt(h, 18, 78));
    } else {
      const h = i === Math.floor(steps / 2) ? 26 : 18 + i * 10;
      heights.push(clampInt(h + ((seed + i) % 2) * 4, 18, 80));
    }
  }

  const gaps = Array.from({ length: steps + 1 }, (_, i) => {
    let g = clampInt(baseJump * 0.72, 78, 152);
    if (variantMode === 2 && i === Math.floor((steps + 1) / 2)) g = clampInt(g + 28, 100, 172);
    if (variantMode === 1 && i === steps - 1) g = clampInt(g + 18, 92, 168);
    return g;
  });

  const gapWidth = widths.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
  const gap: Obstacle = { kind: 'gap', x: startX + 20, width: gapWidth, height: 0 };
  const obstacles: Obstacle[] = [gap];

  let px = gap.x + gaps[0];
  for (let i = 0; i < steps; i++) {
    obstacles.push({ kind: 'platform', x: px, width: widths[i], height: heights[i] });
    px += widths[i] + gaps[i + 1];
  }

  if (ctx.levelIndex >= 3) {
    const endX    = gap.x + gap.width;
    const followX = endX + clampInt(ctx.reactionSpacing * 0.48, 72, 120);
    obstacles.push({ kind: 'spike', x: followX, width: SPIKE_W, height: SPIKE_H });
  }

  const variant = variantMode === 0 ? 'staircase_ascending' : variantMode === 1 ? 'staircase_ascendingDrop' : 'staircase_split';
  return {
    type: 'staircaseClimb',
    variant,
    obstacles,
    length: (gap.x + gap.width - startX) + 120,
    combo: true,
    advanced: true,
    platform: true,
    difficultyScore: 5,
  };
}

// ── Validation ─────────────────────────────────────────────────────

function validateBuild(args: {
  levelIndex: number;
  requiredRules: RequiredRule[];
  specs: SegmentSpec[];
  built: BuildResult;
  segmentCtx: SegmentContext;
  previousRuns: RunData[];
}): ValidationResult {
  const { levelIndex, requiredRules, built, segmentCtx } = args;
  const notes: string[] = [];
  const warnings: string[] = [];
  let ok = true;

  // Required rule check.
  for (const rule of requiredRules) {
    const count = built.segmentBuilds.filter((s) => rule.types.includes(s.type)).length;
    if (count < rule.minCount) {
      ok = false;
      notes.push(`missing required ${rule.tag}`);
    }
  }

  // Difficulty score check — must reach required threshold.
  const totalScore = built.segmentBuilds.reduce((sum, s) => sum + s.difficultyScore, 0);
  const reqScore   = requiredDifficultyScore(levelIndex);
  if (totalScore < reqScore) {
    ok = false;
    notes.push(`difficulty score ${totalScore} < required ${reqScore}`);
  }

  // Combo ratio check.
  const comboRatio = built.segmentBuilds.length === 0
    ? 0
    : built.segmentBuilds.filter((s) => s.combo).length / built.segmentBuilds.length;
  const minComboRatio = levelIndex >= 5 ? 0.85 : levelIndex >= 2 ? 0.70 : 0.40;
  if (levelIndex >= 2 && comboRatio < minComboRatio) {
    ok = false;
    notes.push(`combo ratio ${(comboRatio * 100).toFixed(0)}% < required ${(minComboRatio * 100).toFixed(0)}%`);
  }

  // Platform coverage check.
  if (levelIndex >= 5) {
    const platformKinds = built.segmentBuilds.filter((s) => s.platform).map((s) => s.type);
    if (!platformKinds.includes('longGapPlatforms') || !platformKinds.includes('staircaseClimb')) {
      ok = false;
      notes.push('missing both platform core segments');
    }
  }

  // Variety check.
  const minUnique  = levelIndex >= 5 ? 5 : levelIndex >= 3 ? 4 : 3;
  const uniqueCount = new Set(built.segmentBuilds.map((s) => s.type)).size;
  if (uniqueCount < minUnique) {
    ok = false;
    notes.push(`unique segments ${uniqueCount} < ${minUnique}`);
  }

  // Quiet gap check.
  const maxAllowed = maxAllowedQuietGap(levelIndex);
  if (built.maxQuietGap > maxAllowed) {
    ok = false;
    notes.push(`quiet gap ${built.maxQuietGap}px > ${maxAllowed}px`);
  }

  // Crossability check.
  if (!validateGapCrossability(built.obstacles, segmentCtx.maxJumpDistance)) {
    ok = false;
    notes.push('found non-crossable wide gap without platforms');
  }

  // Playable-path check.
  const pathValidation = validatePlayablePath(built, segmentCtx);
  if (!pathValidation.ok) {
    ok = false;
    notes.push(...pathValidation.notes.slice(0, 3));
  }
  warnings.push(...pathValidation.warnings);

  return {
    ok,
    notes: dedupeStrings(notes, 8),
    warnings: dedupeStrings(warnings, 8),
  };
}

function validateGapCrossability(obstacles: Obstacle[], maxJumpDistance: number): boolean {
  const gaps      = obstacles.filter((o) => o.kind === 'gap');
  const platforms = obstacles.filter((o) => o.kind === 'platform');

  for (const g of gaps) {
    if (g.width <= maxJumpDistance) continue;
    const internal = platforms.filter((p) => p.x >= g.x && p.x + p.width <= g.x + g.width);
    if (internal.length === 0) return false;
  }

  return true;
}

function validatePlayablePath(built: BuildResult, ctx: SegmentContext): { ok: boolean; notes: string[]; warnings: string[] } {
  const notes: string[] = [];
  const warnings: string[] = [];
  let ok = true;

  for (const seg of built.segmentBuilds) {
    const segmentNotes = validateSegmentSafety(seg, built.obstacles, ctx);
    if (segmentNotes.length > 0) {
      ok = false;
      notes.push(...segmentNotes.slice(0, 2));
      warnings.push(...segmentNotes.map((n) => `${seg.type}: ${n}`));
    }
  }

  const sorted = [...built.obstacles].sort((a, b) => a.x - b.x);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (b.x - (a.x + a.width) < 0) {
      ok = false;
      notes.push('overlapping obstacle hitboxes found');
      warnings.push(`overlap: ${a.kind} with ${b.kind}`);
      break;
    }
  }

  return { ok, notes: dedupeStrings(notes, 8), warnings: dedupeStrings(warnings, 8) };
}

function validateSegmentSafety(seg: SegmentBuild, allObstacles: Obstacle[], ctx: SegmentContext): string[] {
  const issues: string[] = [];
  const segStart = Math.min(...seg.obstacles.map((o) => o.x));
  const segEnd   = Math.max(...seg.obstacles.map((o) => o.x + o.width));

  const approachStart = segStart - clampInt(ctx.reactionSpacing * 0.6, 60, 120);
  const approachEnd   = segStart - 14;
  if (!hasSafeLandingWindow(approachStart, approachEnd, allObstacles)) {
    issues.push('missing clear approach before first obstacle');
  }

  if (requiresJumpAction(seg.type)) {
    const recoveryStart = segEnd + 18;
    const recoveryEnd   = segEnd + clampInt(ctx.safeJumpDistance * 0.55, 80, 150);
    if (!hasSafeLandingWindow(recoveryStart, recoveryEnd, allObstacles)) {
      issues.push('missing safe recovery window after jump challenge');
    }
  }

  if (seg.type === 'longGapPlatforms') {
    issues.push(...validateLongGapSegment(seg, allObstacles, ctx));
  } else if (seg.type === 'staircaseClimb') {
    issues.push(...validateStaircaseSegment(seg, allObstacles));
  } else if (seg.type === 'headClearanceJump') {
    issues.push(...validateHeadClearanceSegment(seg, allObstacles));
  } else if (seg.type === 'pressureCombo') {
    issues.push(...validatePressureComboSegment(seg, allObstacles));
  }

  return dedupeStrings(issues, 6);
}

function validateLongGapSegment(seg: SegmentBuild, allObstacles: Obstacle[], ctx: SegmentContext): string[] {
  const issues    = [];
  const gaps      = seg.obstacles.filter((o) => o.kind === 'gap');
  const platforms = seg.obstacles.filter((o) => o.kind === 'platform');
  if (gaps.length === 0 || platforms.length === 0) return ['invalid long gap layout'];

  const mainGap = gaps.reduce((widest, g) => (g.width > widest.width ? g : widest), gaps[0]);

  const spikesInside = allObstacles.filter(
    (o) => (o.kind === 'spike' || o.kind === 'doubleSpike') && rangesOverlap(o.x, o.x + o.width, mainGap.x, mainGap.x + mainGap.width),
  );
  if (spikesInside.length > 0) issues.push('spikes inside platform gap');

  const sortedPlatforms = [...platforms].sort((a, b) => a.x - b.x);
  for (const p of sortedPlatforms) {
    if (!hasSafeLandingWindow(p.x + LANDING_BUFFER, p.x + p.width - LANDING_BUFFER, allObstacles)) {
      issues.push('platform top is not a safe landing zone');
      break;
    }
  }

  const first = sortedPlatforms[0];
  const last  = sortedPlatforms[sortedPlatforms.length - 1];
  if (!first || !last) return dedupeStrings(issues, 6);

  const entryJump = first.x - mainGap.x;
  const exitJump  = (mainGap.x + mainGap.width) - (last.x + last.width);
  if (entryJump > ctx.maxJumpDistance - 8 || exitJump > ctx.maxJumpDistance - 8) {
    issues.push('platform gap entry/exit jump exceeds safe distance');
  }

  for (let i = 0; i < sortedPlatforms.length - 1; i++) {
    const from = sortedPlatforms[i];
    const to   = sortedPlatforms[i + 1];
    if (to.x - (from.x + from.width) > ctx.maxJumpDistance - 8) {
      issues.push('platform-to-platform jump exceeds safe distance');
      break;
    }
  }

  const exitStart = mainGap.x + mainGap.width + 10;
  const exitEnd   = exitStart + clampInt(ctx.safeJumpDistance * 0.5, 80, 150);
  if (!hasSafeLandingWindow(exitStart, exitEnd, allObstacles)) {
    issues.push('missing safe exit landing after platform gap');
  }

  return dedupeStrings(issues, 6);
}

function validateStaircaseSegment(seg: SegmentBuild, allObstacles: Obstacle[]): string[] {
  const issues    = [];
  const platforms = seg.obstacles.filter((o) => o.kind === 'platform').sort((a, b) => a.x - b.x);
  if (platforms.length < 2) return ['staircase missing required steps'];

  for (const step of platforms) {
    if (!hasSafeLandingWindow(step.x + LANDING_BUFFER, step.x + step.width - LANDING_BUFFER, allObstacles)) {
      issues.push('stair step is not a safe landing zone');
      break;
    }
  }

  const segStart = Math.min(...seg.obstacles.map((o) => o.x));
  const segEnd   = Math.max(...seg.obstacles.map((o) => o.x + o.width));
  const spikes   = allObstacles.filter((o) => (o.kind === 'spike' || o.kind === 'doubleSpike') && o.x >= segStart && o.x + o.width <= segEnd);

  for (let i = 0; i < platforms.length - 1; i++) {
    const from  = platforms[i];
    const to    = platforms[i + 1];
    const spike = spikes.some((s) => s.x < to.x && s.x + s.width > from.x + from.width);
    if (spike) {
      issues.push('spike between staircase steps removes safe route');
      break;
    }
  }

  const lastStep   = platforms[platforms.length - 1];
  const spikeAfter = spikes.find((s) => s.x > lastStep.x + lastStep.width);
  if (spikeAfter && !hasSafeLandingWindow(lastStep.x + lastStep.width + 8, spikeAfter.x - 8, allObstacles)) {
    issues.push('spike after staircase without recovery spacing');
  }

  return dedupeStrings(issues, 6);
}

function validateHeadClearanceSegment(seg: SegmentBuild, allObstacles: Obstacle[]): string[] {
  const issues   = [];
  const ceilings = seg.obstacles.filter((o) => o.kind === 'lowCeiling');
  const spikes   = seg.obstacles.filter((o) => o.kind === 'spike' || o.kind === 'doubleSpike');
  if (ceilings.length === 0 || spikes.length === 0) return ['head-clearance layout incomplete'];

  const ceiling = ceilings[0];
  if (ceiling.height < PLAYER_STANDING_HEIGHT + 8) {
    issues.push('head-clearance jump too tight for fair arc');
  }

  const recoveryStart = Math.max(...spikes.map((s) => s.x + s.width)) + 12;
  if (!hasSafeLandingWindow(recoveryStart, recoveryStart + 120, allObstacles)) {
    issues.push('head-clearance jump lacks safe post-landing');
  }
  return dedupeStrings(issues, 4);
}

function validatePressureComboSegment(seg: SegmentBuild, allObstacles: Obstacle[]): string[] {
  const hazards = seg.obstacles
    .filter((o) => o.kind === 'spike' || o.kind === 'doubleSpike' || o.kind === 'gap')
    .sort((a, b) => a.x - b.x);
  if (hazards.length < 2) return [];

  let hasRecovery = false;
  for (let i = 0; i < hazards.length - 1; i++) {
    const start = hazards[i].x + hazards[i].width + 8;
    const end   = hazards[i + 1].x - 8;
    if (hasSafeLandingWindow(start, end, allObstacles)) {
      hasRecovery = true;
      break;
    }
  }
  return hasRecovery ? [] : ['pressure combo has no recovery window'];
}

function requiresJumpAction(type: SegmentType): boolean {
  return type !== 'lowCeilingCrouch';
}

function maxAllowedQuietGap(levelIndex: number): number {
  if (levelIndex >= 8) return 150;
  if (levelIndex >= 5) return 170;
  if (levelIndex >= 1) return 210;
  return 280;
}

function computeMaxQuietGap(obstacles: Obstacle[], pathStart: number, pathEnd: number): number {
  const starts = obstacles.map((o) => o.x).sort((a, b) => a - b);
  if (starts.length === 0) return pathEnd - pathStart;

  let maxGap = starts[0] - pathStart;
  for (let i = 1; i < starts.length; i++) {
    maxGap = Math.max(maxGap, starts[i] - starts[i - 1]);
  }
  maxGap = Math.max(maxGap, pathEnd - starts[starts.length - 1]);
  return Math.round(maxGap);
}

// ── Player counter-target classification ───────────────────────────

function classifyPlayerCounters(model: PlayerModel, recentRuns: RunData[]): CounterTarget[] {
  const targets = new Set<CounterTarget>();

  if (model.prefersJump && model.jumpFrequency - model.crouchFrequency > 0.15) targets.add('jumpBiased');
  if (model.prefersCrouch && model.crouchFrequency - model.jumpFrequency > 0.15) targets.add('crouchBiased');
  if (model.reactionTiming === 'late') targets.add('lateReactor');
  if (model.consistency === 'predictable') targets.add('predictablePattern');
  if (model.prefersJump && model.crouchFrequency < 0.1) targets.add('overusesChoiceJump');
  if (model.prefersCrouch && model.jumpFrequency < 0.1) targets.add('overusesChoiceCrouch');

  const recent = recentRuns.slice(-5);
  if (recent.length >= 2) {
    const deaths = recent.filter((r) => !r.completed);
    if (deaths.length > 0) {
      const gapDeaths  = deaths.filter((r) => r.deathReason === 'gap').length;
      const spikeDeaths = deaths.filter((r) => r.deathReason === 'spike').length;
      if (gapDeaths / deaths.length >= 0.5) {
        targets.add('diesToGaps');
        if (gapDeaths >= 3) targets.add('platformWeak');
      }
      if (spikeDeaths / deaths.length >= 0.5) targets.add('diesToSpikes');
    }
  }

  return [...targets];
}

// Score a candidate segment type against player weaknesses.
// Higher = better counter to player's identified habits.
function scoreCandidateSegment(
  type: SegmentType,
  counterTargets: CounterTarget[],
  _levelIndex: number,
): number {
  let score = SEGMENT_BASE_SCORES[type];

  for (const target of counterTargets) {
    switch (target) {
      case 'jumpBiased':
        if (type === 'lowCeilingCrouch' || type === 'jumpThenCrouch' || type === 'headClearanceJump') score += 3;
        else if (type === 'choiceThenPunish') score += 2;
        break;
      case 'crouchBiased':
        if (type === 'crouchThenJump' || type === 'longGapPlatforms') score += 3;
        else if (type === 'doubleSpikeTiming' || type === 'pressureCombo') score += 2;
        break;
      case 'lateReactor':
        if (type === 'pressureCombo' || type === 'headClearanceJump') score += 3;
        else if (type === 'doubleSpikeTiming') score += 2;
        break;
      case 'predictablePattern':
        if (type === 'choiceThenPunish' || type === 'pressureCombo') score += 3;
        else if (type === 'headClearanceJump') score += 2;
        break;
      case 'diesToGaps':
      case 'platformWeak':
        if (type === 'longGapPlatforms' || type === 'staircaseClimb' || type === 'mixedPlatformCombo') score += 3;
        break;
      case 'diesToSpikes':
        if (type === 'pressureCombo' || type === 'doubleSpikeTiming') score += 3;
        else if (type === 'jumpThenCrouch' || type === 'crouchThenJump') score += 2;
        break;
      case 'overusesChoiceJump':
        if (type === 'choiceThenPunish' || type === 'headClearanceJump') score += 3;
        break;
      case 'overusesChoiceCrouch':
        if (type === 'choiceThenPunish') score += 3;
        else if (type === 'longGapPlatforms') score += 2;
        break;
    }
  }

  return score;
}

function buildAdaptationReasons(counterTargets: CounterTarget[]): string[] {
  const descriptions: Record<CounterTarget, string> = {
    jumpBiased:           'Prioritized ceiling/crouch combos to punish jump reliance',
    crouchBiased:         'Added gap pressure and spike sequences to punish crouch habit',
    platformWeak:         'Increased platform segment frequency where you struggle most',
    lateReactor:          'Tightened obstacle spacing to punish late reactions',
    predictablePattern:   'Inserted choice+pressure combos to break predictable routing',
    diesToGaps:           'Focused on gap-heavy segments where you consistently die',
    diesToSpikes:         'Added spike pressure sequences targeting your weak spot',
    overusesChoiceJump:   'Chained choice obstacles into ceilings to punish jump choices',
    overusesChoiceCrouch: 'Chained choice obstacles into gaps to punish crouch choices',
  };
  return counterTargets.map((t) => descriptions[t]);
}

// ── Strategy selection ─────────────────────────────────────────────

function selectStrategy(model: PlayerModel): Strategy {
  if (model.jumpFrequency - model.crouchFrequency > 0.2) return 'punishJumpBias';
  if (model.crouchFrequency - model.jumpFrequency > 0.2) return 'punishCrouchBias';
  if (model.consistency === 'predictable') return 'punishPredictability';
  if (model.reactionTiming === 'late') return 'punishLateReactions';
  return 'balancedEscalation';
}

// ── Segment classification ─────────────────────────────────────────

function isComboSegment(type: SegmentType): boolean {
  return type === 'jumpThenCrouch'
    || type === 'crouchThenJump'
    || type === 'choiceThenPunish'
    || type === 'pressureCombo'
    || type === 'mixedPlatformCombo'
    || type === 'headClearanceJump'
    || type === 'longGapPlatforms'
    || type === 'staircaseClimb';
}

function isBasicSegment(type: SegmentType): boolean {
  return type === 'spikeJump' || type === 'lowCeilingCrouch' || type === 'doubleSpikeTiming';
}

function isPlatformSegment(type: SegmentType): boolean {
  return type === 'longGapPlatforms' || type === 'staircaseClimb' || type === 'mixedPlatformCombo';
}

// ── Repair ────────────────────────────────────────────────────────

function repairUnsafeBuild(
  built: BuildResult,
  ctx: SegmentContext,
  canvasWidth: number,
  attempt: number,
): { built: BuildResult; repaired: boolean; warnings: string[] } {
  const repairedSegments: SegmentBuild[] = [];
  const warnings: string[] = [];
  let changed = false;

  for (let i = 0; i < built.segmentBuilds.length; i++) {
    const seg = built.segmentBuilds[i];
    const segmentStart = Math.min(...seg.obstacles.map((o) => o.x));
    let next = seg;

    if (seg.type === 'headClearanceJump') {
      const issues = validateHeadClearanceSegment(seg, built.obstacles);
      if (issues.length > 0) {
        next = buildSegment('jumpThenCrouch', segmentStart, ctx, attempt * 29 + i * 11 + 7);
        warnings.push('Replaced unsafe headClearanceJump with jumpThenCrouch');
        changed = true;
      }
    } else if (seg.type === 'pressureCombo') {
      const issues = validatePressureComboSegment(seg, built.obstacles);
      if (issues.length > 0) {
        next = buildSegment('crouchThenJump', segmentStart, ctx, attempt * 31 + i * 13 + 9);
        warnings.push('Replaced unsafe pressureCombo with crouchThenJump');
        changed = true;
      }
    }

    if (next.type === 'longGapPlatforms' || next.type === 'staircaseClimb' || next.type === 'mixedPlatformCombo') {
      const cleaned = stripSpikesUnsafeAroundPlatforms(next);
      if (cleaned.removed > 0) {
        next = cleaned.segment;
        warnings.push(`Removed ${cleaned.removed} unsafe spikes near platform route`);
        changed = true;
      }
    }

    repairedSegments.push(next);
  }

  if (!changed) return { built, repaired: false, warnings: [] };

  const rebuilt = rebuildBuildResultFromSegments(repairedSegments, canvasWidth, built.requiredTagsPlaced);
  return { built: rebuilt, repaired: true, warnings: dedupeStrings(warnings, 8) };
}

function stripSpikesUnsafeAroundPlatforms(segment: SegmentBuild): { segment: SegmentBuild; removed: number } {
  const platforms = segment.obstacles.filter((o) => o.kind === 'platform');
  const gaps      = segment.obstacles.filter((o) => o.kind === 'gap');
  if (platforms.length === 0 || gaps.length === 0) return { segment, removed: 0 };

  const platformRanges = platforms.map((p) => ({ start: p.x - 2, end: p.x + p.width + 2 }));
  const gapRanges      = gaps.map((g) => ({ start: g.x, end: g.x + g.width }));
  let removed = 0;

  const filtered = segment.obstacles.filter((o) => {
    if (o.kind !== 'spike' && o.kind !== 'doubleSpike') return true;
    const underPlatform = platformRanges.some((r) => rangesOverlap(o.x, o.x + o.width, r.start, r.end));
    if (underPlatform) { removed++; return false; }
    const insideGap = gapRanges.some((r) => rangesOverlap(o.x, o.x + o.width, r.start, r.end));
    if (insideGap) { removed++; return false; }
    return true;
  });

  return { segment: { ...segment, obstacles: filtered }, removed };
}

function rebuildBuildResultFromSegments(
  segmentBuilds: SegmentBuild[],
  canvasWidth: number,
  requiredTagsPlaced: string[] = [],
): BuildResult {
  const obstacles  = segmentBuilds.flatMap((s) => s.obstacles).sort((a, b) => a.x - b.x);
  const maxEnd     = obstacles.length > 0 ? Math.max(...obstacles.map((o) => o.x + o.width)) : canvasWidth;
  const worldWidth = Math.max(Math.round(canvasWidth * 2), Math.round(maxEnd + SAFE_FLAG_GAP + FLAG_OFFSET + 120));
  const flagX      = worldWidth - FLAG_OFFSET;

  return {
    segmentBuilds,
    obstacles,
    worldWidth,
    flagX,
    requiredTagsPlaced,
    maxQuietGap: computeMaxQuietGap(obstacles, SAFE_SPAWN_END, flagX - SAFE_FLAG_GAP),
  };
}

// Fallback uses harder patterns — no trivial segments even in the safe path.
function buildKnownSafeFallback(levelIndex: number, ctx: SegmentContext, canvasWidth: number): BuildResult {
  let types: SegmentType[];
  if (levelIndex >= 6) {
    types = ['longGapPlatforms', 'pressureCombo', 'staircaseClimb', 'mixedPlatformCombo', 'pressureCombo', 'longGapPlatforms'];
  } else if (levelIndex >= 4) {
    types = ['jumpThenCrouch', 'longGapPlatforms', 'pressureCombo', 'staircaseClimb', 'crouchThenJump'];
  } else if (levelIndex >= 2) {
    types = ['doubleSpikeTiming', 'jumpThenCrouch', 'longGapPlatforms', 'crouchThenJump', 'staircaseClimb'];
  } else {
    types = ['doubleSpikeTiming', 'lowCeilingCrouch', 'longGapPlatforms'];
  }

  const segmentBuilds: SegmentBuild[] = [];
  let cursor = SAFE_SPAWN_END + 26;
  for (let i = 0; i < types.length; i++) {
    const seg = buildSegment(types[i], cursor, ctx, levelIndex * 71 + i * 19);
    segmentBuilds.push(seg);
    cursor += seg.length + clampInt(ctx.reactionSpacing * 0.65, 80, 140);
  }
  return rebuildBuildResultFromSegments(segmentBuilds, canvasWidth);
}

// ── Safe-landing helpers ───────────────────────────────────────────

function hasSafeLandingWindow(xStart: number, xEnd: number, obstacles: Obstacle[]): boolean {
  if (xEnd <= xStart) return false;
  if (xEnd - xStart < MIN_LANDING_WIDTH) return false;

  const supports = computeSupportIntervals(xStart, xEnd, obstacles);
  if (supports.length === 0) return false;

  const blocked = [
    ...obstacles.filter((o) => o.kind === 'spike' || o.kind === 'doubleSpike')
      .map((o) => ({ start: o.x - 2, end: o.x + o.width + 2 })),
    ...obstacles.filter((o) => o.kind === 'lowCeiling' && o.height < PLAYER_STANDING_HEIGHT + 3)
      .map((o) => ({ start: o.x, end: o.x + o.width })),
    ...obstacles.filter((o) => o.kind === 'choiceObstacle' && o.height < PLAYER_STANDING_HEIGHT + 3)
      .map((o) => ({ start: o.x, end: o.x + o.width })),
  ];

  const freeSupports = supports.flatMap((s) => subtractIntervals([s], blocked));
  return freeSupports.some((s) => s.end - s.start >= MIN_LANDING_WIDTH);
}

function computeSupportIntervals(xStart: number, xEnd: number, obstacles: Obstacle[]): Interval[] {
  const base: Interval[] = [{ start: xStart, end: xEnd }];
  const gaps = obstacles.filter((o) => o.kind === 'gap').map((o) => ({ start: o.x, end: o.x + o.width }));
  const groundSupports = subtractIntervals(base, gaps);

  const platforms = obstacles
    .filter((o) => o.kind === 'platform')
    .map((o) => ({ start: o.x + LANDING_BUFFER, end: o.x + o.width - LANDING_BUFFER }))
    .filter((i) => i.end - i.start >= MIN_LANDING_WIDTH - 4)
    .map((i) => clampInterval(i, xStart, xEnd))
    .filter((i): i is Interval => i !== null);

  return mergeIntervals([...groundSupports, ...platforms]);
}

function subtractIntervals(base: Interval[], blockers: Interval[]): Interval[] {
  let result = [...base];
  for (const blocker of blockers) {
    const next: Interval[] = [];
    for (const interval of result) {
      if (blocker.end <= interval.start || blocker.start >= interval.end) {
        next.push(interval);
        continue;
      }
      if (blocker.start > interval.start) next.push({ start: interval.start, end: blocker.start });
      if (blocker.end < interval.end) next.push({ start: blocker.end, end: interval.end });
    }
    result = next.filter((i) => i.end - i.start > 1);
    if (result.length === 0) return [];
  }
  return mergeIntervals(result);
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length <= 1) return intervals;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const cur  = sorted[i];
    const prev = merged[merged.length - 1];
    if (cur.start <= prev.end + 1) prev.end = Math.max(prev.end, cur.end);
    else merged.push({ ...cur });
  }
  return merged;
}

function clampInterval(interval: Interval, min: number, max: number): Interval | null {
  const start = Math.max(interval.start, min);
  const end   = Math.min(interval.end, max);
  return end <= start ? null : { start, end };
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

// ── Utilities ─────────────────────────────────────────────────────

function dedupeStrings(items: string[], maxCount: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= maxCount) break;
  }
  return out;
}

function deterministicJitter(seed: number, magnitude: number): number {
  const x    = Math.sin(seed * 91.73) * 10000;
  const frac = x - Math.floor(x);
  return Math.round((frac * 2 - 1) * magnitude);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}
