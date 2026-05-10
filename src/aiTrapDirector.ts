import { Obstacle, TrapState } from './types';
import { ObstacleChoiceStats, PlayerModel, PlayerProfile, RunData } from './telemetry';
import {
  AIKnowledge,
  AIPhase,
  determinePhase,
  isTrapUnlocked,
  getMaxTrapHosts,
} from './aiKnowledge';
import { calculateMaxJumpDistance } from './movementTuning';

const FORCED_ACTION_RECOVERY_GAP = 148;
const MIN_CHOICE_HOST_SPACING = 260;

export interface TrapDirectiveOutput {
  obstacles: Obstacle[];
  activeTraps: string[];
  trapReasons: string[];
  phase: AIPhase;
  predictedLandingX?: number;
  mutationFallbackUsed: boolean;
  mutationTargetObstacleId?: string;
}

export interface TrapPlayerSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  velX: number;
  velY: number;
  onGround: boolean;
  isCrouching: boolean;
}

export interface RealtimeTrapMutation {
  trapType: string;
  trapState: TrapState;
  reason: string;
  message: string;
  predictedLandingX?: number;
  routeLayer?: 'lower' | 'mid' | 'upper';
}

export interface RealtimeTrapDebug {
  phase: AIPhase;
  activeTrap: string;
  trapState: TrapState | 'none';
  activeRoute: 'lower' | 'mid' | 'upper' | 'mixed' | 'none';
  predictedAction: 'jump' | 'crouch' | 'mixed' | 'unknown';
  predictedLandingX?: number;
  trapReason: string;
  confidence: number;
  lastMutation: string;
  mutationCountsByRoute: { lower: number; mid: number; upper: number };
}

export interface RealtimeTrapOutput {
  mutations: RealtimeTrapMutation[];
  debug: RealtimeTrapDebug;
}

interface RealtimeTrapContext {
  obstacles: Obstacle[];
  player: TrapPlayerSnapshot;
  playerModel: PlayerModel;
  knowledge: AIKnowledge;
  recentRuns: RunData[];
  levelIndex: number;
  groundY: number;
  dt: number;
}

export function directTraps(
  phase: AIPhase,
  knowledge: AIKnowledge,
  model: PlayerModel,
  profile: PlayerProfile,
  obstacles: Obstacle[],
  levelIndex: number,
  reactionSpacing: number,
): TrapDirectiveOutput {
  const activeTraps: string[] = [];
  const trapReasons: string[] = [];
  let predictedLandingX: number | undefined;
  let mutationFallbackUsed = false;
  let mutationTargetObstacleId: string | undefined;
  const preferredRoute = model.preferredRoute === 'mixed' ? undefined : model.preferredRoute;

  const mutatedObstacles = obstacles.map((o) => initializeRuntimeFields({ ...o }));
  const maxHosts = getMaxTrapHosts(phase);
  let hostsApplied = 0;
  const perObstacleStats = model.perObstacleChoiceStats ?? {};
  const choicePreference = inferChoicePreference(model, levelIndex);
  const hasChoiceObstacles = mutatedObstacles.some(
    (o) =>
      o.kind === 'choiceObstacle' &&
      (o.trapType === undefined ||
        o.trapType === 'adaptiveChoiceGate' ||
        o.trapType === 'dualPathGate' ||
        o.trapType === 'baitChoiceTrap' ||
        o.trapType === 'adaptiveChoiceGateJump' ||
        o.trapType === 'adaptiveChoiceGateCrouch'),
  );
  const canCounterChoice = hasChoiceObstacles && choicePreference !== null;

  if (phase !== 'observe' && maxHosts > 0) {
    if (
      hostsApplied < maxHosts &&
      (isTrapUnlocked('reactiveLowCeiling', knowledge) || levelIndex >= 2) &&
      shouldSealCrouchLane(mutatedObstacles, model, preferredRoute)
    ) {
      const applied = hostReactiveLowCeiling(
        mutatedObstacles,
        model.perObstacleInteractionStats,
        preferredRoute,
      );
      if (applied) {
        hostsApplied++;
        activeTraps.push('reactiveLowCeiling');
        trapReasons.push('Armed a low-ceiling lane seal for crouch-route reliance');
      }
    }

    if (hostsApplied < maxHosts && canCounterChoice) {
      if (choicePreference === 'jump') {
        const { appliedCount, fallbackCount, targetIds } = hostCounterJumpChoices(mutatedObstacles, reactionSpacing, levelIndex, perObstacleStats);
        if (appliedCount > 0) {
          hostsApplied += appliedCount;
          activeTraps.push('adaptiveChoiceGateJump');
          trapReasons.push(
            `Choice-jump counter armed on ${appliedCount} gate(s) (${Math.round(model.choiceJumpRate * 100)}% jump choices)${
              fallbackCount > 0 ? ` [${fallbackCount} fallback]` : ''
            }`,
          );
          mutationFallbackUsed = fallbackCount > 0;
          mutationTargetObstacleId = targetIds.slice(0, 3).join(', ');
        }
      } else if (choicePreference === 'crouch') {
        const { appliedCount, fallbackCount, targetIds } = hostCounterCrouchChoices(mutatedObstacles, reactionSpacing, perObstacleStats);
        if (appliedCount > 0) {
          hostsApplied += appliedCount;
          activeTraps.push('adaptiveChoiceGateCrouch');
          trapReasons.push(
            `Choice-crouch counter armed on ${appliedCount} gate(s) (${Math.round(model.choiceCrouchRate * 100)}% crouch choices)${
              fallbackCount > 0 ? ` [${fallbackCount} fallback]` : ''
            }`,
          );
          mutationFallbackUsed = fallbackCount > 0;
          mutationTargetObstacleId = targetIds.slice(0, 3).join(', ');
        }
      }
    }

    if (
      hostsApplied < maxHosts &&
      (isTrapUnlocked('shiftingGap', knowledge) || levelIndex >= 2)
    ) {
      const applied = hostShiftingGap(
        mutatedObstacles,
        levelIndex,
        model.reactionTiming,
        model.perObstacleInteractionStats,
        preferredRoute,
      );
      if (applied) {
        hostsApplied++;
        activeTraps.push('shiftingGap');
        trapReasons.push('Armed a shifting gap mutation');
      }
    }

    if (
      hostsApplied < maxHosts &&
      (phase === 'predict' || phase === 'dominate') &&
      isTrapUnlocked('landingPunisher', knowledge) &&
      profile.commonLandingZones.length > 0
    ) {
      predictedLandingX = profile.commonLandingZones[0];
      const applied = hostLandingPunisher(mutatedObstacles, predictedLandingX);
      if (applied) {
        hostsApplied++;
        activeTraps.push('landingPunisher');
        trapReasons.push(`Armed a landing punisher near ${Math.round(predictedLandingX)}px`);
      }
    }

    if (
      hostsApplied < maxHosts &&
      (phase === 'counter' || phase === 'predict' || phase === 'dominate') &&
      (isTrapUnlocked('collapsingPlatform', knowledge) || model.routeConfidence > 0.35)
    ) {
      const applied = hostCollapsingPlatform(
        mutatedObstacles,
        model.perObstacleInteractionStats,
        preferredRoute,
      );
      if (applied) {
        hostsApplied++;
        activeTraps.push('collapsingPlatform');
        trapReasons.push('Armed a collapsing platform trap');
      }
    }

    if (
      hostsApplied < maxHosts &&
      (phase === 'test' || phase === 'counter' || phase === 'predict' || phase === 'dominate') &&
      isTrapUnlocked('popUpSpike', knowledge)
    ) {
      const targetCount = phase === 'test' ? 1 : phase === 'counter' ? 2 : phase === 'predict' ? 3 : 4;
      let planted = 0;
      while (hostsApplied < maxHosts && planted < targetCount) {
        const applied = hostPopUpSpike(mutatedObstacles, levelIndex + planted, preferredRoute);
        if (!applied) break;
        hostsApplied++;
        planted++;
      }
      if (planted > 0) {
        activeTraps.push('popUpSpike');
        trapReasons.push(`Planted ${planted} hidden pop-up spike trap(s)`);
      }
    }

    if (
      hostsApplied < maxHosts &&
      (phase === 'predict' || phase === 'dominate') &&
      isTrapUnlocked('platformNeedle', knowledge)
    ) {
      const targetCount = phase === 'dominate' ? 2 : 1;
      let armed = 0;
      while (hostsApplied < maxHosts && armed < targetCount) {
        const applied = hostPlatformNeedle(mutatedObstacles, preferredRoute);
        if (!applied) break;
        hostsApplied++;
        armed++;
      }
      if (armed > 0) {
        activeTraps.push('platformNeedle');
        trapReasons.push(`Armed ${armed} platform tile spike trap(s)`);
      }
    }

    if (
      hostsApplied < maxHosts &&
      (phase === 'counter' || phase === 'predict' || phase === 'dominate') &&
      model.routeConfidence > 0.45
    ) {
      if (preferredRoute === 'upper' || preferredRoute === 'mid') {
        const applied = hostPopUpSpike(mutatedObstacles, levelIndex + 23, 'lower');
        if (applied) {
          hostsApplied++;
          activeTraps.push('routeReturnPunisher');
          trapReasons.push(`Punished return lane: seeded lower-route pop-up spike (prefers ${preferredRoute})`);
        }
      } else if (preferredRoute === 'lower') {
        const applied = hostPlatformNeedle(mutatedObstacles, 'upper');
        if (applied) {
          hostsApplied++;
          activeTraps.push('routeReturnPunisher');
          trapReasons.push('Punished return lane: armed upper-route platform needle (prefers lower)');
        }
      }
    }

    if (
      hostsApplied < maxHosts &&
      (phase === 'counter' || phase === 'predict' || phase === 'dominate') &&
      model.routeConfidence > 0.4 &&
      preferredRoute === 'upper'
    ) {
      const applied = hostVanishingUpperPlatform(mutatedObstacles, model.perObstacleInteractionStats);
      if (applied) {
        hostsApplied++;
        activeTraps.push('vanishingUpperPlatform');
        trapReasons.push('Upper route overused; armed a floating tile vanish trap on a safe drop zone');
      }
    }

    if (hostsApplied === 0 && hasChoiceObstacles) {
      const fallbackPreference = choicePreference ?? (levelIndex % 2 === 0 ? 'jump' : 'crouch');
      const result = fallbackPreference === 'jump'
        ? hostCounterJumpChoices(mutatedObstacles, reactionSpacing, levelIndex, perObstacleStats)
        : hostCounterCrouchChoices(mutatedObstacles, reactionSpacing, perObstacleStats);
      if (result.appliedCount > 0) {
        hostsApplied += result.appliedCount;
        activeTraps.push(fallbackPreference === 'jump' ? 'adaptiveChoiceGateJump' : 'adaptiveChoiceGateCrouch');
        trapReasons.push('Armed fallback choice mutation so this adaptive phase remains visible');
        mutationFallbackUsed = true;
        mutationTargetObstacleId = result.targetIds.slice(0, 3).join(', ');
      }
    }
  }

  if (!verifyValidPathExists(mutatedObstacles)) {
    return {
      obstacles: obstacles.map((o) => initializeRuntimeFields({ ...o })),
      activeTraps: [],
      trapReasons: ['Host setup reverted to preserve a valid path'],
      phase,
      mutationFallbackUsed: false,
    };
  }

  return {
    obstacles: mutatedObstacles,
    activeTraps,
    trapReasons,
    phase,
    predictedLandingX,
    mutationFallbackUsed,
    mutationTargetObstacleId,
  };
}

