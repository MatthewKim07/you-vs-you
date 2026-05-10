import { RunTracker } from './runTracker';
import { LevelData, AdaptiveDebugInfo } from './level';
import { PlayerModel } from './telemetry';
import { StrategyBrief } from './aiStrategist';
import { Obstacle } from './types';
import type { PhaseDebugInfo } from './phase';

interface RealtimeTrapDebugView {
  phase: string;
  activeTrap: string;
  trapState: string;
  activeRoute: string;
  predictedAction: string;
  predictedLandingX?: number;
  trapReason: string;
  confidence: number;
  lastMutation: string;
  mutationCountsByRoute: { lower: number; mid: number; upper: number };
}

// HTML overlay — hidden by default, toggled via "AI Data" button.
// Reads from RunTracker only; no game logic here.
export class DebugPanel {
  private panel: HTMLDivElement;
  private button: HTMLButtonElement;
  private visible = false;
  private aiDebugInfo: AdaptiveDebugInfo | undefined;
  private currentLevelIndex = 0;
  private liveObstacles: Obstacle[] = [];
  private strategyBrief: StrategyBrief | undefined;
  private realtimeTrapDebug: RealtimeTrapDebugView = {
    phase: 'observe',
    activeTrap: 'none',
    trapState: 'none',
    activeRoute: 'none',
    predictedAction: 'unknown',
    predictedLandingX: undefined,
    trapReason: 'none',
    confidence: 0,
    lastMutation: 'none',
    mutationCountsByRoute: { lower: 0, mid: 0, upper: 0 },
  };
  private lastPhaseDebug: PhaseDebugInfo | null = null;
  private playerModel: PlayerModel = {
    prefersJump: true,
    prefersCrouch: false,
    jumpFrequency: 0,
    crouchFrequency: 0,
    reactionTiming: 'balanced',
    consistency: 'mixed',
    riskProfile: 'balanced',
    choiceJumpRate: 0,
    choiceCrouchRate: 0,
    choiceConfidence: 0,
    preferredChoiceAction: 'unknown',
    choiceConsistency: 'unknown',
    perObstacleChoiceStats: {},
    perObstacleInteractionStats: {},
    preferredRoute: 'mixed',
    routeConfidence: 0,
    routeRiskStyle: 'opportunist',
    routeUsage: { lower: 0, mid: 0, upper: 0 },
  };

  constructor(private tracker: RunTracker) {
    this.button = this.makeButton();
    this.panel = this.makePanel();
    document.body.appendChild(this.button);
    document.body.appendChild(this.panel);
  }

