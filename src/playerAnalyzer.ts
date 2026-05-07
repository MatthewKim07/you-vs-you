import { ActionEvent, ObstacleChoiceStats, ObstacleInteractionEvent, ObstacleInteractionStats, PlayerModel, RunData, RouteChoiceEvent, RouteId } from './telemetry';

const WINDOW_RUNS = 5;

export function analyzePlayer(runs: RunData[]): PlayerModel {
  const recentRuns = runs.slice(-WINDOW_RUNS);
  const actionEvents = recentRuns.flatMap((r) => r.actions);
  const jumpCount = actionEvents.filter((a) => a.action === 'jump').length;
  const crouchCount = actionEvents.filter((a) => a.action === 'crouchStart').length;
  const totalDecisionActions = jumpCount + crouchCount;

  const jumpFrequency = totalDecisionActions > 0 ? jumpCount / totalDecisionActions : 0;
  const crouchFrequency = totalDecisionActions > 0 ? crouchCount / totalDecisionActions : 0;

  const prefersJump = jumpFrequency >= crouchFrequency;
  const prefersCrouch = !prefersJump;

  const reactionTiming = classifyReactionTiming(recentRuns);
  const consistency = classifyConsistency(recentRuns);
  const riskProfile = classifyRiskProfile(recentRuns, reactionTiming);

  // Choice preference analysis
  const choiceStats = analyzeChoiceDecisions(recentRuns);
  const perObstacleInteractionStats = buildPerObstacleInteractionStats(recentRuns);
  const routeStats = analyzeRouteBehavior(recentRuns);

  return {
    prefersJump,
    prefersCrouch,
    jumpFrequency,
    crouchFrequency,
    reactionTiming,
    consistency,
    riskProfile,
    choiceJumpRate: choiceStats.jumpRate,
    choiceCrouchRate: choiceStats.crouchRate,
    choiceConfidence: choiceStats.confidence,
    preferredChoiceAction: choiceStats.preferred,
    choiceConsistency: choiceStats.choiceConsistency,
    perObstacleChoiceStats: choiceStats.perObstacleStats,
    perObstacleInteractionStats,
    preferredRoute: routeStats.preferredRoute,
    routeConfidence: routeStats.routeConfidence,
    routeRiskStyle: routeStats.routeRiskStyle,
    routeUsage: routeStats.routeUsage,
  };
}

function buildPerObstacleInteractionStats(runs: RunData[]): Record<string, ObstacleInteractionStats> {
  const byId: Record<string, ObstacleInteractionEvent[]> = {};
  for (const ev of runs.flatMap((r) => r.obstacleInteractions ?? [])) {
    if (!byId[ev.obstacleId]) byId[ev.obstacleId] = [];
    byId[ev.obstacleId].push(ev);
  }

  const result: Record<string, ObstacleInteractionStats> = {};
  for (const [obstacleId, events] of Object.entries(byId)) {
    const total = events.length;
    const passCount = events.filter((e) => e.outcome === 'passed').length;
    const deathCount = total - passCount;
    const jumpCount = events.filter((e) => e.action === 'jump').length;
    const crouchCount = events.filter((e) => e.action === 'crouch').length;
    const mixedCount = events.filter((e) => e.action === 'mixed').length;
    const noneCount = events.filter((e) => e.action === 'none').length;
    const actionCounts = [
      { action: 'jump' as const, count: jumpCount },
      { action: 'crouch' as const, count: crouchCount },
      { action: 'mixed' as const, count: mixedCount },
      { action: 'none' as const, count: noneCount },
    ].sort((a, b) => b.count - a.count);
    const first = events[0];
    result[obstacleId] = {
      obstacleId,
      obstacleKind: first.obstacleKind,
      trapType: first.trapType,
      routeLayer: first.routeLayer,
      x: first.x,
      total,
      passCount,
      deathCount,
      jumpCount,
      crouchCount,
      mixedCount,
      noneCount,
      preferredAction: actionCounts[0]?.action ?? 'none',
      failureRate: total > 0 ? deathCount / total : 0,
      confidence: Math.min(1, total / 4),
    };
  }
  return result;
}

