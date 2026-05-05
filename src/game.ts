import { Player } from './player';
import { buildLevel, LevelData } from './level';
import { InputHandler } from './input';
import { Renderer } from './renderer';
import { RunTracker } from './runTracker';
import { DebugPanel } from './debugPanel';
import { GameState, Obstacle } from './types';
import { generateAdaptiveLevel } from './adaptiveGenerator';
import { deathMessage, introMessage, levelCompleteMessage, levelStartMessage } from './aiGameMaster';
import { PlayerModel } from './telemetry';
import { analyzePlayer } from './playerAnalyzer';

const SPAWN_X = 80;
const DEATH_INPUT_DELAY = 0.4;  // seconds before tap-to-retry accepted after death
const SAMPLE_INTERVAL = 0.2;    // seconds between position samples
const LEVEL_HIGHLIGHT_SECS = 2.4;
const AI_MESSAGE_SECS = 2.6;
const LOW_CEILING_THICKNESS = 16; // keep in sync with renderer low-ceiling draw thickness
const CHOICE_BAR_THICKNESS = 12;  // keep in sync with renderer choice-obstacle draw thickness

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
  private levelAgeSec = 0;
  private aiMessage = '';
  private aiMessageTimeLeft = 0;
  private introShown = false;
  private playerModel: PlayerModel = analyzePlayer([]);

  // Ground-state tracking for landing/airtime detection
  private wasOnGround = true; // previous frame's ground state, persisted across frames
  private airStartMs: number | null = null;
  private sampleTimer = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input = new InputHandler(canvas);
    this.tracker = new RunTracker();
    this.debugPanel = new DebugPanel(this.tracker);
    this.debugPanel.setPlayerModel(this.playerModel);
    this.setupResize();
    this.startLevel(0);
  }

  private resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  private startLevel(index: number) {
    this.refreshPlayerModel();
    this.resizeCanvas();
    this.levelIndex = index;
    this.level = this.buildLevelForIndex(index);
    this.level.groundY = this.canvas.height - 80;
    this.spawnPlayer();
    this.cameraX = 0;
    this.state = 'playing';
    this.resetFrameTracking();
    this.tracker.startRun(index, this.attempts, this.level.obstacles);
    this.debugPanel.setAdaptiveSnapshot(this.level);
    this.debugPanel.setPlayerModel(this.playerModel);
    this.levelAgeSec = 0;

    if (!this.introShown && index === 0) {
      this.showAIMessage(introMessage());
      this.introShown = true;
    } else if (index > 0) {
      this.showAIMessage(levelStartMessage(this.level, this.tracker.getProfile(), index + 1));
    }
  }

  private restartLevel() {
    this.attempts++;
    this.level.groundY = this.canvas.height - 80;
    this.spawnPlayer();
    this.cameraX = 0;
    this.state = 'playing';
    this.resetFrameTracking();
    this.tracker.startRun(this.levelIndex, this.attempts, this.level.obstacles);
  }

  private buildLevelForIndex(index: number): LevelData {
    // Level 1 remains static tutorial; adaptive generation starts at Level 2+.
    if (index === 0) {
      return buildLevel(index, this.canvas.height);
    }

    const runs = this.tracker.getAllRuns();
    const profile = this.tracker.getProfile();
    // Kept in Game state for future generator input extension.
    const _modelForFuture = this.playerModel;
    void _modelForFuture;
    return generateAdaptiveLevel(runs, profile, this.playerModel, index, this.canvas.width);
  }

  private refreshPlayerModel() {
    this.playerModel = analyzePlayer(this.tracker.getAllRuns());
  }

  private resetFrameTracking() {
    this.wasOnGround = this.player.onGround;
    this.airStartMs = null;
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
    // Spawn starts grounded; prevents a false air→ground landing on first frame.
    this.player.onGround = true;
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
    this.levelAgeSec += dt;
    if (this.aiMessageTimeLeft > 0) {
      this.aiMessageTimeLeft = Math.max(0, this.aiMessageTimeLeft - dt);
    }

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
          this.attempts = 1;
          this.startLevel(next);
        }
        break;

      case 'playing':
        this.updatePlaying(dt);
        break;
    }
  }

  private updatePlaying(dt: number) {
    const { player, level, tracker } = this;
    const wantsCrouch = this.input.isCrouchHeld();

    if (wantsCrouch && player.onGround && !player.isCrouching) {
      player.setCrouch(true);
      tracker.recordAction('crouchStart', player.pos.x);
    } else if ((!wantsCrouch || !player.onGround) && player.isCrouching) {
      player.setCrouch(false);
      tracker.recordAction('crouchEnd', player.pos.x);
    }

    // --- Input: only record a jump if the player is actually on the ground ---
    if (this.input.consumeJump()) {
      const wasCrouching = player.isCrouching;
      if (player.onGround) {
        tracker.recordJump(player.pos.x, player.pos.y);
        tracker.recordAction('jump', player.pos.x);
      }
      player.jump();
      if (wasCrouching && !player.isCrouching) {
        tracker.recordAction('crouchEnd', player.pos.x);
      }
    }

    // Read previous frame's ground state before any mutation this frame
    const wasOnGround = this.wasOnGround;

    const cx = player.pos.x + player.width / 2;
    const effectiveFloor = this.getEffectiveFloor(cx);
    player.update(dt, effectiveFloor ?? level.groundY, effectiveFloor !== null);

    // --- Ground state transitions ---
    if (wasOnGround && !player.onGround) {
      // Became airborne (jumped or walked off edge)
      this.airStartMs = performance.now();
    }
    if (!wasOnGround && player.onGround && this.airStartMs !== null) {
      // Landed
      const airTimeMs = performance.now() - this.airStartMs;
      tracker.recordLanding(player.pos.x, player.pos.y, airTimeMs);
      this.airStartMs = null;
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
    if (this.hitLowCeiling()) {
      this.triggerDeath('spike', player.pos.x);
      return;
    }
    if (this.hitChoiceObstacle()) {
      this.triggerDeath('spike', player.pos.x);
      return;
    }

    // --- Win check ---
    if (player.pos.x + player.width >= level.flagX) {
      const currentRun = tracker.getCurrentRun();
      const landingEvents = currentRun?.landings ?? [];
      const lastLandingX = landingEvents.length > 0 ? landingEvents[landingEvents.length - 1].x : undefined;
      this.showAIMessage(levelCompleteMessage(lastLandingX, tracker.getProfile().jumpStyle));
      tracker.finishRun(true);
      this.refreshPlayerModel();
      this.debugPanel.setPlayerModel(this.playerModel);
      this.state = 'levelComplete';
    }
  }

  // Returns the Y-coordinate of the floor under the player, or null if void (gap, no platform).
  // platform.height = elevation of platform surface above groundY.
  private getEffectiveFloor(cx: number): number | null {
    const overGap = this.level.obstacles.some(
      o => o.kind === 'gap' && cx >= o.x && cx <= o.x + o.width
    );
    if (!overGap) return this.level.groundY;

    const platform = this.level.obstacles.find(
      o => o.kind === 'platform' && cx >= o.x && cx <= o.x + o.width
    );
    return platform ? this.level.groundY - platform.height : null;
  }

  private hitSpike(): boolean {
    const px = this.player.pos.x;
    const pr = px + this.player.width;
    const pb = this.player.pos.y + this.player.height;
    const inset = 6;

    return this.level.obstacles
      .filter(o => o.kind === 'spike' || o.kind === 'doubleSpike')
      .some(s => {
        const spikeHitTop = this.level.groundY - s.height + 12;
        return px + inset < s.x + s.width - inset && pr - inset > s.x + inset && pb > spikeHitTop;
      });
  }

  private hitChoiceObstacle(): boolean {
    if (this.player.isCrouching) return false;

    const px = this.player.pos.x;
    const pr = px + this.player.width;
    const playerTop = this.player.pos.y;
    const playerBottom = playerTop + this.player.height;

    return this.level.obstacles
      .filter(o => o.kind === 'choiceObstacle')
      .some(c => {
        const barBottom = this.level.groundY - c.height;
        const barTop = barBottom - CHOICE_BAR_THICKNESS;
        const xOverlap = pr > c.x && px < c.x + c.width;
        const yOverlap = playerBottom > barTop && playerTop < barBottom;
        return xOverlap && yOverlap;
      });
  }

  private hitLowCeiling(): boolean {
    if (this.player.isCrouching) return false;

    const ceilings = this.level.obstacles.filter(
      (o): o is Obstacle & { kind: 'lowCeiling' } => o.kind === 'lowCeiling'
    );
    const px = this.player.pos.x;
    const pr = px + this.player.width;
    const playerTop = this.player.pos.y;
    const playerBottom = playerTop + this.player.height;

    return ceilings.some((c) => {
      const slabTop = this.level.groundY - c.height - LOW_CEILING_THICKNESS;
      const slabBottom = this.level.groundY - c.height;

      const xOverlap = pr > c.x && px < c.x + c.width;
      const yOverlap = playerBottom > slabTop && playerTop < slabBottom;
      return xOverlap && yOverlap;
    });
  }

  private triggerDeath(reason: 'spike' | 'gap', deathX: number) {
    this.showAIMessage(deathMessage(reason, deathX, this.tracker.getProfile().jumpStyle));
    this.tracker.finishRun(false, reason, deathX);
    this.refreshPlayerModel();
    this.debugPanel.setPlayerModel(this.playerModel);
    this.state = 'dead';
    this.deathTimer = 0;
  }

  private showAIMessage(text: string) {
    this.aiMessage = text;
    this.aiMessageTimeLeft = AI_MESSAGE_SECS;
  }

  private draw() {
    this.renderer.drawBackground();
    const obstaclePulse = this.level.index > 0
      ? Math.max(0, 1 - this.levelAgeSec / LEVEL_HIGHLIGHT_SECS)
      : 0;
    this.renderer.drawLevel(this.level, this.cameraX, obstaclePulse);
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
      this.renderer.drawLevelCompleteOverlay(this.canvas, this.levelIndex + 2);
    }

    if (this.aiMessageTimeLeft > 0) {
      const fade = Math.min(1, this.aiMessageTimeLeft / 0.4);
      this.renderer.drawAIGameMasterMessage(this.aiMessage, fade);
    }

    this.debugPanel.update();
  }
}