  // Call once per draw cycle; skips work when hidden
  update(): void {
    if (!this.visible) return;

    const run = this.tracker.getCurrentRun();
    const profile = this.tracker.getProfile();
    const model = this.playerModel;
    const currentRun = this.tracker.getCurrentRun();

    const fmt = (n: number) => Math.round(n).toLocaleString();
    const formatStyle = (style: string) => style.charAt(0).toUpperCase() + style.slice(1);
    const mostCommonLanding = profile.commonLandingZones[0];
    const dbg = this.aiDebugInfo;

    // Task 5: AI Learning section data
    const phaseLabel = dbg?.aiPhase ? dbg.aiPhase.charAt(0).toUpperCase() + dbg.aiPhase.slice(1) : '—';
    const overallConf = dbg?.overallConfidence ?? 0;
    const topHabit = dbg?.topLearnedHabit ?? '—';
    const activeTraps = dbg?.activeTraps ?? [];
    const trapReasons = dbg?.trapReasons ?? [];
    const predictedX = dbg?.predictedLandingX;
    const rt = this.realtimeTrapDebug;

    this.panel.innerHTML = `
      ${this.renderPhaseDebugSection()}
      <div class="dbg-section">
        <div class="dbg-title">AI LEARNING</div>
        <div class="dbg-row"><span>Phase</span><span>${phaseLabel}</span></div>
        <div class="dbg-row"><span>Confidence</span><span>${(overallConf * 100).toFixed(0)}%</span></div>
        <div class="dbg-row"><span>Top habit</span><span>${topHabit}</span></div>
        <div class="dbg-row"><span>Active traps</span><span>${activeTraps.join(', ') || 'none'}</span></div>
        <div class="dbg-row"><span>Trap reason</span><span>${trapReasons[0] || '—'}</span></div>
        <div class="dbg-row"><span>Predicted land</span><span>${predictedX ? `${Math.round(predictedX)}px` : '—'}</span></div>
      </div>
      <div class="dbg-section">
        <div class="dbg-title">TRAP RUNTIME</div>
        <div class="dbg-row"><span>AI Phase</span><span>${formatStyle(rt.phase)}</span></div>
        <div class="dbg-row"><span>Active Trap</span><span>${rt.activeTrap}</span></div>
        <div class="dbg-row"><span>Trap State</span><span>${rt.trapState}</span></div>
        <div class="dbg-row"><span>Active Route</span><span>${rt.activeRoute}</span></div>
        <div class="dbg-row"><span>Predicted Action</span><span>${formatStyle(rt.predictedAction)}</span></div>
        <div class="dbg-row"><span>Predicted Landing X</span><span>${rt.predictedLandingX !== undefined ? `${Math.round(rt.predictedLandingX)}px` : '—'}</span></div>
        <div class="dbg-row"><span>Trap Reason</span><span>${rt.trapReason || '—'}</span></div>
        <div class="dbg-row"><span>Confidence</span><span>${(rt.confidence * 100).toFixed(0)}%</span></div>
        <div class="dbg-row"><span>Last Mutation</span><span>${rt.lastMutation || '—'}</span></div>
        <div class="dbg-row"><span>Route mutations</span><span>L:${rt.mutationCountsByRoute.lower} M:${rt.mutationCountsByRoute.mid} U:${rt.mutationCountsByRoute.upper}</span></div>
      </div>
      <div class="dbg-section">
        <div class="dbg-title">THIS RUN</div>
        <div class="dbg-row"><span>Jumps</span><span>${run?.jumps.length ?? '—'}</span></div>
        <div class="dbg-row"><span>Actions</span><span>${run?.actions.length ?? '—'}</span></div>
        <div class="dbg-row"><span>Landings</span><span>${run?.landings.length ?? '—'}</span></div>
        <div class="dbg-row"><span>Samples</span><span>${run?.samples.length ?? '—'}</span></div>
        <div class="dbg-row"><span>Choice decisions</span><span>${currentRun?.choiceDecisions.length ?? '—'}</span></div>
        <div class="dbg-row"><span>Route choices</span><span>${currentRun?.routeChoices.length ?? '—'}</span></div>
        <div class="dbg-row"><span>Route usage run</span><span>L:${currentRun?.routeUsageCounts.lower ?? 0} M:${currentRun?.routeUsageCounts.mid ?? 0} U:${currentRun?.routeUsageCounts.upper ?? 0}</span></div>
      </div>
      <div class="dbg-section">
        <div class="dbg-title">MODEL</div>
        <div class="dbg-row"><span>Total runs</span><span>${profile.totalRuns}</span></div>
        <div class="dbg-row"><span>Prefers</span><span>${model.prefersJump ? 'Jump' : 'Crouch'}</span></div>
        <div class="dbg-row"><span>Reaction</span><span>${formatStyle(model.reactionTiming)}</span></div>
        <div class="dbg-row"><span>Consistency</span><span>${formatStyle(model.consistency)}</span></div>
        <div class="dbg-row"><span>Risk</span><span>${formatStyle(model.riskProfile)}</span></div>
        <div class="dbg-row"><span>Most common landing</span><span>${mostCommonLanding ? `~${fmt(mostCommonLanding)}px` : '—'}</span></div>
        <div class="dbg-row"><span>Choice jump rate</span><span>${(model.choiceJumpRate * 100).toFixed(0)}%</span></div>
        <div class="dbg-row"><span>Choice crouch rate</span><span>${(model.choiceCrouchRate * 100).toFixed(0)}%</span></div>
        <div class="dbg-row"><span>Choice confidence</span><span>${(model.choiceConfidence * 100).toFixed(0)}%</span></div>
        <div class="dbg-row"><span>Preferred choice</span><span>${formatStyle(model.preferredChoiceAction)}</span></div>
        <div class="dbg-row"><span>Choice consistency</span><span>${formatStyle(model.choiceConsistency)}</span></div>
        <div class="dbg-row"><span>Preferred route</span><span>${formatStyle(model.preferredRoute)}</span></div>
        <div class="dbg-row"><span>Route confidence</span><span>${(model.routeConfidence * 100).toFixed(0)}%</span></div>
        <div class="dbg-row"><span>Route style</span><span>${formatStyle(model.routeRiskStyle)}</span></div>
        <div class="dbg-row"><span>Route usage</span><span>L:${model.routeUsage.lower} M:${model.routeUsage.mid} U:${model.routeUsage.upper}</span></div>
      </div>
      <div class="dbg-section">
        <div class="dbg-title">CHOICE GATE LEARNING</div>
        <div class="dbg-row"><span>Global pref</span><span>${formatStyle(model.preferredChoiceAction)} @ ${(model.choiceConfidence * 100).toFixed(0)}% conf</span></div>
        <div class="dbg-row"><span>Mutation target</span><span>${dbg?.mutationTargetObstacleId ?? '—'}</span></div>
        <div class="dbg-row"><span>Fallback used</span><span>${dbg?.mutationFallbackUsed ? 'yes' : 'no'}</span></div>
        ${Object.values(model.perObstacleChoiceStats ?? {}).slice(0, 4).map((s) =>
          `<div class="dbg-row"><span>${s.obstacleId.slice(-12)}</span><span>J:${(s.jumpRate * 100).toFixed(0)}% C:${(s.crouchRate * 100).toFixed(0)}% (${s.total} samples, conf ${(s.confidence * 100).toFixed(0)}%)</span></div>`
        ).join('')}
        ${Object.keys(model.perObstacleChoiceStats ?? {}).length === 0 ? '<div class="dbg-row"><span>—</span><span>no gate decisions yet</span></div>' : ''}
      </div>
      <div class="dbg-section">
        <div class="dbg-title">OBJECT LEARNING</div>
        ${Object.values(model.perObstacleInteractionStats ?? {}).slice(0, 5).map((s) =>
          `<div class="dbg-row"><span>${s.obstacleId.slice(-12)}</span><span>${s.obstacleKind} ${formatStyle(s.preferredAction)} pass:${s.passCount} death:${s.deathCount} fail:${(s.failureRate * 100).toFixed(0)}%</span></div>`
        ).join('')}
        ${Object.keys(model.perObstacleInteractionStats ?? {}).length === 0 ? '<div class="dbg-row"><span>—</span><span>no object interactions yet</span></div>' : ''}
      </div>
      <div class="dbg-section">
        <div class="dbg-title">AI MUTATIONS (Level ${this.currentLevelIndex + 1})</div>
        <div class="dbg-row"><span>Budget</span><span>${dbg?.mutatorBudget ? `${dbg.mutatorBudget.spent}/${dbg.mutatorBudget.total} pts spent` : '—'}</span></div>
        <div class="dbg-row"><span>Applied</span><span>${dbg?.appliedMutations?.length ?? 0} mutation(s)</span></div>
        ${(dbg?.appliedMutations ?? []).map((m) =>
          `<div class="dbg-row"><span>${m.type}</span><span>@${Math.round(m.targetX)}px — ${m.reason}</span></div>`
        ).join('')}
        ${(dbg?.mutatorDebugLines ?? []).map((line) =>
          `<div class="dbg-row"><span style="color:#aaa;font-size:9px" colspan="2">${line}</span></div>`
        ).join('')}
      </div>
      ${this.renderAiModifiersSection()}
      <div class="dbg-section">
        <div class="dbg-title">ADAPTIVE (Level ${this.currentLevelIndex + 1})</div>
        <div class="dbg-row"><span>Diff score</span><span>${dbg ? `${dbg.totalDifficultyScore}/${dbg.requiredDifficultyScore}` : '—'}</span></div>
        <div class="dbg-row"><span>Seg scores</span><span>${dbg?.segmentScores.join(' ') || '—'}</span></div>
        <div class="dbg-row"><span>Difficulty</span><span>${dbg?.difficulty ?? '—'}</span></div>
        <div class="dbg-row"><span>Safe jump</span><span>${dbg?.safeJumpDistance ?? '—'}px</span></div>
        <div class="dbg-row"><span>Max jump</span><span>${dbg?.maxJumpDistance ?? '—'}px</span></div>
        <div class="dbg-row"><span>Strategy</span><span>${dbg?.strategy ?? '—'}</span></div>
        <div class="dbg-row"><span>Density</span><span>${dbg?.density ?? '—'}</span></div>
        <div class="dbg-row"><span>Challenge zones</span><span>${dbg?.challengeZones ?? '—'}</span></div>
        <div class="dbg-row"><span>Required</span><span>${dbg?.requiredPatterns.join(', ') || '—'}</span></div>
        <div class="dbg-row"><span>Placed required</span><span>${dbg?.placedRequiredPatterns.join(', ') || '—'}</span></div>
        <div class="dbg-row"><span>Unique patterns</span><span>${dbg?.uniquePatternTypes ?? '—'}</span></div>
        <div class="dbg-row"><span>Combo count</span><span>${dbg?.comboCount ?? '—'}</span></div>
        <div class="dbg-row"><span>Platform</span><span>${dbg?.platformUsed ? 'yes' : 'no'}</span></div>
        <div class="dbg-row"><span>Validation</span><span>${dbg?.validationStatus ?? '—'}</span></div>
        <div class="dbg-row"><span>Route graph</span><span>${dbg?.routeConnectivityStatus ?? '—'}</span></div>
        <div class="dbg-row"><span>Routes used</span><span>${dbg?.routesUsed?.join(', ') || '—'}</span></div>
        <div class="dbg-row"><span>Route switches</span><span>${dbg?.routeSwitchPoints ?? '—'}</span></div>
        <div class="dbg-row"><span>Route target</span><span>${dbg?.routeTargeted ?? '—'}</span></div>
        <div class="dbg-row"><span>Route usage lvl</span><span>${dbg?.routeUsage ? `L:${dbg.routeUsage.lower} M:${dbg.routeUsage.mid} U:${dbg.routeUsage.upper}` : '—'}</span></div>
        <div class="dbg-row"><span>Warnings</span><span>${dbg?.validationWarnings.join(' | ') || 'none'}</span></div>
        <div class="dbg-row"><span>Counters</span><span>${dbg?.counterTargets.join(', ') || 'none'}</span></div>
        <div class="dbg-row"><span>Adapt</span><span>${dbg?.adaptationReasons.slice(0, 2).join(' | ') || '—'}</span></div>
        <div class="dbg-row"><span>Placed</span><span>${dbg?.patterns.length ?? '—'}</span></div>
        <div class="dbg-row"><span>Obstacles</span><span>${dbg?.obstacleCount ?? '—'}</span></div>
        <div class="dbg-row"><span>Patterns</span><span>${dbg?.patterns.join(', ') || '—'}</span></div>
        <div class="dbg-row"><span>Variants</span><span>${dbg?.variants.join(', ') || '—'}</span></div>
      </div>
      <div class="dbg-section">
        <div class="dbg-title">AI BRAIN</div>
        <div class="dbg-row"><span>Strategy</span><span>${dbg?.strategy ?? '—'}</span></div>
        <div class="dbg-row"><span>Difficulty</span><span>${dbg?.difficulty ?? '—'}</span></div>
        <div class="dbg-row"><span>Variants</span><span>${dbg?.variants.join(', ') || '—'}</span></div>
        <div class="dbg-row"><span>Player read</span><span>${this.strategyBrief?.playerRead ?? '—'}</span></div>
        <div class="dbg-row"><span>AI plan</span><span>${this.strategyBrief?.nextPlan ?? '—'}</span></div>
        <div class="dbg-row"><span>Summary</span><span>${this.strategyBrief?.summary ?? '—'}</span></div>
        <div class="dbg-row"><span>Taunt</span><span>${this.strategyBrief?.taunt ?? '—'}</span></div>
      </div>
    `;
  }

