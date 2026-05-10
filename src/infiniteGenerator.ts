import { Obstacle, ObstacleKind } from './types';
import { PlayerModel } from './telemetry';

interface ObstTemplate {
  kind: ObstacleKind;
  relX: number;
  width: number;
  height: number;
  solid?: boolean;
}

interface InfinitePattern {
  id: string;
  length: number;          // total chunk width
  templates: ObstTemplate[];
  requiredAction: 'jump' | 'crouch' | 'either' | 'none';
  minDiff: number;
  maxDiff: number;
  // AI targeting flags — used to bias pattern selection toward player weaknesses
  punishesEarlyJump: boolean;  // dangerous if player jumps before reaching obstacle
  punishesNoCrouch: boolean;   // requires crouching; punishes jump-only players
}

// Guardrail: mandatory empty approach space before every pattern.
// Player moves at 230 px/s; 100 px = 0.43 s of clear ground — enough to react.
// Patterns add their own relX on top of this, so real approach is ENTRY_GAP + relX.
const ENTRY_GAP = 100;

// Generate terrain this far ahead of the player.
const LOOKAHEAD = 2400;

// Remove obstacles this far behind the camera's left edge to keep memory bounded.
const CLEANUP_MARGIN = 500;

// Short start zone — player only needs a couple of steps before the first obstacle.
const INITIAL_RUNWAY = 300;

// ─── Pattern Library ─────────────────────────────────────────────────────────
//
// Each pattern is a named chunk of terrain. Positions (relX) are relative to
// the chunk's start. All patterns are designed to be safely passable:
//   - gaps ≤ 140 px (safe to jump across at 230 px/s)
//   - spikes always have ≥ 60 px run-up (relX ≥ 60 from pattern start)
//   - each chunk ends with clear ground before the next ENTRY_GAP
//   - no pattern stack creates an unavoidable kill zone

