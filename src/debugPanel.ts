import { RunTracker } from './runTracker';
import { LevelData } from './level';
import { PlayerModel } from './telemetry';

// HTML overlay — hidden by default, toggled via "AI Data" button.
// Reads from RunTracker only; no game logic here.
export class DebugPanel {
  private panel: HTMLDivElement;
  private button: HTMLButtonElement;
  private visible = false;
  private adaptivePlacements: number[] = [];
  private adaptiveNotes: string[] = [];
  private adaptiveObstacleCount = 0;
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
    const lastChange = this.adaptiveNotes.find((n) => n.includes('near landing') || n.includes('near death'))
      ?? this.adaptiveNotes[1]
      ?? this.adaptiveNotes[0];

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
        <div class="dbg-title">ADAPTIVE</div>
        <div class="dbg-row"><span>Obstacles</span><span>${this.adaptiveObstacleCount || '—'}</span></div>
        <div class="dbg-row"><span>Placements</span><span>${this.adaptivePlacements.map(fmt).join(', ') || '—'}</span></div>
        <div class="dbg-row"><span>Last change</span><span>${lastChange ?? '—'}</span></div>
      </div>
    `;
  }

  setAdaptiveSnapshot(level: LevelData): void {
    this.adaptiveObstacleCount = level.aiDebug?.obstacleCount ?? 0;
    this.adaptivePlacements = level.aiDebug?.placementXs ?? [];
    this.adaptiveNotes = level.aiDebug?.notes ?? [];
  }

  setPlayerModel(model: PlayerModel): void {
    this.playerModel = model;
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