export function updateRealtimeTraps(ctx: RealtimeTrapContext): RealtimeTrapOutput {
  const phase = determinePhase(ctx.knowledge, ctx.levelIndex, ctx.playerModel, ctx.recentRuns);
  const maxActive = getMaxTrapHosts(phase);
  const predictedAction = getPredictedAction(ctx.playerModel);
  const predictedLandingX = computePredictedLandingX(ctx.recentRuns);

  const mutations: RealtimeTrapMutation[] = [];
  let activeTrap = 'none';
  let activeState: TrapState | 'none' = 'none';
  let activeRoute: 'lower' | 'mid' | 'upper' | 'mixed' | 'none' = 'none';
  let activeReason = 'none';
  let activeCount = 0;
  const mutationCountsByRoute = { lower: 0, mid: 0, upper: 0 };

  for (const obs of ctx.obstacles) {
    initializeRuntimeFields(obs);

    if (!obs.trapHost || !obs.trapType) continue;

    const state = obs.trapState ?? 'idle';
    if (state === 'armed' || state === 'warning' || state === 'triggered') {
      activeCount++;
      if (activeTrap === 'none') {
        activeTrap = obs.trapType;
        activeState = state;
        activeRoute = obs.routeLayer ?? 'none';
        activeReason = obs.trapReason ?? 'armed';
      }
    }

    if (phase === 'observe') continue;

    const playerFront = ctx.player.x + ctx.player.width;
    const ahead = (obs.currentX ?? obs.x) - playerFront;

    const isChoiceMutationType =
      obs.trapType === 'adaptiveChoiceGateJump' ||
      obs.trapType === 'adaptiveChoiceGateCrouch' ||
      obs.trapType === 'baitChoiceTrap';
    if (state === 'idle' && (isChoiceMutationType || activeCount < maxActive) && shouldArmTrap(obs, ctx.player, ahead, phase, ctx.groundY)) {
      if (obs.trapType === 'baitChoiceTrap') {
        const chosen = resolveBaitChoiceMutation(obs, ctx.playerModel, ctx.recentRuns);
        obs.trapType = chosen;
        obs.trapReason =
          chosen === 'adaptiveChoiceGateJump'
            ? 'AI inferred jump tendency at choice bars; spikes will block the jump lane'
            : 'AI inferred crouch tendency at choice bars; bar will drop to block crouch lane';
      }
      obs.trapState = 'armed';
      obs.trapTimer = 0;
      obs.warningTimer = warningDuration(ctx.levelIndex, phase);
      if (obs.trapType === 'adaptiveChoiceGateJump' || obs.trapType === 'adaptiveChoiceGateCrouch') {
        obs.warningTimer = Math.min(obs.warningTimer, 0.12);
        // Show immediate visible "AI changed this gate" signal even before full trigger.
        if (obs.trapType === 'adaptiveChoiceGateJump') {
          obs.currentSpikeExt = Math.max(obs.currentSpikeExt ?? 0, 40);
        } else {
          const from = obs.currentHeight ?? obs.height;
          const to = obs.targetHeight ?? obs.height;
          obs.currentHeight = lerp(from, to, 0.55);
        }
      }
      obs.animationProgress = 0;
      obs.triggeredByAI = true;
      activeCount++;
      if (activeTrap === 'none') {
        activeTrap = obs.trapType;
        activeState = 'armed';
        activeReason = obs.trapReason ?? 'armed';
      }
      continue;
    }

    if (obs.trapState === 'armed') {
      obs.trapTimer = (obs.trapTimer ?? 0) + ctx.dt;
      if ((obs.trapTimer ?? 0) >= 0.08) {
        obs.trapState = 'warning';
        obs.trapTimer = 0;
        obs.warningTimer = warningDuration(ctx.levelIndex, phase);
        if (obs.trapType === 'adaptiveChoiceGateJump' || obs.trapType === 'adaptiveChoiceGateCrouch') {
          obs.warningTimer = Math.min(obs.warningTimer, 0.12);
        }
        obs.animationProgress = 0;
      }
      continue;
    }

    if (obs.trapState === 'warning') {
      obs.warningTimer = Math.max(0, (obs.warningTimer ?? 0) - ctx.dt);
      const warnDur = warningDuration(ctx.levelIndex, phase);
      obs.animationProgress = clamp01(1 - (obs.warningTimer / warnDur));

      const isChoiceMutation = obs.trapType === 'adaptiveChoiceGateJump' || obs.trapType === 'adaptiveChoiceGateCrouch';
      const canTriggerNow = canTriggerSafely(obs, ctx.player, ctx.groundY);
      const forceChoiceTrigger = isChoiceMutation && (
        ahead > -26 || !isPlayerInsideTrap(obs, ctx.player, ctx.groundY)
      );
      if (obs.warningTimer <= 0 && (canTriggerNow || forceChoiceTrigger)) {
        obs.trapState = 'triggered';
        obs.trapTimer = 0;
        obs.animationProgress = 0;
        // Apply a strong first-step mutation so the trap is immediately meaningful.
        if (obs.trapType === 'adaptiveChoiceGateJump') {
          obs.currentSpikeExt = obs.targetSpikeExt ?? 120;
        }
        if (obs.trapType === 'adaptiveChoiceGateCrouch') {
          obs.currentHeight = obs.targetHeight ?? obs.height;
        }
        if (obs.trapType === 'vanishingUpperPlatform') {
          activateVanishingPlatform(obs, ctx.playerModel.routeConfidence);
        }

        const message = trapTriggerMessage(obs.trapType, predictedAction, predictedLandingX);
        const mutation: RealtimeTrapMutation = {
          trapType: obs.trapType,
          trapState: 'triggered',
          reason: obs.trapReason ?? 'AI trap triggered',
          message,
          predictedLandingX,
          routeLayer: obs.routeLayer,
        };
        mutations.push(mutation);
        if (obs.routeLayer) mutationCountsByRoute[obs.routeLayer]++;

        activeTrap = obs.trapType;
        activeState = 'triggered';
        activeRoute = obs.routeLayer ?? activeRoute;
        activeReason = mutation.reason;
      }
      continue;
    }

    if (obs.trapState === 'triggered') {
      obs.trapTimer = (obs.trapTimer ?? 0) + ctx.dt;
      const t = clamp01((obs.trapTimer ?? 0) / mutationDurationForType(obs.trapType));
      obs.animationProgress = t;
      applyMutationProgress(obs, t);

      if (t >= 1) {
        obs.trapState = 'spent';
      }
    }
  }

  return {
    mutations,
    debug: {
      phase,
      activeTrap,
      trapState: activeState,
      activeRoute,
      predictedAction,
      predictedLandingX,
      trapReason: activeReason,
      confidence: ctx.knowledge.overallConfidence,
      lastMutation: mutations[mutations.length - 1]?.message ?? 'none',
      mutationCountsByRoute,
    },
  };
}

