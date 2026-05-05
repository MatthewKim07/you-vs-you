import { Player } from './player';
import { buildLevel, LevelData, TOTAL_LEVELS } from './level';
import { InputHandler } from './input';
import { Renderer } from './renderer';
import { RunTracker } from './runTracker';
import { DebugPanel } from './debugPanel';
import { GameState, Obstacle } from './types';

const SPAWN_X = 80;
const DEATH_INPUT_DELAY = 0.4;  // seconds before tap-to-retry accepted after death
const SAMPLE_INTERVAL = 0.2;    // seconds between position samples

export class Game {
  private player!: Player;
  private level!: LevelData;
  private input!: InputHandler;
  private renderer!: Renderer;
  private tracker: RunTracker;
  private debugPanel: DebugPanel;
  private state: GameState = 'playing';
  private cameraX = 0;
  private lastTime = 0;
  private levelIndex = 0;
  private attempts = 1;
  private deathTimer = 0;

  // Ground-state tracking for landing/airtime detection
  private wasOnGround = true; // previous frame's ground state, persisted across frames
  private airStartMs = 0;
  private sampleTimer = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input = new InputHandler(canvas);
    this.tracker = new RunTracker();
    this.debugPanel = new DebugPanel(this.tracker);
    this.setupResize();
    this.startLevel(0);
  }

  private resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  private startLevel(index: number) {
    this.resizeCanvas();
    this.levelIndex = index;
    this.level = buildLevel(index, this.canvas.height);
    this.spawnPlayer();
    this.cameraX = 0;
    this.state = 'playing';
    this.resetFrameTracking();
    this.tracker.startRun(index, this.attempts);
  }

  private restartLevel() {
    this.attempts++;
    this.level.groundY = this.canvas.height - 80;
    this.spawnPlayer();
    this.cameraX = 0;
    this.state = 'playing';
    this.resetFrameTracking();
    this.tracker.startRun(this.levelIndex, this.attempts);
  }

  private resetFrameTracking() {
    this.wasOnGround = true; // player always spawns on ground
    this.airStartMs = 0;
    this.sampleTimer = 0;
    this.deathTimer = 0;
  }

  private spawnPlayer() {
    const spawnY = this.level.groundY - 48;
    if (!this.player) {
      this.player = new Player(SPAWN_X, spawnY);
    } else {
      this.player.reset(SPAWN_X, spawnY);
    }
  }

  private setupResize() {
    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.level.groundY = this.canvas.height - 80;
      if (this.state === 'playing') {
        this.player.pos.y = Math.min(this.player.pos.y, this.level.groundY - this.player.height);
      }
    });
  }

  start() {
    requestAnimationFrame(this.loop);
  }

  private loop = (timestamp: number) => {
    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
    this.lastTime = timestamp;
    this.update(dt);
    this.draw();
    requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    switch (this.state) {
      case 'dead':
        this.deathTimer += dt;
        if (this.deathTimer >= DEATH_INPUT_DELAY && this.input.consumeJump()) {
          this.restartLevel();
        }
        break;

      case 'levelComplete':
        if (this.input.consumeJump()) {
          const next = this.levelIndex + 1;
          if (next >= TOTAL_LEVELS) {
            this.state = 'allComplete';
          } else {
            this.attempts = 1;
            this.startLevel(next);
          }
        }
        break;

      case 'allComplete':
        if (this.input.consumeJump()) {
          this.attempts = 1;
          this.startLevel(0);
        }
        break;

      case 'playing':
        this.updatePlaying(dt);
        break;
    }
  }

  private updatePlaying(dt: number) {
    const { player, level, tracker } = this;

    // --- Input: only record a jump if the player is actually on the ground ---
    if (this.input.consumeJump()) {
      if (player.onGround) {
        tracker.recordJump(player.pos.x, player.pos.y);
      }
      player.jump();
    }

    // Read previous frame's ground state before any mutation this frame
    const wasOnGround = this.wasOnGround;

    const overGap = this.isOverGap();
    player.update(dt, level.groundY, !overGap);

    // --- Ground state transitions ---
    if (wasOnGround && !player.onGround) {
      // Became airborne (jumped or walked off edge)
      this.airStartMs = performance.now();
    }
    if (!wasOnGround && player.onGround) {
      // Landed
      const airTimeMs = performance.now() - this.airStartMs;
      tracker.recordLanding(player.pos.x, player.pos.y, airTimeMs);
    }

    // Persist for next frame — must happen after physics, before early returns
    this.wasOnGround = player.onGround;

    // --- Position samples at fixed interval (not every frame) ---
    this.sampleTimer += dt;
    if (this.sampleTimer >= SAMPLE_INTERVAL) {
      tracker.recordSample(player.pos.x, player.pos.y);
      this.sampleTimer = 0;
    }

    // --- Camera ---
    const targetX = player.pos.x - this.canvas.width * 0.25;
    this.cameraX = Math.max(0, Math.min(targetX, level.worldWidth - this.canvas.width));

    // --- Death checks ---
    if (player.pos.y > level.groundY + 60) {
      this.triggerDeath('gap', player.pos.x);
      return;
    }
    if (this.hitSpike()) {
      this.triggerDeath('spike', player.pos.x);
      return;
    }

    // --- Win check ---
    if (player.pos.x + player.width >= level.flagX) {
      tracker.finishRun(true);
      this.state = 'levelComplete';
      // AI HOOK (Milestone 4): pass tracker.getAllRuns() to level generator
    }
  }

  private isOverGap(): boolean {
    const cx = this.player.pos.x + this.player.width / 2;
    return this.level.obstacles.some(
      o => o.kind === 'gap' && cx >= o.x && cx <= o.x + o.width
    );
  }

  private hitSpike(): boolean {
    const spikes = this.level.obstacles.filter(
      (o): o is Obstacle & { kind: 'spike' } => o.kind === 'spike'
    );
    const px = this.player.pos.x;
    const pr = px + this.player.width;
    const pb = this.player.pos.y + this.player.height;

    return spikes.some(s => {
      const inset = 6;
      const spikeHitTop = this.level.groundY - s.height + 12;
      return px + inset < s.x + s.width - inset && pr - inset > s.x + inset && pb > spikeHitTop;
    });
  }

  private triggerDeath(reason: 'spike' | 'gap', deathX: number) {
    this.tracker.finishRun(false, reason, deathX);
    this.state = 'dead';
    this.deathTimer = 0;
  }

  private draw() {
    this.renderer.drawBackground();
    this.renderer.drawLevel(this.level, this.cameraX);
    this.renderer.drawPlayer(this.player, this.cameraX, this.state === 'dead');
    this.renderer.drawHUD(
      this.player.pos.x,
      this.level.flagX,
      this.canvas.width,
      this.canvas.height,
      this.levelIndex + 1,
      this.attempts,
    );

    if (this.state === 'dead') {
      this.renderer.drawDeathOverlay(this.canvas, this.deathTimer, DEATH_INPUT_DELAY);
    } else if (this.state === 'levelComplete') {
      this.renderer.drawLevelCompleteOverlay(this.canvas, this.levelIndex + 1, TOTAL_LEVELS);
    } else if (this.state === 'allComplete') {
      this.renderer.drawAllCompleteOverlay(this.canvas);
    }

    this.debugPanel.update();
  }
}