function analyzeRouteBehavior(runs: RunData[]): {
  preferredRoute: PlayerModel['preferredRoute'];
  routeConfidence: number;
  routeRiskStyle: PlayerModel['routeRiskStyle'];
  routeUsage: Record<RouteId, number>;
} {
  const usage: Record<RouteId, number> = { lower: 0, mid: 0, upper: 0 };
  const routeEvents = runs.flatMap((r) => r.routeChoices);

  for (const run of runs) {
    usage.lower += run.routeUsageCounts?.lower ?? 0;
    usage.mid += run.routeUsageCounts?.mid ?? 0;
    usage.upper += run.routeUsageCounts?.upper ?? 0;
  }

  const totalPresence = usage.lower + usage.mid + usage.upper;
  const totalEvents = routeEvents.length;
  if (totalPresence === 0 && totalEvents === 0) {
    return {
      preferredRoute: 'mixed',
      routeConfidence: 0,
      routeRiskStyle: 'opportunist',
      routeUsage: usage,
    };
  }

  const normalized = totalPresence > 0
    ? {
      lower: usage.lower / totalPresence,
      mid: usage.mid / totalPresence,
      upper: usage.upper / totalPresence,
    }
    : { lower: 1 / 3, mid: 1 / 3, upper: 1 / 3 };

  const pairs = ([
    { id: 'lower' as RouteId, value: normalized.lower },
    { id: 'mid' as RouteId, value: normalized.mid },
    { id: 'upper' as RouteId, value: normalized.upper },
  ]).sort((a, b) => b.value - a.value);

  const dominant = pairs[0];
  const runnerUp = pairs[1];
  const dominanceGap = dominant.value - runnerUp.value;
  const preferredRoute: PlayerModel['preferredRoute'] = dominanceGap >= 0.15 ? dominant.id : 'mixed';

  const volumeConfidence = Math.min(1, (totalEvents + totalPresence * 0.2) / 12);
  const routeConfidence = Math.max(0, Math.min(1, volumeConfidence * (preferredRoute === 'mixed' ? 0.55 : 0.9)));

  const switches = countRouteSwitches(routeEvents);
  const switchRate = totalEvents > 1 ? switches / (totalEvents - 1) : 0;
  let routeRiskStyle: PlayerModel['routeRiskStyle'];
  if (switchRate >= 0.55) {
    routeRiskStyle = 'opportunist';
  } else if (preferredRoute !== 'mixed' && dominanceGap >= 0.2) {
    routeRiskStyle = 'committed';
  } else {
    routeRiskStyle = 'safe-switcher';
  }

  return { preferredRoute, routeConfidence, routeRiskStyle, routeUsage: usage };
}

function countRouteSwitches(events: RouteChoiceEvent[]): number {
  if (events.length <= 1) return 0;
  let switches = 0;
  for (let i = 1; i < events.length; i++) {
    if (events[i].routeId !== events[i - 1].routeId) switches++;
  }
  return switches;
}

// Analyze choice obstacle decisions across recent runs.
// Only ChoiceDecisionEvents are used — global jump/crouch actions are excluded.
function analyzeChoiceDecisions(runs: RunData[]): {
  jumpRate: number;
  crouchRate: number;
  confidence: number;
  preferred: PlayerModel['preferredChoiceAction'];
  choiceConsistency: PlayerModel['choiceConsistency'];
  perObstacleStats: Record<string, ObstacleChoiceStats>;
} {
  const allChoices = runs.flatMap((r) => r.choiceDecisions);

  // Build per-obstacle stats before global aggregation.
  const perObstacleStats = buildPerObstacleStats(allChoices);

  if (allChoices.length === 0) {
    return { jumpRate: 0, crouchRate: 0, confidence: 0, preferred: 'unknown', choiceConsistency: 'unknown', perObstacleStats };
  }

  const jumpChoices = allChoices.filter((c) => c.chosenAction === 'jump').length;
  const crouchChoices = allChoices.filter((c) => c.chosenAction === 'crouch').length;
  const total = allChoices.length;

  const jumpRate = total > 0 ? jumpChoices / total : 0;
  const crouchRate = total > 0 ? crouchChoices / total : 0;

  let preferred: PlayerModel['preferredChoiceAction'];
  if (jumpRate > 0.65) preferred = 'jump';
  else if (crouchRate > 0.65) preferred = 'crouch';
  else preferred = 'mixed';

  const dominance = Math.max(jumpRate, crouchRate);
  const volumeConfidence = Math.min(1, total / 5);
  const preferenceStrength = preferred === 'mixed' ? 0.28 : Math.max(0.75, dominance);
  const confidence = Math.max(0, Math.min(1, volumeConfidence * preferenceStrength));

  // Consistency across runs
  let choiceConsistency: PlayerModel['choiceConsistency'] = 'unknown';
  if (runs.length >= 2) {
    const runRates = runs
      .filter((r) => r.choiceDecisions.length > 0)
      .map((r) => {
        const j = r.choiceDecisions.filter((c) => c.chosenAction === 'jump').length;
        return j / r.choiceDecisions.length;
      });
    if (runRates.length >= 2) {
      const runMean = runRates.reduce((a, b) => a + b, 0) / runRates.length;
      const variance = runRates.reduce((sum, r) => sum + (r - runMean) * (r - runMean), 0) / runRates.length;
      const stddev = Math.sqrt(variance);
      choiceConsistency = stddev < 0.2 ? 'predictable' : 'mixed';
    }
  }

  return { jumpRate, crouchRate, confidence, preferred, choiceConsistency, perObstacleStats };
}