function hostReactiveLowCeiling(
  obstacles: Obstacle[],
  interactionStats: PlayerModel['perObstacleInteractionStats'],
  preferredRoute?: 'lower' | 'mid' | 'upper',
): boolean {
  const target = pickObstacleByRoute(
    obstacles,
    (o) => o.kind === 'lowCeiling' && !o.trapHost && hasNearbyPlatformBypass(obstacles, o),
    preferredRoute,
    interactionStats,
  );
  if (!target) return false;

  initializeRuntimeFields(target);
  target.trapHost = true;
  target.trapType = 'reactiveLowCeiling';
  target.trapState = 'idle';
  target.currentHeight = clamp(target.height + 10, 34, 62);
  target.trapInitialHeight = target.currentHeight;
  target.targetHeight = 0;
  target.trapReason = 'You keep using this crouch lane; the ceiling drops to the ground to force a reroute';
  return true;
}

function shouldSealCrouchLane(
  obstacles: Obstacle[],
  model: PlayerModel,
  preferredRoute?: 'lower' | 'mid' | 'upper',
): boolean {
  const hasSealableCeiling = obstacles.some(
    (o) => o.kind === 'lowCeiling' && !o.trapHost && hasNearbyPlatformBypass(obstacles, o),
  );
  if (!hasSealableCeiling) return false;

  if (model.prefersCrouch || model.preferredChoiceAction === 'crouch') return true;
  if (preferredRoute === 'lower' || preferredRoute === 'mid') return true;

  return Object.values(model.perObstacleInteractionStats ?? {}).some(
    (s) =>
      s.obstacleKind === 'lowCeiling' &&
      s.confidence > 0.25 &&
      (s.preferredAction === 'crouch' || s.preferredAction === 'none' || s.failureRate > 0),
  );
}

function hasNearbyPlatformBypass(obstacles: Obstacle[], target: Obstacle): boolean {
  const left = target.x - 220;
  const right = target.x + target.width + 260;
  return obstacles.some((o) =>
    o.kind === 'platform' &&
    o.solid !== false &&
    o.x + o.width > left &&
    o.x < right &&
    o.height >= 72,
  );
}

