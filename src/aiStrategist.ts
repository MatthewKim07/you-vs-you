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
  aiDebug?: Pick<AdaptiveDebugInfo, 'strategy' | 'difficulty' | 'variants' | 'density' | 'patterns'>;
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
  const style = input.playerProfile.jumpStyle;
  const land = input.latestLandingZones[0];

  if (model.consistency === 'predictable' && land !== undefined) {
    return `You keep repeating a lane near ${Math.round(land)}px.`;
  }
  if (model.prefersJump && model.jumpFrequency > model.crouchFrequency) {
    return `You lean on jumping, especially with ${style} timing.`;
  }
  if (model.prefersCrouch && model.crouchFrequency >= model.jumpFrequency) {
    return `You rely on crouch transitions more than jump commits.`;
  }
  if (model.reactionTiming === 'late') {
    return 'You react late under pressure, which narrows your safe window.';
  }
  return 'Your movement mix is balanced, but your rhythm is still readable.';
}

function buildPlan(input: StrategyBriefInput): string {
  const strategy = input.aiDebug?.strategy ?? 'balancedEscalation';
  const difficulty = input.aiDebug?.difficulty ?? 'medium';
  const variants = input.aiDebug?.variants ?? [];

  if (strategy === 'punishJumpBias') {
    return `I will chain low-overhead checks with ${difficulty} spacing to punish early jumps.`;
  }
  if (strategy === 'punishCrouchBias') {
    return `I will force jump commitments after crouch-safe moments using ${difficulty} variants.`;
  }
  if (strategy === 'punishLateReactions') {
    return `I will tighten approach windows and keep pressure sequences in the mid lane.`;
  }
  if (variants.length > 0) {
    return `I will rotate ${variants[0]} with non-repeating variants to keep your route unstable.`;
  }
  return 'I will keep escalating pattern density while preserving a fair path.';
}

function buildSummary(input: StrategyBriefInput, read: string, plan: string): string {
  if (input.phase === 'death') {
    const where = input.latestDeath?.x !== undefined ? ` near ${Math.round(input.latestDeath.x)}px` : '';
    const why = input.latestDeath?.reason ?? 'timing';
    return `You failed on ${why}${where}; ${plan.toLowerCase()}`;
  }
  if (input.phase === 'levelComplete') {
    return `You cleared this route; ${plan.toLowerCase()}`;
  }
  return `${read} ${plan}`;
}

function buildTaunt(input: StrategyBriefInput): string {
  const outcomes = input.recentRuns.latestOutcomes;
  const streakDeaths = outcomes.length >= 2 && outcomes[outcomes.length - 1] === 'death' && outcomes[outcomes.length - 2] === 'death';

  if (input.phase === 'death') {
    return 'You saw the trap, but your timing still blinked first.';
  }
  if (streakDeaths) {
    return 'You are close, but I am still one step ahead of your rhythm.';
  }
  if (input.phase === 'levelComplete') {
    return 'Good clear; the next route is built to break that habit.';
  }
  if (input.playerModel.consistency === 'predictable') {
    return 'Predictable movement is easy to counter.';
  }
  return 'I am learning your route choices in real time.';
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
