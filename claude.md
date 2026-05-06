# Claude Playbook — You vs You

This file is the implementation contract for Claude when working in this repository.

## 1) Product Intent

`You vs You` is a deterministic canvas platformer where AI adaptation must be:

- Visible in moment-to-moment gameplay.
- Fair but adversarial.
- Grounded in actual telemetry (not fake/random-only behavior).

Core player fantasy: *“The game studies me and counters me in real time.”*

## 2) Non-Negotiable Rules

1. Visual/collision parity is mandatory.
   - If something is drawn as solid/hazardous, collision must match exactly.
   - No invisible kills, no visual-only blockers, no pass-through “solid” tiles.
2. Fairness over chaos.
   - Never generate impossible jumps.
   - Never close all paths at once with trap mutations.
   - Never trigger a mutation inside the player hitbox.
3. Tutorial quality matters.
   - Level 1 should teach jump + crouch + route choice quickly.
4. AI changes must be obvious.
   - At least several meaningful mutations per adaptive level.
   - Debug panel should clearly explain what changed and why.
5. Keep architecture separation.
   - Generation logic: `src/adaptiveGenerator.ts`
   - Runtime trap logic: `src/aiTrapDirector.ts`
   - Rendering: `src/renderer.ts`
   - Telemetry/modeling: `src/runTracker.ts`, `src/playerAnalyzer.ts`

## 3) Current System Map

- `src/game.ts`
  - Main loop, state transitions, input → physics → collision → telemetry.
  - Route tracking and choice decision event capture.
- `src/adaptiveGenerator.ts`
  - Segment-based level composition, safety validation, route annotation.
  - Calls trap host planner (`directTraps`) after level build.
- `src/aiTrapDirector.ts`
  - Trap host selection + per-frame trap mutation state machine.
  - Route-aware trap targeting and mutation debug output.
- `src/playerAnalyzer.ts`
  - Produces `PlayerModel` including:
    - jump/crouch preference,
    - choice preference/confidence,
    - route preference/confidence/style.
- `src/debugPanel.ts`
  - Runtime diagnostics required for fast iteration.

## 4) Working Style Expectations

When implementing new features:

1. Add/extend telemetry first.
2. Add model derivation second.
3. Add generator/runtime behavior third.
4. Add debug visibility fourth.
5. Run full build checks last.

Do not skip debugging visibility. If a behavior cannot be observed in debug output, it is not done.

## 5) Required Checks Before Handoff

Run all:

```bash
npx tsc --noEmit
npm run build
find src -name "*.js"
```

Expected:

- TypeScript passes.
- Build passes.
- No `.js` files inside `src/`.

## 6) Gameplay QA Checklist (Manual)

For any adaptation/trap change, verify:

1. Repeating the same choice (jump or crouch) causes visible counters.
2. Route preference (lower/mid/upper) influences where traps are armed.
3. At least one valid route remains to completion.
4. Platform/gap/spike interactions look and collide exactly as drawn.
5. Debug panel reflects:
   - active trap,
   - active route,
   - route usage and mutation counts,
   - strategy/confidence context.

## 7) Commit Message Quality

Avoid milestone-style messages. Prefer specific, user-facing intent:

- `Add route-aware telemetry and player route preference modeling`
- `Introduce tri-route segment generation with connectivity validation`
- `Make trap director route-targeted with per-route mutation diagnostics`

## 8) What Not To Do

- Do not add API keys or secrets.
- Do not merge unrelated refactors into gameplay fixes.
- Do not reduce difficult behavior to pure random placement.
- Do not silently weaken safety checks to “make it pass.”