// Jump-counter: spikes grow upward from the bar top (0 → 120px).
// Player bottom at apex = groundY-137; bar top at ~groundY-46; spike tip at groundY-46-120 = groundY-166.
// Even max jump cannot clip the spike zone once fully extended.
function hostCounterJumpChoices(
  obstacles: Obstacle[],
  _reactionSpacing: number,
  levelIndex: number,
  perObstacleStats: Record<string, ObstacleChoiceStats>,
): { appliedCount: number; fallbackCount: number; targetIds: string[] } {
  const targets = pickChoiceMutationHosts(obstacles, 'jump', perObstacleStats);
  if (targets.length === 0) return { appliedCount: 0, fallbackCount: 0, targetIds: [] };

  let appliedCount = 0;
  let fallbackCount = 0;
  const targetIds: string[] = [];
  const spacedTargets = enforceChoiceHostSpacing(targets, MIN_CHOICE_HOST_SPACING);
  for (const { obstacle: target, usedFallback } of spacedTargets) {
    initializeRuntimeFields(target);
    const group = target.trapGroupId ?? `choice_group_${Math.round(target.x)}`;
    target.trapGroupId = group;
    target.trapHost = true;
    target.trapType = 'adaptiveChoiceGateJump';
    target.trapState = 'idle';
    target.trapReason = 'You keep jumping at this gate; spikes shoot up to block the jump lane';
    // Keep bar at its original height — spikes grow upward instead.
    target.currentHeight = target.height;
    target.trapInitialHeight = target.currentHeight;
    // Baseline visible mutation so every learned jump-gate is clearly "AI-modified".
    target.currentSpikeExt = 12;
    target.targetSpikeExt = 120;
    target.warningTimer = Math.max(0.14, warningDuration(levelIndex, 'counter'));
    appliedCount++;
    if (usedFallback) fallbackCount++;
    targetIds.push(group);
  }

  return { appliedCount, fallbackCount, targetIds };
}

// Crouch-counter: bar drops to floor (height → 2) — player must jump over it.
// No linked spike needed; the bar itself blocks the ground/crouch route.
function hostCounterCrouchChoices(
  obstacles: Obstacle[],
  _reactionSpacing: number,
  perObstacleStats: Record<string, ObstacleChoiceStats>,
): { appliedCount: number; fallbackCount: number; targetIds: string[] } {
  const targets = pickChoiceMutationHosts(obstacles, 'crouch', perObstacleStats);
  if (targets.length === 0) return { appliedCount: 0, fallbackCount: 0, targetIds: [] };

  let appliedCount = 0;
  let fallbackCount = 0;
  const targetIds: string[] = [];
  const spacedTargets = enforceChoiceHostSpacing(targets, MIN_CHOICE_HOST_SPACING);
  for (const { obstacle: target, usedFallback } of spacedTargets) {
    initializeRuntimeFields(target);
    const group = target.trapGroupId ?? `choice_group_${Math.round(target.x)}`;
    target.trapGroupId = group;
    target.trapHost = true;
    target.trapType = 'adaptiveChoiceGateCrouch';
    target.trapState = 'idle';
    target.trapReason = 'You keep crouching at this gate; bar drops to floor — you must jump';
    target.currentHeight = target.height;
    target.trapInitialHeight = target.height;
    target.targetHeight = 2;
    appliedCount++;
    if (usedFallback) fallbackCount++;
    targetIds.push(group);
  }

  return { appliedCount, fallbackCount, targetIds };
}

function hostLandingPunisher(obstacles: Obstacle[], predictedLandingX: number): boolean {
  const spikeX = predictedLandingX - 22;
  if (obstacles.some((o) => rangesOverlap(o.x, o.x + o.width, spikeX - 24, spikeX + 68) && o.kind !== 'gap')) {
    return false;
  }

  obstacles.push(initializeRuntimeFields({
    kind: 'spike',
    x: spikeX,
    width: 44,
    height: 52,
    trapHost: true,
    trapType: 'landingPunisher',
    trapState: 'idle',
    trapReason: `Predicted your landing around ${Math.round(predictedLandingX)}px`,
    currentHeight: 8,
    targetHeight: 52,
    trapInitialHeight: 8,
  }));
  return true;
}

function hostCollapsingPlatform(
  obstacles: Obstacle[],
  interactionStats: PlayerModel['perObstacleInteractionStats'],
  preferredRoute?: 'lower' | 'mid' | 'upper',
): boolean {
  const target = pickObstacleByRoute(
    obstacles,
    (o) => o.kind === 'platform' && !o.trapHost,
    preferredRoute,
    interactionStats,
  );
  if (!target) return false;

  initializeRuntimeFields(target);
  target.trapHost = true;
  target.trapType = 'collapsingPlatform';
  target.trapState = 'idle';
  target.currentHeight = target.height;
  target.trapInitialHeight = target.height;
  target.targetHeight = 0;
  target.trapReason = 'You trust platforms; this one will shake then collapse';
  return true;
}

function hostShiftingGap(
  obstacles: Obstacle[],
  levelIndex: number,
  reactionTiming: PlayerModel['reactionTiming'],
  interactionStats: PlayerModel['perObstacleInteractionStats'],
  preferredRoute?: 'lower' | 'mid' | 'upper',
): boolean {
  const maxJump = calculateMaxJumpDistance();
  const target = pickObstacleByRoute(
    obstacles,
    (o) => o.kind === 'gap' && !o.trapHost && o.width < maxJump * 0.82,
    preferredRoute,
    interactionStats,
  );
  if (!target) return false;

  initializeRuntimeFields(target);
  const shift = clamp(26 + levelIndex * 2, 26, 54);
  const widened = Math.min(target.width + shift, Math.floor(maxJump * 0.88));
  const delta = widened - target.width;
  if (delta <= 6) return false;

  target.trapHost = true;
  target.trapType = 'shiftingGap';
  target.trapState = 'idle';
  target.currentWidth = target.width;
  target.trapInitialWidth = target.width;
  target.targetWidth = widened;
  target.currentX = target.x;
  target.trapInitialX = target.x;

  if (reactionTiming === 'late') {
    target.targetX = target.x - delta;
    target.trapReason = 'Late reactions detected; near edge is shifting toward you';
  } else if (reactionTiming === 'early') {
    target.targetX = target.x;
    target.trapReason = 'Early jump timing detected; far edge is extending away';
  } else {
    target.targetX = target.x - Math.round(delta * 0.35);
    target.trapReason = 'Balanced timing detected; both gap edges are shifting';
  }

  return true;
}

