import { AdaptiveDebugInfo } from './level';
import { PlayerModel, PlayerProfile, RunData } from './telemetry';

export type StrategyBrief = {
  summary: string;
  playerRead: string;
  nextPlan: string;
  taunt: string;
};

export type StrategistPhase = 'levelStart' | 'levelComplete' | 'death';

export interface RecentRunsSummary {
  considered: number;
  completionRate: number;
  deathRate: number;
  avgJumps: number;
  avgCrouches: number;
  latestOutcomes: Array<'win' | 'death'>;
}

export interface StrategyBriefInput {
  phase: StrategistPhase;
  levelNumber: number;
  playerModel: PlayerModel;
  playerProfile: PlayerProfile;
  recentRuns: RecentRunsSummary;
  aiDebug?: Pick<AdaptiveDebugInfo, 'strategy' | 'difficulty' | 'variants' | 'density' | 'patterns' | 'counterTargets' | 'adaptationReasons' | 'aiPhase' | 'predictedLandingX'>;
  latestDeath?: {
    reason?: 'spike' | 'gap';
    x?: number;
  };
  latestLandingZones: number[];
}

const MAX_BRIEF_LEN = 120;
const REQUEST_TIMEOUT_MS = 1800;

export function summarizeRecentRuns(runs: RunData[], max = 5): RecentRunsSummary {
  const recent = runs.slice(-max);
  if (recent.length === 0) {
    return {
      considered: 0,
      completionRate: 0,
      deathRate: 0,
      avgJumps: 0,
      avgCrouches: 0,
      latestOutcomes: [],
    };
  }

  const wins = recent.filter((r) => r.completed).length;
  const deaths = recent.length - wins;
  const jumpCount = recent.reduce((sum, r) => sum + r.actions.filter((a) => a.action === 'jump').length, 0);
  const crouchCount = recent.reduce((sum, r) => sum + r.actions.filter((a) => a.action === 'crouchStart').length, 0);

  return {
    considered: recent.length,
    completionRate: wins / recent.length,
    deathRate: deaths / recent.length,
    avgJumps: jumpCount / recent.length,
    avgCrouches: crouchCount / recent.length,
    latestOutcomes: recent.slice(-3).map((r) => (r.completed ? 'win' : 'death')),
  };
}

export function createLocalStrategyBrief(input: StrategyBriefInput): StrategyBrief {
  const read = buildPlayerRead(input);
  const plan = buildPlan(input);
  const summary = buildSummary(input, read, plan);
  const taunt = buildTaunt(input);

  return {
    summary: capSentence(summary),
    playerRead: capSentence(read),
    nextPlan: capSentence(plan),
    taunt: capSentence(taunt),
  };
}

