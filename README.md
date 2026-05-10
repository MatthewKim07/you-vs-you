<p align="center">
  <img src="./public/logo.svg" alt="You vs You logo" width="180" />
</p>

<h1 align="center">You vs You</h1>

<p align="center">
  <strong>An adaptive AI platformer where the game learns your habits and counters them in real time.</strong><br/>
  <sub>Beat the level. Then beat your own pattern.</sub>
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-5.x-646CFF?logo=vite&logoColor=white" />
  <img alt="All Device Browsers" src="https://img.shields.io/badge/Platform-All%20Device%20Browsers-0f172a" />
  <img alt="Supabase" src="https://img.shields.io/badge/Auth%20%26%20Cloud-Supabase-3FCF8E?logo=supabase&logoColor=white" />
</p>

<p align="center">
  <a href="#-quick-start"><img alt="Run Locally" src="https://img.shields.io/badge/Run%20Locally-Quick%20Start-1f6feb" /></a>
  <a href="#-gameplay-loop"><img alt="Gameplay" src="https://img.shields.io/badge/View-Gameplay%20Loop-8b5cf6" /></a>
  <a href="#-supabase-setup"><img alt="Cloud Setup" src="https://img.shields.io/badge/Setup-Supabase-0ea5e9" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/AI%20Game%20Week-Submission-ff4d4f" />
  <img src="https://img.shields.io/badge/Genre-Adaptive%20Platformer-f59e0b" />
  <img src="https://img.shields.io/badge/Status-Playable-success" />
</p>

---

## 🎯 Why This Game Exists

Most platformers get easier once you discover the pattern.  
**You vs You** flips that: the AI finds your pattern first, then challenges it.

Instead of static levels, this game uses gameplay telemetry to adapt obstacle pressure, route targeting, and trap behavior while preserving fairness and at least one viable path.

---

## ✨ Core Highlights

<table>
  <tr>
    <td><strong>🧠 Adaptive AI Gameplay</strong><br/>Learns jump/crouch/route habits and applies behavior-based counters.</td>
    <td><strong>⚖️ Fair Adversarial Design</strong><br/>Challenges predictable play without impossible setups.</td>
  </tr>
  <tr>
    <td><strong>🏃 Level + Infinite Modes</strong><br/>Campaign progression and score-chasing survival mode.</td>
    <td><strong>🎒 Shop + Inventory</strong><br/>Unlock and manage skins, boosts, and abilities.</td>
  </tr>
  <tr>
    <td><strong>☁️ Cloud Sync</strong><br/>Supabase-backed account progress and leaderboard scoring.</td>
    <td><strong>🌐 Cross-Device Browser Play</strong><br/>Runs on phone, tablet, laptop, and desktop browsers.</td>
  </tr>
</table>

---

## 🎮 Gameplay Loop

```mermaid
flowchart LR
    A[Play Run] --> B[AI Observes Behavior]
    B --> C[Pattern Modeling]
    C --> D[Adaptive Counter Pressure]
    D --> E[Earn Coins and Unlock Gear]
    E --> F[Adjust Strategy]
    F --> A
```

1. **Play runs** in Level or Infinite mode  
2. **AI observes** route/movement habits  
3. **Game adapts** with targeted counters  
4. **You unlock** boosts, abilities, and skins  
5. **You evolve** strategy and push farther  

---

## 🛠️ Tech Stack

- **Frontend:** TypeScript, Vite, HTML5 Canvas
- **AI/Adaptation Runtime:** Custom telemetry + modeling + mutation systems
- **Backend Services:** Supabase Auth + Postgres tables for progress/leaderboard
- **State Persistence:** Account-linked cloud persistence for cross-device continuity

---

## 🗂️ Project Structure

```text
src/
  game.ts                # Main runtime loop, state, UI wiring
  adaptiveGenerator.ts   # Adaptive level composition + safety checks
  aiTrapDirector.ts      # Runtime trap targeting and mutation logic
  playerAnalyzer.ts      # Telemetry -> player model
  runTracker.ts          # Per-run event capture
  debugPanel.ts          # Internal diagnostics (dev use)
  renderer.ts            # Visual output
```

---

## 🚀 Quick Start

<p>
  <img alt="Step 1" src="https://img.shields.io/badge/1-Install-334155" />
  <img alt="Step 2" src="https://img.shields.io/badge/2-Run%20Dev%20Server-334155" />
  <img alt="Step 3" src="https://img.shields.io/badge/3-Play-334155" />
</p>

```bash
npm install
npm run dev
```

Open the app at the local Vite URL.

### 📦 Production Build

```bash
npx tsc --noEmit
npm run build
```

---

## 🧠 Supabase Setup

<p>
  <img alt="Auth" src="https://img.shields.io/badge/Auth-Email%2FPassword-22c55e" />
  <img alt="Progress" src="https://img.shields.io/badge/Progress-Cloud%20Synced-22c55e" />
  <img alt="Leaderboard" src="https://img.shields.io/badge/Infinite-Leaderboard-22c55e" />
</p>

1. Copy `.env.example` to `.env`
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
3. Run SQL setup files:
   - `supabase-migration.sql`
   - `supabase-migration-2.sql`
   - `supabase-migration-3.sql`
4. See full details in `AUTH_SETUP.md`

---

## 🏁 Submission Notes (AI Game Week)

> Built for a 7-day AI game challenge with gameplay-first AI adaptation.

- ✅ Built during the hackathon window  
- ✅ Playable on all device browsers  
- ✅ Meaningful AI integrated directly into gameplay  
- ✅ Account progress, inventory persistence, and leaderboard support  

---

## 📄 License

MIT (see `LICENSE`)