function applyMutationProgress(obs: Obstacle, t: number): void {
  if (obs.kind === 'lowCeiling') {
    const from = obs.currentHeight ?? obs.height;
    const to = obs.targetHeight ?? obs.height;
    obs.currentHeight = lerp(from, to, t);
    return;
  }

  if (obs.kind === 'spike' || obs.kind === 'doubleSpike') {
    const start = Math.min(obs.currentHeight ?? obs.height, obs.height);
    const target = obs.targetHeight ?? obs.height;
    obs.currentHeight = lerp(start, target, t);
    return;
  }

  if (obs.kind === 'gap') {
    const startW = obs.width;
    const targetW = obs.targetWidth ?? obs.width;
    const startX = obs.x;
    const targetX = obs.targetX ?? obs.x;
    obs.currentWidth = lerp(startW, targetW, t);
    obs.currentX = lerp(startX, targetX, t);
    return;
  }

  if (obs.kind === 'platform' && obs.trapType === 'collapsingPlatform') {
    const collapseFrom = obs.height;
    const collapseTo = obs.targetHeight ?? 0;
    obs.currentHeight = Math.max(0, lerp(collapseFrom, collapseTo, t));
    if (obs.currentHeight <= 1.5) {
      obs.currentHeight = 0;
    }
    return;
  }

  if (obs.kind === 'choiceObstacle' && obs.trapType === 'adaptiveChoiceGateJump') {
    // Animate spike extension; bar height unchanged.
    const from = obs.currentSpikeExt ?? 0;
    const to = obs.targetSpikeExt ?? 120;
    obs.currentSpikeExt = lerp(from, to, t);
    obs.animationProgress = t;
    return;
  }

  if (obs.kind === 'choiceObstacle' && obs.trapType === 'adaptiveChoiceGateCrouch') {
    // Bar drops to floor.
    const from = obs.currentHeight ?? obs.height;
    const to = obs.targetHeight ?? obs.height;
    obs.currentHeight = lerp(from, to, t);
    obs.animationProgress = t;
    return;
  }

  if (obs.kind === 'platform' && obs.trapType === 'platformNeedle') {
    const from = obs.currentSpikeExt ?? 0;
    const to = obs.targetSpikeExt ?? 34;
    obs.currentSpikeExt = lerp(from, to, t);
    obs.animationProgress = t;
    return;
  }

  if (obs.kind === 'platform') {
    // Mild shake-only signal for armed/warning states.
    obs.animationProgress = t;
  }

}

function canTriggerSafely(obs: Obstacle, player: TrapPlayerSnapshot, groundY: number): boolean {
  const ox = obs.currentX ?? obs.x;
  const ow = obs.currentWidth ?? obs.width;
  const oh = obs.kind === 'choiceObstacle'
    ? (obs.currentHeight ?? obs.height)
    : (obs.targetHeight ?? obs.currentHeight ?? obs.height);

  const playerLeft = player.x;
  const playerRight = player.x + player.width;
  const playerTop = player.y;
  const playerBottom = player.y + player.height;

  // Must be in front of the player.
  if (ox <= playerRight + 6) return false;

  if (obs.kind === 'gap') {
    return !(playerLeft >= ox && playerRight <= ox + ow);
  }

  if (obs.kind === 'platform') {
    if (obs.trapType === 'platformNeedle') {
      const platformTop = groundY - (obs.currentHeight ?? obs.height);
      const xOverlap = playerRight > ox + 4 && playerLeft < ox + ow - 4;
      const touchingTopBand = playerBottom > platformTop - 2 && playerTop < platformTop + 12;
      return !(xOverlap && touchingTopBand);
    }
    return true;
  }

  let hazardTop = groundY - oh;
  let hazardBottom = groundY;
  if (obs.kind === 'lowCeiling') {
    hazardTop = groundY - oh - 16;
    hazardBottom = groundY - oh;
  } else if (obs.kind === 'choiceObstacle') {
    hazardTop = groundY - oh - 12;
    hazardBottom = groundY - oh;
  }

  const xOverlap = playerRight > ox && playerLeft < ox + ow;
  const yOverlap = playerBottom > hazardTop && playerTop < hazardBottom;
  return !(xOverlap && yOverlap);
}

function isPlayerInsideTrap(obs: Obstacle, player: TrapPlayerSnapshot, groundY: number): boolean {
  const ox = obs.currentX ?? obs.x;
  const ow = obs.currentWidth ?? obs.width;
  const oh = obs.kind === 'choiceObstacle'
    ? (obs.currentHeight ?? obs.height)
    : (obs.targetHeight ?? obs.currentHeight ?? obs.height);

  const playerLeft = player.x;
  const playerRight = player.x + player.width;
  const playerTop = player.y;
  const playerBottom = player.y + player.height;

  let hazardTop = groundY - oh;
  let hazardBottom = groundY;
  if (obs.kind === 'lowCeiling') {
    hazardTop = groundY - oh - 16;
    hazardBottom = groundY - oh;
  } else if (obs.kind === 'choiceObstacle') {
    const spikeExt = obs.trapType === 'adaptiveChoiceGateJump' ? (obs.currentSpikeExt ?? 0) : 0;
    hazardTop = groundY - oh - 12 - spikeExt;
    hazardBottom = groundY - oh;
  }

  const xOverlap = playerRight > ox && playerLeft < ox + ow;
  const yOverlap = playerBottom > hazardTop && playerTop < hazardBottom;
  return xOverlap && yOverlap;
}

function shouldArmTrap(
  obs: Obstacle,
  player: TrapPlayerSnapshot,
  ahead: number,
  phase: AIPhase,
  groundY: number,
): boolean {
  if (obs.trapType === 'collapsingPlatform') {
    return isPlayerOnPlatform(obs, player.x, player.y, player.width, player.height, groundY);
  }
  if (obs.trapType === 'adaptiveChoiceGateJump' || obs.trapType === 'adaptiveChoiceGateCrouch') {
    // Arm early, and keep a small catch-up window after passing so fast traversal
    // cannot skip mutation entirely for a choice gate.
    if (ahead <= armDistanceForPhase(phase) + 140 && ahead > 95) return true;
    if (ahead <= 95 && ahead > -30 && !isPlayerInsideTrap(obs, player, groundY)) return true;
    return false;
  }
  if (obs.trapType === 'popUpSpike') {
    // Arm with enough lead time for the warning glow to be visible and reacted to.
    return ahead <= 210 && ahead > 65;
  }
  if (obs.trapType === 'platformNeedle') {
    if (isPlayerOnPlatform(obs, player.x, player.y, player.width, player.height, groundY)) {
      return false;
    }
    // Give a visible warning, but keep enough time for a skilled reroute.
    return ahead <= 220 && ahead > 70;
  }
  return ahead <= armDistanceForPhase(phase) && ahead > 14;
}

// Pop-up spike: hidden at height=0, erupts from ground when player approaches.
// Placed at build time so it's invisible until armed; gives ~0.2s warning via ground glow.
function hostPopUpSpike(
  obstacles: Obstacle[],
  levelIndex: number,
  preferredRoute?: 'lower' | 'mid' | 'upper',
): boolean {
  const clearRadius = 72;
  const minX = 420 + levelIndex * 24;
  const maxX = 1900 + levelIndex * 80;
  const step = 86;
  const candidates: number[] = [];

  for (let x = minX; x <= maxX; x += step) {
    const inGap = obstacles.some((o) => o.kind === 'gap' && x >= o.x && x + 44 <= o.x + o.width);
    if (inGap) continue;
    const clear = !obstacles.some((o) => {
      if (o.kind === 'gap') return false;
      return rangesOverlap(o.x - clearRadius, o.x + o.width + clearRadius, x, x + 44);
    });
    if (clear) candidates.push(x);
  }

  if (candidates.length === 0) return false;
  let idx = Math.abs(levelIndex * 7 + obstacles.length) % candidates.length;
  if (preferredRoute === 'lower') {
    idx = Math.floor(candidates.length * 0.65) % candidates.length;
  }
  const spikeX = candidates[idx];
  obstacles.push(initializeRuntimeFields({
    kind: 'spike',
    x: spikeX,
    width: 44,
    height: 52,
    trapHost: true,
    trapType: 'popUpSpike',
    trapState: 'idle',
    trapReason: 'Hidden spike erupts from ground — jump!',
    currentHeight: 0,
    targetHeight: 52,
    trapInitialHeight: 0,
  }));
  return true;
}