  setAdaptiveSnapshot(level: LevelData): void {
    this.aiDebugInfo = level.aiDebug;
    this.currentLevelIndex = level.index;
    this.liveObstacles = level.obstacles;
  }

  setPlayerModel(model: PlayerModel): void {
    this.playerModel = model;
  }

  setStrategyBrief(brief: StrategyBrief): void {
    this.strategyBrief = brief;
  }

  setRealtimeTrapDebug(debug: RealtimeTrapDebugView): void {
    this.realtimeTrapDebug = debug;
  }

  setLastPhaseDebug(info: PhaseDebugInfo): void {
    this.lastPhaseDebug = info;
  }

  private renderPhaseDebugSection(): string {
    const d = this.lastPhaseDebug;
    if (!d) {
      return `
      <div class="dbg-section">
        <div class="dbg-title">PHASE (last press)</div>
        <div class="dbg-row"><span>Status</span><span>(no E pressed yet)</span></div>
      </div>`;
    }
    const reasonColor =
      d.reason === 'success' ? '#7ef07e' :
      d.reason === 'noCandidates' ? '#ff7777' :
      d.reason === 'allCandidatesUnreachable' ? '#ffaa55' :
      d.reason === 'inPit' ? '#ff66aa' :
      '#ffd95a';
    const attempts = d.candidateAttempts.map((a) =>
      `<div class="dbg-row"><span>${a.kind}@${Math.round(a.x)} (w${Math.round(a.width)})</span><span>${a.note}</span></div>`
    ).join('');
    return `
      <div class="dbg-section">
        <div class="dbg-title">PHASE (last press)</div>
        <div class="dbg-row"><span>Reason</span><span style="color:${reasonColor}">${d.reason}</span></div>
        <div class="dbg-row"><span>Player</span><span>x=${Math.round(d.playerX)} y=${Math.round(d.playerY)} ${d.playerOnGround ? 'ground' : 'air'}</span></div>
        <div class="dbg-row"><span>Mode</span><span>${d.airborne ? 'airborne' : 'grounded'}</span></div>
        <div class="dbg-row"><span>Candidates</span><span>${d.candidateCount}: ${d.candidateKinds.join(', ') || '—'}</span></div>
        ${attempts || '<div class="dbg-row"><span>—</span><span>no attempts</span></div>'}
      </div>`;
  }

