# AGENTS.md — Contributor Guide for AI Coding Agents

This guide applies to any coding agent making changes in this repository.

## Project Summary

`You vs You` is a TypeScript + Vite + Canvas game where adaptive AI generates and mutates challenges based on player behavior.

The quality bar is not only “works,” but:

- **Adversarial**: AI should actively counter player habits.
- **Readable**: Changes must be visible and understandable.
- **Fair**: Levels remain beatable with skill.

## Repo Conventions

### Stack

- TypeScript
- Vite
- HTML5 Canvas

### Key Commands

```bash
npm run dev
npx tsc --noEmit
npm run build
find src -name "*.js"
```

### Critical Modules

- `src/game.ts` — runtime orchestration + telemetry capture.
- `src/adaptiveGenerator.ts` — deterministic segment generation + validation.
- `src/aiTrapDirector.ts` — real-time trap mutation runtime.
- `src/playerAnalyzer.ts` — telemetry → `PlayerModel`.
- `src/runTracker.ts` — run/event recording.
- `src/renderer.ts` — all visual output.
- `src/debugPanel.ts` — diagnosis + QA visibility.

## Engineering Standards

## 1) Deterministic Core

Keep physics, collision, and generation deterministic.
Use randomness only for bounded variation, never for fundamental playability.

## 2) Visual/Collision Integrity

Every new obstacle or trap state must define:

- Render behavior,
- Collision behavior,
- Runtime state transitions.

No “looks dangerous but does nothing” objects.
No “looks safe but kills anyway” interactions.

## 3) Fairness Constraints

When extending generation or trap logic:

- Preserve at least one valid path.
- Enforce jump-distance limits.
- Maintain recovery windows.
- Avoid simultaneous full-lane shutdown.

## 4) Telemetry-First Adaptation

Any AI claim in gameplay should map to telemetry fields.
If a trap reacts to a pattern, that pattern must be recorded in run data/model.

## 5) Debug Visibility

Every major adaptive behavior must be traceable in debug panel fields.
If judges cannot see why AI acted, the feature is incomplete.

## Implementation Workflow

Use this sequence for medium/large features:

1. Extend types (`telemetry.ts`, `types.ts`, optionally `level.ts` debug fields).
2. Record events in `game.ts`/`runTracker.ts`.
3. Derive behavior signals in `playerAnalyzer.ts`.
4. Apply behavior in generator (`adaptiveGenerator.ts`) and/or runtime (`aiTrapDirector.ts`).
5. Add/adjust visuals in `renderer.ts`.
6. Expose diagnostics in `debugPanel.ts`.
7. Run typecheck + build + source hygiene checks.

## Testing Matrix (Minimum)

For adaptive gameplay updates, run at least:

1. Jump-biased playthrough:
   - Confirm jump counters activate.
2. Crouch-biased playthrough:
   - Confirm crouch counters activate.
3. Route-biased playthrough (upper or lower):
   - Confirm route-targeted mutations.
4. Mixed behavior:
   - Confirm AI confidence/modulation behaves reasonably.
5. Edge-case collision checks:
   - platform edges, low ceilings, choice gates, pop-up spikes.

## Git / Commit Hygiene

- Keep commits scoped by subsystem.
- Use specific messages describing behavior change.
- Do not commit generated artifacts that should remain local.
- Before finalizing:
  - ensure `git status` is clean except intended files.

## Definition of Done

A change is done only when:

1. It is visible in gameplay.
2. It is explainable in debug outputs.
3. It respects fairness constraints.
4. It passes:
   - `npx tsc --noEmit`
   - `npm run build`
   - `find src -name "*.js"` (empty)