// Platform needle: a regular-looking tile that mutates by growing spikes upward.
// Selection is conservative: only middle platforms inside multi-platform gaps are used,
// which preserves at least one alternate route and keeps the section beatable.
function hostPlatformNeedle(
  obstacles: Obstacle[],
  preferredRoute?: 'lower' | 'mid' | 'upper',
): boolean {
  const gaps = obstacles.filter((o) => o.kind === 'gap');
  const platforms = obstacles
    .filter((o) => o.kind === 'platform' && !o.trapHost && o.width >= 56)
    .sort((a, b) => a.x - b.x);
  if (gaps.length === 0 || platforms.length < 3) return false;

  const maxJump = calculateMaxJumpDistance();
  const candidates: Obstacle[] = [];
  for (const gap of gaps) {
    const gx = gap.x;
    const gr = gap.x + gap.width;
    const inside = platforms.filter((p) => p.x >= gx && p.x + p.width <= gr);
    if (inside.length < 3) continue;

    for (let i = 1; i < inside.length - 1; i++) {
      const prev = inside[i - 1];
      const cur = inside[i];
      const next = inside[i + 1];
      const leftSpan = cur.x - (prev.x + prev.width);
      const rightSpan = next.x - (cur.x + cur.width);
      if (leftSpan > maxJump * 0.82 || rightSpan > maxJump * 0.82) continue;
      candidates.push(cur);
    }
  }

  if (candidates.length === 0) return false;
  const filtered = preferredRoute
    ? candidates.filter((c) => c.routeLayer === preferredRoute)
    : candidates;
  const pool = filtered.length > 0 ? filtered : candidates;
  const target = pool[Math.floor(pool.length / 2)];
  initializeRuntimeFields(target);
  target.trapHost = true;
  target.trapType = 'platformNeedle';
  target.trapState = 'idle';
  target.currentSpikeExt = 0;
  target.targetSpikeExt = 34;
  target.trapReason = 'You keep trusting these tiles; this one now grows spikes';
  return true;
}

function hostVanishingUpperPlatform(
  obstacles: Obstacle[],
  interactionStats: PlayerModel['perObstacleInteractionStats'],
): boolean {
  const candidates = obstacles
    .filter((o) => o.kind === 'platform' && !o.trapHost && o.routeLayer === 'upper')
    .filter((o) => hasSafeDropBelow(o, obstacles));
  if (candidates.length === 0) return false;

  const scored = candidates
    .map((o, index) => ({
      obstacle: o,
      score: scoreObstacleInteraction(o, interactionStats) - index * 0.001,
    }))
    .sort((a, b) => b.score - a.score);
  const target = scored[0]?.obstacle;
  if (!target) return false;

  initializeRuntimeFields(target);
  target.trapHost = true;
  target.trapType = 'vanishingUpperPlatform';
  target.trapState = 'idle';
  target.trapReason = 'You keep committing to this upper tile; it will vanish and force a route swap';
  return true;
}

function activateVanishingPlatform(platform: Obstacle, routeConfidence: number): void {
  if (platform.kind !== 'platform') return;
  // High confidence: player always touches → crumble on touch (350ms warning)
  // Lower confidence: player heads there but not guaranteed → pre-vanish as they approach
  const usesBreakOnTouch = routeConfidence >= 0.7;
  platform.disappearMode = usesBreakOnTouch ? 'onTouch' : 'onApproach';
  platform.disappearDelayMs = usesBreakOnTouch ? 350 : undefined;
  platform.approachTriggerPx = usesBreakOnTouch ? undefined : 260;
  platform.reappearDelayMs = 1200;
  platform.maxDisappearCount = null;
  platform.disappearState = 'visible';
  platform.disappearTimer = 0;
  platform.disappearCount = 0;
  platform.approachWarning = false;
}

function hasSafeDropBelow(platform: Obstacle, obstacles: Obstacle[]): boolean {
  const left = platform.x + 8;
  const right = platform.x + platform.width - 8;
  if (left >= right) return false;

  const hitsGap = obstacles.some((o) =>
    o.kind === 'gap' &&
    rangesOverlap(left, right, o.x + 8, o.x + o.width - 8),
  );
  if (hitsGap) return false;

  const hitsGroundHazard = obstacles.some((o) =>
    (o.kind === 'spike' || o.kind === 'doubleSpike' || o.kind === 'lowCeiling' || o.kind === 'choiceObstacle') &&
    rangesOverlap(left, right, o.x + 4, o.x + o.width - 4),
  );
  return !hitsGroundHazard;
}

// Pick the best choice gate to mutate. Prefers the gate where the player shows the
// strongest per-obstacle preference for `preferenceType` (jump or crouch). Falls back to
// a gate without a top platform, or any eligible gate.
function pickChoiceMutationHosts(
  obstacles: Obstacle[],
  preferenceType: 'jump' | 'crouch',
  perObstacleStats: Record<string, ObstacleChoiceStats>,
): Array<{ obstacle: Obstacle; usedFallback: boolean }> {
  const choices = obstacles.filter(
    (o) => o.kind === 'choiceObstacle' && (!o.trapType || o.trapType === 'adaptiveChoiceGate' || o.trapType === 'dualPathGate' || o.trapType === 'baitChoiceTrap'),
  );
  if (choices.length === 0) return [];

  // Sort by per-obstacle confidence for the target preference (highest first).
  const withStats = choices
    .map((o) => {
      const id = o.trapGroupId ?? `choice_${Math.round(o.x)}_${Math.round(o.width)}`;
      const stats = perObstacleStats[id];
      const rate = stats ? (preferenceType === 'jump' ? stats.jumpRate : stats.crouchRate) : 0;
      const conf = stats ? stats.confidence : 0;
      return { o, rate, conf };
    })
    .sort((a, b) => b.conf - a.conf || b.rate - a.rate);

  // Prefer gates without a platform directly over them.
  const hasTopPlatform = (choice: Obstacle): boolean => {
    const left = choice.x + 8;
    const right = choice.x + choice.width - 8;
    return obstacles.some((o) => o.kind === 'platform' && rangesOverlap(o.x, o.x + o.width, left, right));
  };

  return withStats.map(({ o, conf }) => ({
    obstacle: o,
    usedFallback: conf <= 0 || hasTopPlatform(o),
  }));
}