// Compute per-obstacle stats from choice decisions only (gate-scoped, no global noise).
function buildPerObstacleStats(
  choices: import('./telemetry').ChoiceDecisionEvent[],
): Record<string, ObstacleChoiceStats> {
  const byId: Record<string, { j: number; c: number }> = {};
  for (const ev of choices) {
    if (!byId[ev.obstacleId]) byId[ev.obstacleId] = { j: 0, c: 0 };
    if (ev.chosenAction === 'jump') byId[ev.obstacleId].j++;
    else byId[ev.obstacleId].c++;
  }

  const result: Record<string, ObstacleChoiceStats> = {};
  for (const [id, counts] of Object.entries(byId)) {
    const total = counts.j + counts.c;
    const jumpRate = total > 0 ? counts.j / total : 0;
    const crouchRate = total > 0 ? counts.c / total : 0;
    const dominance = Math.max(jumpRate, crouchRate);
    const volumeConf = Math.min(1, total / 4);
    let preferred: ObstacleChoiceStats['preferred'];
    if (jumpRate > 0.65) preferred = 'jump';
    else if (crouchRate > 0.65) preferred = 'crouch';
    else preferred = 'mixed';
    const preferenceStrength = preferred === 'mixed' ? 0.28 : Math.max(0.75, dominance);
    const confidence = Math.max(0, Math.min(1, volumeConf * preferenceStrength));
    result[id] = { obstacleId: id, jumpCount: counts.j, crouchCount: counts.c, total, jumpRate, crouchRate, confidence, preferred };
  }
  return result;
}

function classifyReactionTiming(runs: RunData[]): PlayerModel['reactionTiming'] {
  const leadDistances: number[] = [];

  for (const run of runs) {
    if (run.actions.length === 0) continue;

    const hazardX = inferHazardX(run);
    const decision = latestDecisionBefore(run.actions, hazardX + 30);
    if (!decision) continue;

    leadDistances.push(hazardX - decision.x);
  }

  if (leadDistances.length === 0) {
    return 'balanced';
  }

  const avgLead = mean(leadDistances);
  if (avgLead > 240) return 'early';
  if (avgLead < 120) return 'late';
  return 'balanced';
}

function classifyConsistency(runs: RunData[]): PlayerModel['consistency'] {
  if (runs.length < 2) return 'mixed';

  const signatures = runs.map((run) => {
    const jumps = run.actions.filter((a) => a.action === 'jump').length;
    const crouches = run.actions.filter((a) => a.action === 'crouchStart').length;
    const firstDecision = run.actions.find((a) => a.action === 'jump' || a.action === 'crouchStart')?.action ?? 'none';
    return { jumps, crouches, firstDecision };
  });

  const jumpValues = signatures.map((s) => s.jumps);
  const crouchValues = signatures.map((s) => s.crouches);
  const jumpCv = coefficientOfVariation(jumpValues);
  const crouchCv = coefficientOfVariation(crouchValues);

  const firstCounts = new Map<string, number>();
  for (const sig of signatures) {
    firstCounts.set(sig.firstDecision, (firstCounts.get(sig.firstDecision) ?? 0) + 1);
  }
  const dominantFirstRatio = Math.max(...firstCounts.values()) / signatures.length;

  if (jumpCv < 0.35 && crouchCv < 0.5 && dominantFirstRatio >= 0.7) {
    return 'predictable';
  }
  if (jumpCv > 0.9 || crouchCv > 1.0 || dominantFirstRatio < 0.45) {
    return 'random';
  }
  return 'mixed';
}

function classifyRiskProfile(
  runs: RunData[],
  reactionTiming: PlayerModel['reactionTiming'],
): PlayerModel['riskProfile'] {
  if (runs.length === 0) return 'balanced';

  const deaths = runs.filter((r) => !r.completed).length;
  const deathRate = deaths / runs.length;

  if (deathRate <= 0.25 && reactionTiming === 'early') {
    return 'safe';
  }
  if (deathRate >= 0.5 && reactionTiming === 'late') {
    return 'aggressive';
  }
  return 'balanced';
}

function inferHazardX(run: RunData): number {
  if (run.deathX !== undefined) return run.deathX;
  if (run.landings.length > 0) return run.landings[run.landings.length - 1].x;
  if (run.samples.length > 0) return run.samples[run.samples.length - 1].x;
  if (run.actions.length > 0) return run.actions[run.actions.length - 1].x + 150;
  return 700;
}

function latestDecisionBefore(actions: ActionEvent[], xLimit: number): ActionEvent | undefined {
  for (let i = actions.length - 1; i >= 0; i--) {
    const action = actions[i];
    if (action.action !== 'jump' && action.action !== 'crouchStart') continue;
    if (action.x <= xLimit) return action;
  }
  return undefined;
}

function coefficientOfVariation(values: number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  if (avg === 0) return values.some((v) => v !== 0) ? 1 : 0;
  const variance = values.reduce((sum, v) => sum + (v - avg) * (v - avg), 0) / values.length;
  return Math.sqrt(variance) / avg;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