const PATTERNS: InfinitePattern[] = [
  // ── EASY (diff 0 – 0.4) ────────────────────────────────────────────────────
  {
    // Short breather only used in the opening seconds. Capped at diff 0.25 so
    // it disappears quickly — players should never coast for long.
    id: 'flat',
    length: 180,
    templates: [],
    requiredAction: 'none',
    minDiff: 0, maxDiff: 0.25,
    punishesEarlyJump: false, punishesNoCrouch: false,
  },
  {
    id: 'spike_sm',
    length: 280,
    templates: [{ kind: 'spike', relX: 100, width: 44, height: 52 }],
    requiredAction: 'jump',
    minDiff: 0, maxDiff: 0.7,
    punishesEarlyJump: false, punishesNoCrouch: false,
  },
  {
    id: 'low_ceil_sm',
    length: 300,
    templates: [{ kind: 'lowCeiling', relX: 60, width: 160, height: 34 }],
    requiredAction: 'crouch',
    minDiff: 0.05, maxDiff: 0.75,
    punishesEarlyJump: false, punishesNoCrouch: true,
  },

  // ── MEDIUM (diff 0.2 – 0.85) ───────────────────────────────────────────────
  {
    id: 'spike_lg',
    length: 300,
    templates: [{ kind: 'spike', relX: 80, width: 64, height: 52 }],
    requiredAction: 'jump',
    minDiff: 0.2, maxDiff: 0.85,
    punishesEarlyJump: false, punishesNoCrouch: false,
  },
  {
    id: 'dbl_spike',
    length: 340,
    templates: [{ kind: 'doubleSpike', relX: 80, width: 104, height: 52 }],
    requiredAction: 'jump',
    minDiff: 0.3, maxDiff: 1.0,
    punishesEarlyJump: false, punishesNoCrouch: false,
  },
  {
    id: 'gap_sm',
    length: 340,
    templates: [{ kind: 'gap', relX: 80, width: 110, height: 0 }],
    requiredAction: 'jump',
    minDiff: 0.2, maxDiff: 0.85,
    punishesEarlyJump: false, punishesNoCrouch: false,
  },
  {
    id: 'low_ceil_spike',
    length: 400,
    templates: [
      { kind: 'lowCeiling', relX: 50, width: 130, height: 34 },
      { kind: 'spike', relX: 240, width: 44, height: 52 },
    ],
    requiredAction: 'crouch',
    minDiff: 0.35, maxDiff: 1.0,
    punishesEarlyJump: false, punishesNoCrouch: true,
  },
  {
    id: 'spike_then_ceil',
    length: 400,
    templates: [
      { kind: 'spike', relX: 60, width: 44, height: 52 },
      { kind: 'lowCeiling', relX: 160, width: 140, height: 34 },
    ],
    requiredAction: 'either',
    minDiff: 0.4, maxDiff: 1.0,
    punishesEarlyJump: true, punishesNoCrouch: true,
  },
  {
    id: 'gap_then_spike',
    length: 400,
    templates: [
      { kind: 'gap', relX: 70, width: 110, height: 0 },
      { kind: 'spike', relX: 240, width: 44, height: 52 },
    ],
    requiredAction: 'jump',
    minDiff: 0.4, maxDiff: 1.0,
    punishesEarlyJump: false, punishesNoCrouch: false,
  },
  {
    id: 'spike_pair',
    length: 380,
    templates: [
      { kind: 'spike', relX: 60, width: 44, height: 52 },
      { kind: 'spike', relX: 180, width: 44, height: 52 },
    ],
    requiredAction: 'jump',
    minDiff: 0.45, maxDiff: 1.0,
    punishesEarlyJump: false, punishesNoCrouch: false,
  },

  // ── HARD (diff 0.55 – 1.0) ─────────────────────────────────────────────────
  {
    id: 'gap_lg',
    length: 380,
    templates: [{ kind: 'gap', relX: 70, width: 140, height: 0 }],
    requiredAction: 'jump',
    minDiff: 0.5, maxDiff: 1.0,
    punishesEarlyJump: false, punishesNoCrouch: false,
  },
  {
    id: 'dbl_spike_gap',
    length: 440,
    templates: [
      { kind: 'doubleSpike', relX: 60, width: 104, height: 52 },
      { kind: 'gap', relX: 220, width: 110, height: 0 },
    ],
    requiredAction: 'jump',
    minDiff: 0.6, maxDiff: 1.0,
    punishesEarlyJump: false, punishesNoCrouch: false,
  },
  {
    id: 'elec_field',
    length: 380,
    templates: [{ kind: 'electricField', relX: 70, width: 80, height: 48 }],
    requiredAction: 'jump',
    minDiff: 0.55, maxDiff: 1.0,
    punishesEarlyJump: false, punishesNoCrouch: false,
  },
  {
    id: 'triple',
    length: 480,
    templates: [
      { kind: 'spike', relX: 50, width: 44, height: 52 },
      { kind: 'lowCeiling', relX: 160, width: 120, height: 34 },
      { kind: 'spike', relX: 340, width: 44, height: 52 },
    ],
    requiredAction: 'either',
    minDiff: 0.7, maxDiff: 1.0,
    punishesEarlyJump: true, punishesNoCrouch: true,
  },
  {
    id: 'spike_gap_spike',
    length: 480,
    templates: [
      { kind: 'spike', relX: 60, width: 44, height: 52 },
      { kind: 'gap', relX: 170, width: 120, height: 0 },
      { kind: 'spike', relX: 350, width: 44, height: 52 },
    ],
    requiredAction: 'jump',
    minDiff: 0.7, maxDiff: 1.0,
    punishesEarlyJump: false, punishesNoCrouch: false,
  },
];

// ─── Difficulty Curve ─────────────────────────────────────────────────────────
//
// Score = (player.pos.x − SPAWN_X) / 10  ≈ 23 pts/sec at default speed.
//
//   0 – 80  : warm-up      → 0.00 .. 0.25  (~0 –  3 s)
//   80 – 250: easy-medium  → 0.25 .. 0.50  (~3 – 11 s)
//  250 – 500: medium-hard  → 0.50 .. 0.75  (~11 – 22 s)
//  500+     : hard/adaptive→ 0.75 .. 1.00  (22 s+)

export function scoreToDifficulty(score: number): number {
  if (score < 80)  return (score / 80)  * 0.25;
  if (score < 250) return 0.25 + ((score - 80)  / 170) * 0.25;
  if (score < 500) return 0.50 + ((score - 250) / 250) * 0.25;
  return Math.min(1.0, 0.75 + ((score - 500) / 600) * 0.25);
}

// ─── Generator ────────────────────────────────────────────────────────────────

export class InfiniteGenerator {
  // Rightmost world-x for which terrain has been generated.
  private frontier: number;
  // Sliding window of recently placed pattern IDs for anti-repeat filtering.
  private recentIds: string[] = [];
  private readonly ANTI_REPEAT = 3;

  constructor() {
    this.frontier = INITIAL_RUNWAY;
  }