function enforceChoiceHostSpacing(
  hosts: Array<{ obstacle: Obstacle; usedFallback: boolean }>,
  minSpacing: number,
): Array<{ obstacle: Obstacle; usedFallback: boolean }> {
  const picked: Array<{ obstacle: Obstacle; usedFallback: boolean }> = [];
  for (const host of hosts) {
    const tooClose = picked.some((p) => Math.abs(p.obstacle.x - host.obstacle.x) < minSpacing);
    if (tooClose) continue;
    picked.push(host);
  }
  return picked;
}

// Reset all trap host obstacles to their initial state so traps can fire again on the next
// run of the same level. Called by game.ts on level restart (not on level advance).
export function resetTrapHosts(obstacles: Obstacle[]): void {
  for (const obs of obstacles) {
    if (!obs.trapHost || !obs.trapType) continue;
    obs.trapState = 'idle';
    obs.trapTimer = 0;
    obs.animationProgress = 0;
    obs.warningTimer = 0;
    obs.triggeredByAI = false;

    if (obs.trapType === 'shiftingGap') {
      obs.currentWidth = obs.trapInitialWidth ?? obs.width;
      obs.currentX = obs.trapInitialX ?? obs.x;
    } else {
      obs.currentHeight = obs.trapInitialHeight ?? (obs.trapType === 'landingPunisher' || obs.trapType === 'popUpSpike' ? 0 : obs.height);
    }
    if (obs.trapType === 'adaptiveChoiceGateJump') {
      obs.currentSpikeExt = 0;
    }
    if (obs.trapType === 'platformNeedle') {
      obs.currentSpikeExt = 0;
    }
  }
}

export function updateCollapsingPlatform(
  platform: Obstacle,
  dt: number,
  playerOnPlatform: boolean,
): void {
  if (platform.trapType !== 'collapsingPlatform') return;
  initializeRuntimeFields(platform);

  if (platform.trapState === 'idle' && playerOnPlatform) {
    platform.trapState = 'warning';
    platform.warningTimer = Math.max(0.12, warningDuration(6, 'predict') * 0.75);
    platform.triggeredByAI = true;
    return;
  }

  if (platform.trapState === 'warning') {
    platform.warningTimer = Math.max(0, (platform.warningTimer ?? 0) - dt);
    if ((platform.warningTimer ?? 0) <= 0) {
      platform.trapState = 'triggered';
      platform.trapTimer = 0;
      platform.animationProgress = 0;
    }
    return;
  }

  if (platform.trapState === 'triggered') {
    platform.trapTimer = (platform.trapTimer ?? 0) + dt;
    const t = clamp01((platform.trapTimer ?? 0) / 0.35);
    applyMutationProgress(platform, t);
    if (t >= 1) {
      platform.trapState = 'spent';
    }
  }
}

export function isPlayerOnPlatform(
  platform: Obstacle,
  playerX: number,
  playerY: number,
  playerWidth: number,
  playerHeight: number,
  groundY: number,
): boolean {
  const platformTop = groundY - (platform.currentHeight ?? platform.height);
  const playerBottom = playerY + playerHeight;
  const playerLeft = playerX;
  const playerRight = playerX + playerWidth;
  const platformLeft = platform.currentX ?? platform.x;
  const platformRight = platformLeft + (platform.currentWidth ?? platform.width);

  const horizontalOverlap = playerRight > platformLeft && playerLeft < platformRight;
  const verticalTouch = Math.abs(playerBottom - platformTop) < 6;

  return horizontalOverlap && verticalTouch;
}

function trapTriggerMessage(
  trapType: string,
  predictedAction: 'jump' | 'crouch' | 'mixed' | 'unknown',
  predictedLandingX?: number,
): string {
  switch (trapType) {
    case 'adaptiveChoiceGateJump':
      return 'You jumped at every choice. Spikes are shooting up.';
    case 'adaptiveChoiceGateCrouch':
      return 'You kept crouching. I dropped the bar to the floor.';
    case 'popUpSpike':
      return 'Ground spike — jump now!';
    case 'platformNeedle':
      return 'You trusted that tile. It grew spikes.';
    case 'landingPunisher':
      return predictedLandingX !== undefined
        ? `I predicted that landing near ${Math.round(predictedLandingX)}px.`
        : 'I predicted that landing.';
    case 'collapsingPlatform':
      return 'You trusted that platform again.';
    case 'shiftingGap':
      return predictedAction === 'jump'
        ? 'You jump early, so I stretched the far edge.'
        : 'Your timing is late, so I shifted the near edge.';
    case 'reactiveLowCeiling':
      return 'You used the crouch lane. I sealed it.';
    case 'vanishingUpperPlatform':
      return 'You keep taking upper tiles. This one now disappears.';
    default:
      return 'I changed the trap while you approached it.';
  }
}

function armDistanceForPhase(phase: AIPhase): number {
  switch (phase) {
    case 'test':
      return 230;
    case 'counter':
      return 280;
    case 'predict':
      return 320;
    case 'dominate':
      return 360;
    case 'observe':
    default:
      return 0;
  }
}

function warningDuration(levelIndex: number, phase: AIPhase): number {
  const base = clamp(0.32 - levelIndex * 0.01, 0.16, 0.32);
  if (phase === 'dominate') return Math.max(0.12, base - 0.03);
  if (phase === 'predict') return Math.max(0.14, base - 0.015);
  return base;
}

function mutationDurationForType(trapType?: string): number {
  switch (trapType) {
    case 'reactiveLowCeiling':
      return 0.2;
    case 'adaptiveChoiceGateJump':
      return 0.14;
    case 'adaptiveChoiceGateCrouch':
    case 'landingPunisher':
      return 0.17;
    case 'popUpSpike':
      return 0.11;
    case 'platformNeedle':
      return 0.16;
    case 'vanishingUpperPlatform':
      return 0.14;
    case 'shiftingGap':
      return 0.22;
    case 'collapsingPlatform':
      return 0.3;
    default:
      return 0.2;
  }
}

function getPredictedAction(
  model: PlayerModel,
): 'jump' | 'crouch' | 'mixed' | 'unknown' {
  if (model.preferredChoiceAction !== 'unknown') {
    return model.preferredChoiceAction;
  }
  if (model.prefersJump && model.jumpFrequency >= model.crouchFrequency) return 'jump';
  if (model.prefersCrouch && model.crouchFrequency > model.jumpFrequency) return 'crouch';
  return 'mixed';
}

function inferChoicePreference(
  model: PlayerModel,
  levelIndex: number,
): 'jump' | 'crouch' | null {
  if (model.preferredChoiceAction === 'jump' || model.preferredChoiceAction === 'crouch') {
    return model.preferredChoiceAction;
  }
  if (model.choiceJumpRate > model.choiceCrouchRate + 0.05) return 'jump';
  if (model.choiceCrouchRate > model.choiceJumpRate + 0.05) return 'crouch';
  if (model.jumpFrequency > model.crouchFrequency + 0.06) return 'jump';
  if (model.crouchFrequency > model.jumpFrequency + 0.06) return 'crouch';
  // No strong signal yet: still force mutation variety so traps visibly adapt.
  return levelIndex % 2 === 0 ? 'jump' : 'crouch';
}