  private renderAiModifiersSection(): string {
    const modified = this.liveObstacles.filter(o => o.aiModifier);
    if (modified.length === 0) return '';
    const rows = modified.map(o => {
      const h = o.aiModVisualHeight !== undefined ? ` h=${Math.round(o.aiModVisualHeight)}` : '';
      const drop = o.aiModDropOffset !== undefined && o.aiModDropOffset > 0 ? ` drop=${Math.round(o.aiModDropOffset)}` : '';
      return `<div class="dbg-row"><span>${o.kind}@${Math.round(o.x)}</span><span>${o.aiModifier} [${o.aiModState ?? '?'}]${h}${drop}</span></div>`;
    }).join('');
    return `
      <div class="dbg-section">
        <div class="dbg-title">AI MODIFIERS (${modified.length} active)</div>
        ${rows}
      </div>`;
  }


  private makeButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.id = 'debug-toggle';
    btn.textContent = 'AI Data';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.visible = !this.visible;
      this.panel.style.display = this.visible ? 'block' : 'none';
      btn.classList.toggle('active', this.visible);
    });
    // Prevent tap from propagating to canvas as a jump
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    return btn;
  }

  private makePanel(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'debug-panel';
    el.style.display = 'none';
    // Prevent touches on panel from jumping
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    return el;
  }
}
