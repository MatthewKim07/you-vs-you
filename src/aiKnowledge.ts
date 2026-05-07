import { RunData, PlayerModel } from './telemetry';

// AI Learning-based trap system - Task 5
// Calculates confidence scores from player behavior across runs

export interface AIKnowledge {
  runsObserved: number;
  jumpPreferenceConfidence: number; // 0-1
  crouchPreferenceConfidence: number; // 0-1
  landingPredictionConfidence: number; // 0-1
  reactionTimingConfidence: number; // 0-1
  platformRelianceConfidence: number; // 0-1
  overallConfidence: number; // 0-1 weighted average
}

export type AIPhase = 'observe' | 'test' | 'counter' | 'predict' | 'dominate';

// Calculate AI knowledge/confidence from run data
export function calculateKnowledge(runs: RunData[], model: PlayerModel): AIKnowledge {
  const runsWeight = Math.min(1, runs.length / 5); // saturates after 5 runs

  // Jump preference confidence
  const jumpPreferenceConfidence = calculatePreferenceConfidence(
    runs,
    'jump',
    model.jumpFrequency,
    runsWeight,
  );

  // Crouch preference confidence
  const crouchPreferenceConfidence = calculatePreferenceConfidence(
    runs,
    'crouch',
    model.crouchFrequency,
    runsWeight,
  );

  // Landing prediction confidence based on landing position consistency
  const landingPredictionConfidence = calculateLandingPredictionConfidence(runs, runsWeight);

  // Reaction timing confidence based on consistency classification
  const reactionTimingConfidence = calculateReactionTimingConfidence(model, runsWeight);

  // Platform reliance confidence based on platform segment completion
  const platformRelianceConfidence = calculatePlatformRelianceConfidence(runs, runsWeight);

  // Overall confidence - weighted average
  const weights = [0.25, 0.2, 0.2, 0.15, 0.2];
  const values = [
    jumpPreferenceConfidence,
    crouchPreferenceConfidence,
    landingPredictionConfidence,
    reactionTimingConfidence,
    platformRelianceConfidence,
  ];
  const overallConfidence =
    values.reduce((sum, v, i) => sum + v * weights[i], 0) / weights.reduce((a, b) => a + b, 0);

  return {
    runsObserved: runs.length,
    jumpPreferenceConfidence,
    crouchPreferenceConfidence,
    landingPredictionConfidence,
    reactionTimingConfidence,
    platformRelianceConfidence,
    overallConfidence,
  };
}

// Determine AI phase based on confidence and level
export function determinePhase(
  knowledge: AIKnowledge,
  levelIndex: number,
  model?: PlayerModel,
  runs?: RunData[],
): AIPhase {
  const choiceDecisionCount = runs?.slice(-6).reduce((sum, run) => sum + run.choiceDecisions.length, 0) ?? 0;
  const predictableChoice = model?.choiceConsistency === 'predictable';
  const hasChoiceRead = model?.preferredChoiceAction === 'jump' || model?.preferredChoiceAction === 'crouch';
  const confidenceScore =
    knowledge.overallConfidence * 0.68 +
    Math.min(1, choiceDecisionCount / 14) * 0.2 +
    (predictableChoice ? 0.08 : 0) +
    (hasChoiceRead ? 0.04 : 0);

  if (levelIndex <= 1) {
    return 'observe';
  }
  if (confidenceScore < 0.42) {
    return 'test';
  }
  if (confidenceScore < 0.65) {
    return 'counter';
  }
  if (confidenceScore < 0.84 || levelIndex < 6) {
    return 'predict';
  }
  return 'dominate';
}

// Get top learned habit based on highest confidence
export function getTopLearnedHabit(knowledge: AIKnowledge): string | null {
  const habits = [
    { name: 'Jump preference', confidence: knowledge.jumpPreferenceConfidence },
    { name: 'Crouch preference', confidence: knowledge.crouchPreferenceConfidence },
    { name: 'Landing prediction', confidence: knowledge.landingPredictionConfidence },
    { name: 'Reaction timing', confidence: knowledge.reactionTimingConfidence },
    { name: 'Platform reliance', confidence: knowledge.platformRelianceConfidence },
  ];

  const top = habits.sort((a, b) => b.confidence - a.confidence)[0];
  return top.confidence > 0.3 ? top.name : null;
}

// Helper: Calculate preference confidence (jump or crouch)
function calculatePreferenceConfidence(
  runs: RunData[],
  actionType: 'jump' | 'crouch',
  _modelFrequency: number,
  runsWeight: number,
): number {
  if (runs.length === 0) return 0;

  // Calculate per-run ratios
  const ratios: number[] = [];
  for (const run of runs) {
    const jumps = run.actions.filter((a) => a.action === 'jump').length;
    const crouches = run.actions.filter((a) => a.action === 'crouchStart').length;
    const total = jumps + crouches;
    if (total === 0) continue;
    ratios.push(actionType === 'jump' ? jumps / total : crouches / total);
  }

  if (ratios.length === 0) return 0;

  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const stddev = Math.sqrt(
    ratios.reduce((sum, r) => sum + (r - mean) * (r - mean), 0) / ratios.length,
  );

  // Preference strength: how far from 0.5 (balanced)
  const preference = Math.abs(mean - 0.5) * 2; // 0 = balanced, 1 = extreme preference

  // Consistency: low stddev = high consistency
  const consistency = Math.max(0, 1 - stddev * 2);

  return preference * consistency * runsWeight;
}

