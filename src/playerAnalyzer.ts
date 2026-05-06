import { ActionEvent, ObstacleChoiceStats, PlayerModel, RunData } from './telemetry';

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
  };
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