// Pick a concrete mutation for bait choice traps.
// Priority:
// 1) specific obstacle stats
// 2) same-family choice history across recent runs
// 3) global choice model
// 4) jump/crouch frequency
// 5) deterministic fallback (x-based alternation)
function resolveBaitChoiceMutation(
  obs: Obstacle,
  model: PlayerModel,
  recentRuns: RunData[],
): 'adaptiveChoiceGateJump' | 'adaptiveChoiceGateCrouch' {
  const obsId = obs.trapGroupId ?? `choice_${Math.round(obs.x)}_${Math.round(obs.width)}`;
  const perObstacle = model.perObstacleChoiceStats?.[obsId];
  if (perObstacle && perObstacle.total >= 1) {
    return perObstacle.jumpRate >= perObstacle.crouchRate
      ? 'adaptiveChoiceGateJump'
      : 'adaptiveChoiceGateCrouch';
  }

  const family = recentRuns
    .slice(-6)
    .flatMap((r) => r.choiceDecisions)
    .filter((d) =>
      d.obstacleType === 'baitChoiceTrap' ||
      d.obstacleType === 'adaptiveChoiceGate' ||
      d.obstacleType === 'dualPathGate',
    );
  if (family.length >= 2) {
    const jumps = family.filter((d) => d.chosenAction === 'jump').length;
    const crouches = family.length - jumps;
    return jumps >= crouches ? 'adaptiveChoiceGateJump' : 'adaptiveChoiceGateCrouch';
  }

  if (model.preferredChoiceAction === 'jump') return 'adaptiveChoiceGateJump';
  if (model.preferredChoiceAction === 'crouch') return 'adaptiveChoiceGateCrouch';

  if (model.jumpFrequency !== model.crouchFrequency) {
    return model.jumpFrequency > model.crouchFrequency
      ? 'adaptiveChoiceGateJump'
      : 'adaptiveChoiceGateCrouch';
  }

  return Math.floor(obs.x / 160) % 2 === 0
    ? 'adaptiveChoiceGateJump'
    : 'adaptiveChoiceGateCrouch';
}

function computePredictedLandingX(runs: RunData[]): number | undefined {
  const recentLandings = runs
    .slice(-4)
    .flatMap((run) => run.landings)
    .slice(-8)
    .map((landing) => landing.x);

  if (recentLandings.length < 2) return undefined;

  const avg = recentLandings.reduce((sum, x) => sum + x, 0) / recentLandings.length;
  return avg;
}

function verifyValidPathExists(obstacles: Obstacle[]): boolean {
  if (hasImpossibleForcedActionChain(obstacles)) {
    return false;
  }

  const maxJump = calculateMaxJumpDistance();
  const gaps = obstacles.filter((o) => o.kind === 'gap');
  const platforms = obstacles.filter((o) => o.kind === 'platform');

  for (const gap of gaps) {
    const width = gap.targetWidth ?? gap.currentWidth ?? gap.width;
    if (width <= maxJump * 0.9) continue;
    const gx = gap.currentX ?? gap.x;
    const gw = width;
    const internalPlatforms = platforms.filter((p) => {
      const px = p.currentX ?? p.x;
      const pw = p.currentWidth ?? p.width;
      return px >= gx && px + pw <= gx + gw;
    });
    if (internalPlatforms.length === 0) {
      return false;
    }
  }

  return true;
}

function hasImpossibleForcedActionChain(obstacles: Obstacle[]): boolean {
  const ordered = [...obstacles].sort((a, b) => (a.currentX ?? a.x) - (b.currentX ?? b.x));
  for (let i = 0; i < ordered.length; i++) {
    const current = ordered[i];
    if (!isForcedActionObstacle(current)) continue;
    const currentX = current.currentX ?? current.x;
    const currentW = current.currentWidth ?? current.width;

    for (let j = i + 1; j < ordered.length; j++) {
      const next = ordered[j];
      const nextX = next.currentX ?? next.x;
      if (nextX - (currentX + currentW) >= FORCED_ACTION_RECOVERY_GAP) break;
      if (isGroundSpike(next)) return true;
    }
  }
  return false;
}

function isForcedActionObstacle(o: Obstacle): boolean {
  return o.kind === 'lowCeiling' || o.kind === 'choiceObstacle';
}

function isGroundSpike(o: Obstacle): boolean {
  return o.kind === 'spike' || o.kind === 'doubleSpike';
}

function initializeRuntimeFields<T extends Obstacle>(obs: T): T {
  if (obs.trapState === undefined) obs.trapState = 'idle';
  if (obs.currentHeight === undefined) obs.currentHeight = obs.height;
  if (obs.targetHeight === undefined) obs.targetHeight = obs.height;
  if (obs.currentX === undefined) obs.currentX = obs.x;
  if (obs.targetX === undefined) obs.targetX = obs.x;
  if (obs.currentWidth === undefined) obs.currentWidth = obs.width;
  if (obs.targetWidth === undefined) obs.targetWidth = obs.width;
  if (obs.animationProgress === undefined) obs.animationProgress = 0;
  if (obs.warningTimer === undefined) obs.warningTimer = 0;
  if (obs.triggeredByAI === undefined) obs.triggeredByAI = false;
  if (obs.currentSpikeExt === undefined) obs.currentSpikeExt = 0;
  if (obs.targetSpikeExt === undefined) obs.targetSpikeExt = 0;
  return obs;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a1 > b0 && a0 < b1;
}

function pickObstacleByRoute(
  obstacles: Obstacle[],
  predicate: (o: Obstacle) => boolean,
  preferredRoute?: 'lower' | 'mid' | 'upper',
  interactionStats?: PlayerModel['perObstacleInteractionStats'],
): Obstacle | undefined {
  const candidates = obstacles.filter(predicate);
  if (candidates.length === 0) return undefined;

  return candidates
    .map((o, index) => ({
      obstacle: o,
      score:
        (preferredRoute && o.routeLayer === preferredRoute ? 10 : 0) +
        scoreObstacleInteraction(o, interactionStats) -
        index * 0.001,
    }))
    .sort((a, b) => b.score - a.score)[0]?.obstacle;
}

function scoreObstacleInteraction(
  obstacle: Obstacle,
  interactionStats?: PlayerModel['perObstacleInteractionStats'],
): number {
  if (!interactionStats) return 0;
  const id = obstacle.trapGroupId ?? `${obstacle.kind}_${Math.round(obstacle.x)}_${Math.round(obstacle.width)}`;
  const stats = interactionStats[id];
  if (!stats) return 0;
  const actionSignal = stats.preferredAction === 'none' ? 0 : 0.2;
  return stats.confidence + stats.failureRate + actionSignal;
}
