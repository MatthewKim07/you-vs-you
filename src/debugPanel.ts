import { RunTracker } from './runTracker';
import { LevelData } from './level';

// HTML overlay — hidden by default, toggled via "AI Data" button.
// Reads from RunTracker only; no game logic here.
export class DebugPanel {
  private panel: HTMLDivElement;
  private button: HTMLButtonElement;
  private visible = false;
  private adaptivePlacements: number[] = [];
  private adaptiveNotes: string[] = [];
  private adaptiveObstacleCount = 0;

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

    const fmt = (n: number) => Math.round(n).toLocaleString();

    this.panel.innerHTML = `
      <div class="dbg-section">
        <div class="dbg-title">THIS RUN</div>
        <div class="dbg-row"><span>Jumps</span><span>${run?.jumps.length ?? '—'}</span></div>
        <div class="dbg-row"><span>Landings</span><span>${run?.landings.length ?? '—'}</span></div>
        <div class="dbg-row"><span>Samples</span><span>${run?.samples.length ?? '—'}</span></div>
      </div>
      <div class="dbg-section">
        <div class="dbg-title">PROFILE</div>
        <div class="dbg-row"><span>Total runs</span><span>${profile.totalRuns}</span></div>
        <div class="dbg-row"><span>Completed</span><span>${profile.completedRuns}</span></div>
        <div class="dbg-row"><span>Avg jump dist</span><span>${fmt(profile.averageJumpXDistance)}px</span></div>
        <div class="dbg-row"><span>Avg clear time</span><span>${fmt(profile.averageCompletionTimeMs)}ms</span></div>
        <div class="dbg-row"><span>Jump style</span><span>${profile.jumpStyle}</span></div>
        <div class="dbg-row"><span>Landing zones</span><span>${profile.commonLandingZones.map(fmt).join(', ') || '—'}</span></div>
      </div>
      <div class="dbg-section">
        <div class="dbg-title">ADAPTIVE</div>
        <div class="dbg-row"><span>Obstacles</span><span>${this.adaptiveObstacleCount || '—'}</span></div>
        <div class="dbg-row"><span>Placements</span><span>${this.adaptivePlacements.map(fmt).join(', ') || '—'}</span></div>
        <div class="dbg-row"><span>Note 1</span><span>${this.adaptiveNotes[0] ?? '—'}</span></div>
        <div class="dbg-row"><span>Note 2</span><span>${this.adaptiveNotes[1] ?? '—'}</span></div>
      </div>
    `;
  }

  setAdaptiveSnapshot(level: LevelData): void {
    this.adaptiveObstacleCount = level.aiDebug?.obstacleCount ?? 0;
    this.adaptivePlacements = level.aiDebug?.placementXs ?? [];
    this.adaptiveNotes = level.aiDebug?.notes ?? [];
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