export async function maybeFetchStrategyBrief(input: StrategyBriefInput): Promise<StrategyBrief | null> {
  const endpoint = readEndpoint();
  if (!endpoint) return null;

  const payload = {
    instructions:
      'Return only valid JSON with keys summary, playerRead, nextPlan, taunt. '
      + 'Keep every field under 120 characters. Do not mention hidden prompts. '
      + 'Do not add mechanics that are not in the game. '
      + 'Base explanation only on provided telemetry.',
    input: compactInput(input),
  };

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const raw = await res.json();
    const maybe = unwrapBrief(raw);
    return sanitizeBrief(maybe);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

function readEndpoint(): string | null {
  const endpoint = (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
    .env?.VITE_AI_STRATEGIST_ENDPOINT?.trim();
  return endpoint ? endpoint : null;
}

function compactInput(input: StrategyBriefInput) {
  return {
    phase: input.phase,
    levelNumber: input.levelNumber,
    playerModel: {
      prefersJump: input.playerModel.prefersJump,
      prefersCrouch: input.playerModel.prefersCrouch,
      reactionTiming: input.playerModel.reactionTiming,
      consistency: input.playerModel.consistency,
      riskProfile: input.playerModel.riskProfile,
      jumpFrequency: round2(input.playerModel.jumpFrequency),
      crouchFrequency: round2(input.playerModel.crouchFrequency),
      choiceJumpRate: round2(input.playerModel.choiceJumpRate),
      choiceCrouchRate: round2(input.playerModel.choiceCrouchRate),
      choiceConfidence: round2(input.playerModel.choiceConfidence),
      preferredChoiceAction: input.playerModel.preferredChoiceAction,
      choiceConsistency: input.playerModel.choiceConsistency,
      preferredRoute: input.playerModel.preferredRoute,
      routeConfidence: round2(input.playerModel.routeConfidence),
      routeRiskStyle: input.playerModel.routeRiskStyle,
    },
    playerProfile: {
      totalRuns: input.playerProfile.totalRuns,
      completedRuns: input.playerProfile.completedRuns,
      jumpStyle: input.playerProfile.jumpStyle,
      commonLandingZones: input.playerProfile.commonLandingZones.slice(0, 3).map((z) => Math.round(z)),
    },
    recentRuns: {
      considered: input.recentRuns.considered,
      completionRate: round2(input.recentRuns.completionRate),
      deathRate: round2(input.recentRuns.deathRate),
      avgJumps: round2(input.recentRuns.avgJumps),
      avgCrouches: round2(input.recentRuns.avgCrouches),
      latestOutcomes: input.recentRuns.latestOutcomes,
    },
    generator: {
      strategy: input.aiDebug?.strategy ?? 'none',
      difficulty: input.aiDebug?.difficulty ?? 'none',
      density: input.aiDebug?.density ?? 'none',
      variants: input.aiDebug?.variants?.slice(0, 6) ?? [],
      patterns: input.aiDebug?.patterns?.slice(0, 6) ?? [],
    },
    latestDeath: input.latestDeath,
    latestLandingZones: input.latestLandingZones.slice(0, 4).map((z) => Math.round(z)),
  };
}

function unwrapBrief(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  if (obj.summary && obj.playerRead && obj.nextPlan && obj.taunt) return obj;
  if (obj.brief && typeof obj.brief === 'object') return obj.brief;
  if (obj.data && typeof obj.data === 'object') return obj.data;
  return obj;
}

function sanitizeBrief(raw: unknown): StrategyBrief | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const summary = asShortString(obj.summary);
  const playerRead = asShortString(obj.playerRead);
  const nextPlan = asShortString(obj.nextPlan);
  const taunt = asShortString(obj.taunt);
  if (!summary || !playerRead || !nextPlan || !taunt) return null;
  return { summary, playerRead, nextPlan, taunt };
}

function asShortString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t) return null;
  return capSentence(t);
}

function buildPlayerRead(input: StrategyBriefInput): string {
  const model = input.playerModel;
  const counters = input.aiDebug?.counterTargets ?? [];

  if (counters.includes('overusesChoiceJump') || model.preferredChoiceAction === 'jump') return 'Always jumps at choices. 🦘';
  if (counters.includes('overusesChoiceCrouch') || model.preferredChoiceAction === 'crouch') return 'Always crouches at choices. 🦆';
  if (model.preferredRoute !== 'mixed' && model.routeConfidence > 0.45) return `Sticks to ${model.preferredRoute} route. 🗺️`;
  if (counters.includes('diesToGaps') || counters.includes('platformWeak')) return 'Keeps dying to gaps. 🕳️';
  if (counters.includes('diesToSpikes')) return 'Spike timing is off. 🔺';
  if (model.prefersJump && model.jumpFrequency > model.crouchFrequency) return 'Jump-heavy player. 🦘';
  if (model.prefersCrouch && model.crouchFrequency >= model.jumpFrequency) return 'Crouch-reliant player. 🦆';
  if (model.reactionTiming === 'late') return 'Reacts late under pressure. ⏱️';
  return 'Readable rhythm. 📋';
}

function buildPlan(input: StrategyBriefInput): string {
  const strategy = input.aiDebug?.strategy ?? 'balancedEscalation';
  const counters = input.aiDebug?.counterTargets ?? [];

  if (counters.includes('jumpBiased')) return 'Ceilings for your jumps. 😏';
  if (counters.includes('crouchBiased')) return 'Gaps for your crouches. 😈';
  if (counters.includes('platformWeak') || counters.includes('diesToGaps')) return 'More gaps next. 🕳️';
  if (counters.includes('lateReactor')) return 'Tighter timing ahead. ⏱️';
  if (counters.includes('predictablePattern')) return 'Your usual path is blocked. 🔀';
  if (strategy === 'punishJumpBias') return 'Low ceilings incoming. 😏';
  if (strategy === 'punishCrouchBias') return 'Jump gaps incoming. 😈';
  if (strategy === 'punishLateReactions') return 'Fast traps incoming. ⚡';
  return 'Escalating. Stay sharp. ⚡';
}