// Helper: Calculate landing prediction confidence
function calculateLandingPredictionConfidence(runs: RunData[], runsWeight: number): number {
  const allLandings: number[] = [];
  for (const run of runs) {
    for (const landing of run.landings) {
      allLandings.push(landing.x);
    }
  }

  if (allLandings.length < 3) return 0;

  const mean = allLandings.reduce((a, b) => a + b, 0) / allLandings.length;
  const variance =
    allLandings.reduce((sum, x) => sum + (x - mean) * (x - mean), 0) / allLandings.length;
  const stddev = Math.sqrt(variance);

  // Normalize: stddev of 400px = 0 confidence, 0 stddev = 1 confidence
  const consistency = Math.max(0, 1 - Math.min(1, stddev / 400));

  return runsWeight * consistency;
}

// Helper: Calculate reaction timing confidence
function calculateReactionTimingConfidence(model: PlayerModel, runsWeight: number): number {
  // Based on consistency classification
  const consistencyMultiplier =
    model.consistency === 'predictable' ? 0.8 : model.consistency === 'mixed' ? 0.45 : 0.2;

  return runsWeight * consistencyMultiplier;
}

// Helper: Calculate platform reliance confidence
function calculatePlatformRelianceConfidence(runs: RunData[], runsWeight: number): number {
  // Look at runs with platform segments
  const platformRuns = runs.filter(
    (r) =>
      r.generatedVariants?.includes('longGapPlatforms') ||
      r.generatedVariants?.includes('staircaseClimb'),
  );

  if (platformRuns.length === 0) return 0;

  // Calculate completion rate on platform levels
  const completed = platformRuns.filter((r) => r.completed).length;
  const completionRate = completed / platformRuns.length;

  // Higher reliance = lower completion rate (they struggle with platforms)
  // But we need some completions to know they're actually trying
  const relianceScore = completionRate < 0.5 ? 0.7 : completionRate < 0.8 ? 0.4 : 0.2;

  return runsWeight * relianceScore;
}

// Trap unlock gates
export function isTrapUnlocked(trapType: TrapType, knowledge: AIKnowledge): boolean {
  switch (trapType) {
    case 'reactiveLowCeiling':
      return knowledge.jumpPreferenceConfidence > 0.6;
    case 'fakeChoiceObstacle':
      return (
        knowledge.jumpPreferenceConfidence > 0.5 || knowledge.crouchPreferenceConfidence > 0.5
      );
    case 'shiftingGap':
      return knowledge.reactionTimingConfidence > 0.55;
    case 'landingPunisher':
      return knowledge.landingPredictionConfidence > 0.65;
    case 'collapsingPlatform':
      return knowledge.platformRelianceConfidence > 0.6;
    case 'popUpSpike':
      return knowledge.overallConfidence > 0.2;
    case 'platformNeedle':
      return knowledge.overallConfidence > 0.45;
    case 'chainMutation':
      return knowledge.overallConfidence > 0.75;
    default:
      return false;
  }
}

// Max trap hosts per phase
export function getMaxTrapHosts(phase: AIPhase): number {
  switch (phase) {
    case 'observe':
      return 0;
    case 'test':
      return 3;
    case 'counter':
      return 5;
    case 'predict':
      return 7;
    case 'dominate':
      return 9;
  }
}

// Trap types
export type TrapType =
  | 'reactiveLowCeiling'
  | 'fakeChoiceObstacle'
  | 'shiftingGap'
  | 'landingPunisher'
  | 'collapsingPlatform'
  | 'popUpSpike'
  | 'platformNeedle'
  | 'chainMutation';

// Get phase label for display
export function getPhaseLabel(phase: AIPhase): string {
  const labels: Record<AIPhase, string> = {
    observe: 'Observe',
    test: 'Test',
    counter: 'Counter',
    predict: 'Predict',
    dominate: 'Dominate',
  };
  return labels[phase];
}

// Get phase description for AI messages
export function getPhaseDescription(phase: AIPhase, knowledge: AIKnowledge): string {
  switch (phase) {
    case 'observe':
      return "I'm watching how you move.";
    case 'test': {
      const topHabit =
        knowledge.jumpPreferenceConfidence > knowledge.crouchPreferenceConfidence
          ? 'jumping'
          : 'crouching';
      return `You seem to prefer ${topHabit}.`;
    }
    case 'counter': {
      if (knowledge.jumpPreferenceConfidence > 0.5) {
        return 'You keep jumping. I adjusted the ceiling.';
      }
      if (knowledge.crouchPreferenceConfidence > 0.5) {
        return 'You keep crouching. I widened the gaps.';
      }
      return "You're predictable. I've added surprises.";
    }
    case 'predict':
      return 'I knew where you would land.';
    case 'dominate':
      return 'I know your habits and I am mutating traps in real time.';
  }
}