  get currentFrontier(): number {
    return this.frontier;
  }

  // Generate obstacle chunks until the frontier is at least playerX + LOOKAHEAD.
  // Returns newly created Obstacle objects (caller appends them to level.obstacles).
  generateChunks(playerX: number, score: number, playerModel: PlayerModel): Obstacle[] {
    const newObs: Obstacle[] = [];
    const diff = scoreToDifficulty(score);
    while (this.frontier < playerX + LOOKAHEAD) {
      const pattern = this.pickPattern(score, playerModel);
      // ENTRY_GAP ensures no obstacle can appear immediately in front of the player.
      const startX = this.frontier + ENTRY_GAP;
      for (const t of pattern.templates) {
        const obs: Obstacle = {
          kind: t.kind,
          x: startX + t.relX,
          width: t.width,
          height: t.height,
          ...(t.solid !== undefined ? { solid: t.solid } : {}),
        };
        // Above diff 0.3 (~250 score, ~11s in), probabilistically arm spikes as
        // pop-up trap hosts so the AI director can fire them when the player is close.
        // Probability scales with difficulty so adaptation intensifies over time.
        if (diff >= 0.3 && (t.kind === 'spike' || t.kind === 'doubleSpike') && Math.random() < diff * 0.45) {
          obs.trapHost = true;
          obs.trapType = 'popUpSpike';
          obs.trapState = 'idle';
          obs.currentHeight = 0;
          obs.targetHeight = t.height;
          obs.trapInitialHeight = 0;
          obs.trapReason = 'AI clocked your jump timing — spike erupts!';
        }
        newObs.push(obs);
      }
      this.frontier = startX + pattern.length;
      this.recentIds.push(pattern.id);
      if (this.recentIds.length > this.ANTI_REPEAT) this.recentIds.shift();
    }
    return newObs;
  }

  // Remove obstacles that have scrolled behind the camera by more than CLEANUP_MARGIN.
  // leftX = camera's left-edge world-x.  Returns the filtered array.
  cleanupBefore(leftX: number, obstacles: Obstacle[]): Obstacle[] {
    const cutoff = leftX - CLEANUP_MARGIN;
    return obstacles.filter(o => o.x + o.width >= cutoff);
  }

  private pickPattern(score: number, model: PlayerModel): InfinitePattern {
    const diff = scoreToDifficulty(score);

    // Build candidate list: difficulty range covers current diff, not recently used.
    let candidates = PATTERNS.filter(
      p => p.minDiff <= diff && p.maxDiff >= diff && !this.recentIds.includes(p.id),
    );
    // Fallback 1: allow recently-used patterns if pool is thin.
    if (candidates.length === 0) {
      candidates = PATTERNS.filter(p => p.minDiff <= diff && p.maxDiff >= diff);
    }
    // Fallback 2: everything — should never happen with current pattern set.
    if (candidates.length === 0) candidates = [...PATTERNS];

    const weights = candidates.map(p => this.weight(p, diff, model));
    return this.weightedRandom(candidates, weights);
  }

  private weight(p: InfinitePattern, diff: number, model: PlayerModel): number {
    let w = 1.0;

    // Prefer patterns near the center of their difficulty range.
    const mid = (p.minDiff + p.maxDiff) / 2;
    w *= 1.0 - Math.abs(diff - mid) * 0.5;

    // flat is already capped at maxDiff=0.25; no further boosting — action should dominate.
    if (p.id === 'flat') w *= 0.6;

    // AI adaptation: upweight patterns that target the player's known weaknesses.
    // Player rarely crouches → add more crouch challenges.
    if (model.crouchFrequency < 0.2 && p.punishesNoCrouch) w *= 1.6;
    // Player jumps very frequently → punish early-jump reflex.
    if (model.jumpFrequency > 0.75 && p.punishesEarlyJump) w *= 1.5;
    // Player exclusively jumps (no crouching) → weight explicit crouch patterns.
    if (!model.prefersCrouch && model.crouchFrequency < 0.1 && p.requiredAction === 'crouch') w *= 1.4;
    // Early-timing players get punished by jump-punisher patterns.
    if (model.reactionTiming === 'early' && p.punishesEarlyJump) w *= 1.4;

    // Multi-obstacle combos are hard — suppress below diff 0.45.
    if (diff < 0.45 && p.templates.length > 1) w *= 0.25;

    return Math.max(0.01, w);
  }

  private weightedRandom<T>(items: T[], weights: number[]): T {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }
}