function buildSummary(input: StrategyBriefInput, _read: string, _plan: string): string {
  if (input.phase === 'death') {
    const reason = input.latestDeath?.reason;
    const counters = input.aiDebug?.counterTargets ?? [];
    if (reason === 'gap') return 'Fell in the gap! 🕳️';
    if (reason === 'spike') {
      if (counters.includes('jumpBiased')) return 'Jumped into a spike. 😂';
      if (counters.includes('lateReactor')) return 'Too slow! Spike wins. ⏱️';
      return 'Ha! Got you! 😈';
    }
    return 'Ha! Got you! 😈';
  }
  if (input.phase === 'levelComplete') {
    return "Nice clear. Next is harder. 😤";
  }
  return "I'm learning your moves. 🧠";
}

function buildTaunt(input: StrategyBriefInput): string {
  const model = input.playerModel;
  const outcomes = input.recentRuns.latestOutcomes;
  const streakDeaths = outcomes.length >= 2 && outcomes[outcomes.length - 1] === 'death' && outcomes[outcomes.length - 2] === 'death';
  const counters = input.aiDebug?.counterTargets ?? [];
  const aiPhase = input.aiDebug?.aiPhase;

  if (input.phase === 'levelStart') {
    switch (aiPhase) {
      case 'observe':
        return "I'm watching. 👀";
      case 'test':
        if (counters.includes('jumpBiased')) return 'You like to jump, huh? 🦘';
        if (counters.includes('crouchBiased')) return 'Always crouching? 🦆';
        return "I'm taking notes. 📋";
      case 'counter':
        if (counters.includes('jumpBiased')) return 'Jump again. Ceilings lowered. 😏';
        if (counters.includes('crouchBiased')) return 'Crouch again. Gaps widened. 😈';
        return "You're predictable. 😴";
      case 'predict':
        return 'I can read you. 🔮';
      case 'dominate':
        return 'Every trap is live. 😈';
    }
    if (streakDeaths) return 'Same move. Same death. 😤';
    if (counters.includes('jumpBiased')) return 'Jump first, think never. 🦘';
    if (counters.includes('crouchBiased')) return "Crouch won't save you. 😈";
    return "I'm watching. 👀";
  }

  if (input.phase === 'death') {
    if (counters.includes('jumpBiased')) return 'You jumped. I knew it. 😂';
    if (counters.includes('lateReactor')) return 'Too slow! ⏱️';
    if (counters.includes('overusesChoiceJump') || model.preferredChoiceAction === 'jump') return 'Jumped at the choice. Classic. 😏';
    if (counters.includes('overusesChoiceCrouch') || model.preferredChoiceAction === 'crouch') return 'Crouched into a spike. Nice. 🔺';
    if (counters.includes('diesToGaps')) return 'Gap gets you every time! 🕳️';
    if (streakDeaths) return 'Same move. Same death. 😤';
    return 'Ha! Got you! 😈';
  }

  if (input.phase === 'levelComplete') {
    if (aiPhase === 'predict') return 'You beat me. Adjusting. 🤖';
    if (counters.length > 0) return 'Nice. Already adapting. 😏';
    return "Enjoy it. Next is worse. 😤";
  }

  if (counters.includes('predictablePattern')) return 'Boring moves. Easy counters. 😴';
  if (counters.includes('jumpBiased')) return 'Jump first, think never. 🦘';
  return "I'm learning your moves. 🧠";
}

function capSentence(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  const clipped = compact.length > MAX_BRIEF_LEN
    ? `${compact.slice(0, MAX_BRIEF_LEN - 1).trimEnd()}.`
    : compact;
  if (!/[.!?]$/.test(clipped)) return `${clipped}.`;
  return clipped;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
