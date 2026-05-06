import { RunTracker } from './runTracker';
import { LevelData, AdaptiveDebugInfo } from './level';
import { PlayerModel } from './telemetry';
import { StrategyBrief } from './aiStrategist';

// HTML overlay — hidden by default, toggled via "AI Data" button.
// Reads from RunTracker only; no game logic here.
export class DebugPanel {
  private panel: HTMLDivElement;
  private button: HTMLButtonElement;
  private visible = false;
  private aiDebugInfo: AdaptiveDebugInfo | undefined;
  private currentLevelIndex = 0;
  private strategyBrief: StrategyBrief | undefined;
  private playerModel: PlayerModel = {
    prefersJump: true,
    prefersCrouch: false,
    jumpFrequency: 0,
    crouchFrequency: 0,
    reactionTiming: 'balanced',
    consistency: 'mixed',
    riskProfile: 'balanced',
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

    const fmt = (n: number) => Math.round(n).toLocaleString();
    const formatStyle = (style: string) => style.charAt(0).toUpperCase() + style.slice(1);
    const mostCommonLanding = profile.commonLandingZones[0];
    const dbg = this.aiDebugInfo;

    this.panel.innerHTML = `
      <div class="dbg-section">
        <div class="dbg-title">THIS RUN</div>
        <div class="dbg-row"><span>Jumps</span><span>${run?.jumps.length ?? '—'}</span></div>
        <div class="dbg-row"><span>Actions</span><span>${run?.actions.length ?? '—'}</span></div>
        <div class="dbg-row"><span>Landings</span><span>${run?.landings.length ?? '—'}</span></div>
        <div class="dbg-row"><span>Samples</span><span>${run?.samples.length ?? '—'}</span></div>
      </div>
      <div class="dbg-section">
        <div class="dbg-title">MODEL</div>
        <div class="dbg-row"><span>Total runs</span><span>${profile.totalRuns}</span></div>
        <div class="dbg-row"><span>Prefers</span><span>${model.prefersJump ? 'Jump' : 'Crouch'}</span></div>
        <div class="dbg-row"><span>Reaction</span><span>${formatStyle(model.reactionTiming)}</span></div>
        <div class="dbg-row"><span>Consistency</span><span>${formatStyle(model.consistency)}</span></div>
        <div class="dbg-row"><span>Risk</span><span>${formatStyle(model.riskProfile)}</span></div>
        <div class="dbg-row"><span>Most common landing</span><span>${mostCommonLanding ? `~${fmt(mostCommonLanding)}px` : '—'}</span></div>
      </div>
      <div class="dbg-section">
        <div class="dbg-title">ADAPTIVE (Level ${this.currentLevelIndex + 1})</div>
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
        <div class="dbg-row"><span>Advanced count</span><span>${dbg?.advancedCount ?? '—'}</span></div>
        <div class="dbg-row"><span>Platform</span><span>${dbg?.platformUsed ? 'yes' : 'no'}</span></div>
        <div class="dbg-row"><span>Difficulty trend</span><span>${dbg?.difficultyIncreasing ? 'increasing' : 'flat'}</span></div>
        <div class="dbg-row"><span>Validation</span><span>${dbg?.validationStatus ?? '—'}</span></div>
        <div class="dbg-row"><span>Warnings</span><span>${dbg?.validationWarnings.join(' | ') || 'none'}</span></div>
        <div class="dbg-row"><span>Attempted</span><span>${dbg?.attempted ?? '—'}</span></div>
        <div class="dbg-row"><span>Placed</span><span>${dbg?.patterns.length ?? '—'}</span></div>
        <div class="dbg-row"><span>Obstacles</span><span>${dbg?.obstacleCount ?? '—'}</span></div>
        <div class="dbg-row"><span>Patterns</span><span>${dbg?.patterns.join(', ') || '—'}</span></div>
        <div class="dbg-row"><span>Variants</span><span>${dbg?.variants.join(', ') || '—'}</span></div>
        <div class="dbg-row"><span>Anti-repeat</span><span>${dbg?.antiRepeat.join(' | ') || 'none'}</span></div>
        <div class="dbg-row"><span>Dropped</span><span>${dbg?.dropped.join(', ') || 'none'}</span></div>
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
  }

  setPlayerModel(model: PlayerModel): void {
    this.playerModel = model;
  }

  setStrategyBrief(brief: StrategyBrief): void {
    this.strategyBrief = brief;
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
