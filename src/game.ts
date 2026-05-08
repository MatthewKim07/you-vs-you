import { Player } from './player';
import { buildLevel, LevelData } from './level';
import { InputHandler } from './input';
import { Renderer } from './renderer';
import { RunTracker } from './runTracker';
import { DebugPanel } from './debugPanel';
import { GameState, Obstacle } from './types';
import { generateAdaptiveLevel } from './adaptiveGenerator';
import { introMessage } from './aiGameMaster';
import { PlayerModel, ChoiceDecisionEvent, ObstacleInteractionEvent, RouteId } from './telemetry';
import { analyzePlayer } from './playerAnalyzer';
import { JUMP_CUT_FACTOR } from './movementTuning';
import {
  StrategyBrief,
  StrategistPhase,
  StrategyBriefInput,
  createLocalStrategyBrief,
  maybeFetchStrategyBrief,
  summarizeRecentRuns,
} from './aiStrategist';
import { updateRealtimeTraps, resetTrapHosts, isPlayerOnPlatform, RealtimeTrapDebug } from './aiTrapDirector';
import {
  resetDisappearingPlatforms, resetAiModifiers,
  DISAPPEAR_FLICKER_MS, DISAPPEAR_INVISIBLE_MS, DISAPPEAR_REAPPEAR_MS,
  RISING_INACTIVE_MS, RISING_WARNING_MS, RISING_RISE_MS, RISING_HOLD_MS, RISING_RETRACT_MS,
  PULSE_ACTIVE_MS, PULSE_RETRACT_MS, PULSE_INACTIVE_MS, PULSE_RISE_MS,
  DROP_WARNING_MS, DROP_FALL_MS, DROP_INVISIBLE_MS, DROP_SPAWN_MS,
  BLOCKER_INACTIVE_MS, BLOCKER_WARNING_MS, BLOCKER_ACTIVE_MS, BLOCKER_RETRACT_MS,
} from './levelMutator';
import { calculateKnowledge } from './aiKnowledge';
import { GameAudio } from './gameAudio';

const SPAWN_X = 80;
const DEATH_INPUT_DELAY = 0.4;  // seconds before tap-to-retry accepted after death
const SAMPLE_INTERVAL = 0.2;    // seconds between position samples
const LEVEL_HIGHLIGHT_SECS = 2.4;
const AI_MESSAGE_SECS = 2.6;
const TRAP_MESSAGE_COOLDOWN_SECS = 1.2;
const START_COUNTDOWN_SECS = 3.0;
const PREVIEW_PATTERN_START = 340;
const PREVIEW_PATTERN_SPAN = 1200;
const PREVIEW_PATTERN_REPEAT_COUNT = 18;
const LOW_CEILING_THICKNESS = 16; // keep in sync with renderer low-ceiling draw thickness
const CHOICE_BAR_THICKNESS = 12;  // keep in sync with renderer choice-obstacle draw thickness
const CHOICE_TILE_WIDTH = 116;
const CHOICE_TILE_HEIGHT = 34;
const SUPPORT_EDGE_INSET = 0;     // use full body bounds so platform visuals match collision exactly
const PLATFORM_SNAP_TOLERANCE = 10;
const MIN_SUPPORT_WIDTH = 8;
const GROUND_RECOVERY_TOLERANCE = 10;
const ROUTE_SWITCH_MIN_X_DELTA = 88;
const ROUTE_LOWER_MAX_HEIGHT = 22;
const ROUTE_MID_MAX_HEIGHT = 86;

export class Game {
  private player!: Player;
  private level!: LevelData;
  private input!: InputHandler;
  private renderer!: Renderer;
  private tracker: RunTracker;
  private debugPanel: DebugPanel;
  private state: GameState = 'menu';
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
  private strategistRequestSeq = 0;
  private hasSpawnedPlayer = false;
  private countdownSec = 0;
  private previewLastJumpObstacleX = Number.NEGATIVE_INFINITY;
  private menuOverlay!: HTMLDivElement;
  private playButton!: HTMLButtonElement;
  private controlBar!: HTMLDivElement;
  private pauseButton!: HTMLButtonElement;
  private exitButton!: HTMLButtonElement;
  private audioToggleButton!: HTMLButtonElement;
  private lastTrapMessageAt = Number.NEGATIVE_INFINITY;
  private audio = new GameAudio();
  private showHitboxes = false;

  // Ground-state tracking for landing/airtime detection
  private wasOnGround = true; // previous frame's ground state, persisted across frames
  private airStartMs: number | null = null;
  private sampleTimer = 0;
  private canCutCurrentJump = false;
  // Choice obstacle tracking: which choice obs we've already recorded a decision for
  private observedChoices = new Set<string>();
  private choicePassState = new Map<string, { airborne: boolean; crouching: boolean }>();
  private observedObstacleInteractions = new Set<string>();
  private trapRuntimeDebug: RealtimeTrapDebug = {
    phase: 'observe',
    activeTrap: 'none',
    trapState: 'none',
    activeRoute: 'none',
    predictedAction: 'unknown',
    predictedLandingX: undefined as number | undefined,
    trapReason: 'none',
    confidence: 0,
    lastMutation: 'none',
    mutationCountsByRoute: { lower: 0, mid: 0, upper: 0 },
  };
  private routeMutationTotals = { lower: 0, mid: 0, upper: 0 };
  private currentRoute: RouteId = 'lower';
  private lastRouteEventX = Number.NEGATIVE_INFINITY;
  private audioArmed = false;
  private lastCountdownAnnounced: number | null = null;
  private audioMuted = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input = new InputHandler(canvas);
    this.tracker = new RunTracker();
    this.debugPanel = new DebugPanel(this.tracker);
    this.debugPanel.setPlayerModel(this.playerModel);
    this.setupResize();
    this.setupUi();
    this.armAudioOnFirstGesture();
    this.enterMenu();
  }

  private armAudioOnFirstGesture() {
    if (this.audioArmed) return;
    this.audioArmed = true;

    const arm = () => {
      this.audio.unlock();
      if (this.audioMuted) return;
      if (this.state === 'menu') this.audio.startMenuMusic();
      if (this.state === 'playing') this.audio.startGameplayMusic();
    };

    window.addEventListener('pointerdown', arm, { once: true, passive: true });
    window.addEventListener('keydown', arm, { once: true });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH') this.showHitboxes = !this.showHitboxes;
    });
  }

  private resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  private startLevel(index: number, startMode: 'immediate' | 'countdown' = 'immediate') {
    this.refreshPlayerModel();
    this.resizeCanvas();
    this.levelIndex = index;
    this.level = this.buildLevelForIndex(index);
    this.normalizeChoiceObstacleDimensions(this.level.obstacles);
    this.level.groundY = this.canvas.height - 80;
    this.spawnPlayer();
    this.hasSpawnedPlayer = true;
    this.cameraX = 0;
    this.state = startMode === 'countdown' ? 'countdown' : 'playing';
    this.resetFrameTracking();
    this.tracker.startRun(index, this.attempts, this.level.obstacles, {
      difficulty: this.level.aiDebug?.difficulty,
      strategy: this.level.aiDebug?.strategy,
      density: this.level.aiDebug?.density,
      variants: this.level.aiDebug?.variants,
    });
    this.debugPanel.setAdaptiveSnapshot(this.level);
    this.debugPanel.setPlayerModel(this.playerModel);
    this.levelAgeSec = 0;
    this.countdownSec = startMode === 'countdown' ? START_COUNTDOWN_SECS : 0;
    this.lastCountdownAnnounced = null;
    this.syncUiVisibility();

    if (this.state === 'playing') {
      this.audio.startGameplayMusic();
    } else {
      // During menu overlay + countdown we keep silence / minimal noise.
      this.audio.stopMusic();
    }

    if (!this.introShown && index === 0) {
      this.showAIMessage(introMessage());
      this.introShown = true;
    } else if (index > 0) {
      this.publishStrategyBrief('levelStart');
    }
  }

  private restartLevel() {
    this.attempts++;
    this.level.groundY = this.canvas.height - 80;
    // Reset trap host states so they can re-arm on the new run.
    resetTrapHosts(this.level.obstacles);
    // Reset disappearing platforms to visible so they cycle fresh each run.
    resetDisappearingPlatforms(this.level.obstacles);
    // Reset AI modifier state machines to initial states.
    resetAiModifiers(this.level.obstacles);
    this.spawnPlayer();
    this.cameraX = 0;
    this.state = 'playing';
    this.hasSpawnedPlayer = true;
    this.resetFrameTracking();
    this.tracker.startRun(this.levelIndex, this.attempts, this.level.obstacles, {
      difficulty: this.level.aiDebug?.difficulty,
      strategy: this.level.aiDebug?.strategy,
      density: this.level.aiDebug?.density,
      variants: this.level.aiDebug?.variants,
    });
    if (this.levelIndex > 0) {
      this.publishStrategyBrief('levelStart');
    }
    this.syncUiVisibility();

    this.audio.startGameplayMusic();
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
    this.canCutCurrentJump = false;
    this.observedChoices.clear();
    this.choicePassState.clear();
    this.observedObstacleInteractions.clear();
    this.lastTrapMessageAt = Number.NEGATIVE_INFINITY;
    this.trapRuntimeDebug = {
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
    this.routeMutationTotals = { lower: 0, mid: 0, upper: 0 };
    this.currentRoute = this.detectRouteFromPlayer();
    this.lastRouteEventX = Number.NEGATIVE_INFINITY;
    this.debugPanel.setRealtimeTrapDebug(this.trapRuntimeDebug);
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
      if ((this.state === 'playing' || this.state === 'paused') && this.hasSpawnedPlayer) {
        this.player.pos.y = Math.min(this.player.pos.y, this.level.groundY - this.player.height);
      }
    });
  }

  private setupUi() {
    this.controlBar = document.createElement('div');
    this.controlBar.id = 'game-controls';

    this.pauseButton = document.createElement('button');
    this.pauseButton.id = 'pause-btn';
    this.pauseButton.className = 'game-control-btn';
    this.pauseButton.textContent = 'II Pause';
    this.pauseButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePause();
    });
    this.pauseButton.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.exitButton = document.createElement('button');
    this.exitButton.id = 'exit-btn';
    this.exitButton.className = 'game-control-btn';
    this.exitButton.textContent = 'Exit';
    this.exitButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playUiClick();
      this.enterMenu();
    });
    this.exitButton.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.controlBar.appendChild(this.pauseButton);
    this.controlBar.appendChild(this.exitButton);
    document.body.appendChild(this.controlBar);

    this.audioToggleButton = document.createElement('button');
    this.audioToggleButton.id = 'audio-toggle-btn';
    this.audioToggleButton.className = 'game-control-btn audio-toggle';
    this.audioToggleButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleAudioMute();
    });
    this.audioToggleButton.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(this.audioToggleButton);
    this.refreshAudioToggleUi();

    this.menuOverlay = document.createElement('div');
    this.menuOverlay.id = 'start-menu';
    this.menuOverlay.innerHTML = `
      <div class="menu-card">
        <h1>You vs You</h1>
        <p>The level learns you.</p>
      </div>
    `;

    this.playButton = document.createElement('button');
    this.playButton.id = 'play-btn';
    this.playButton.innerHTML = '<span class="play-arrow"></span><span>Play</span>';
    this.playButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.startFromMenu();
    });
    this.playButton.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.menuOverlay.appendChild(this.playButton);
    document.body.appendChild(this.menuOverlay);
    this.syncUiVisibility();
  }

  private enterMenu() {
    if (this.state === 'playing' || this.state === 'paused') {
      this.tracker.finishRun(false);
      this.refreshPlayerModel();
      this.debugPanel.setPlayerModel(this.playerModel);
    }

    this.resizeCanvas();
    this.levelIndex = 0;
    this.attempts = 1;
    this.level = this.buildMenuPreviewLevel();
    this.normalizeChoiceObstacleDimensions(this.level.obstacles);
    this.level.groundY = this.canvas.height - 80;
    this.cameraX = 0;
    this.levelAgeSec = 0;
    this.countdownSec = 0;
    this.lastCountdownAnnounced = null;
    this.aiMessage = '';
    this.aiMessageTimeLeft = 0;
    this.spawnPreviewPlayer();
    this.hasSpawnedPlayer = true;
    this.state = 'menu';
    this.debugPanel.setAdaptiveSnapshot(this.level);
    this.syncUiVisibility();
    this.audio.startMenuMusic();
  }

  private startFromMenu() {
    this.audio.unlock();
    this.audio.playUiClick();
    this.audio.playMenuStart();
    this.audio.stopMusic();
    this.attempts = 1;
    this.startLevel(0, 'countdown');
  }

  private togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
    } else if (this.state === 'paused') {
      this.state = 'playing';
    } else {
      return;
    }
    this.audio.setPaused(this.state === 'paused');
    this.audio.playUiClick();
    this.pauseButton.textContent = this.state === 'paused' ? 'Resume' : 'II Pause';
    this.syncUiVisibility();
  }

  private syncUiVisibility() {
    const inMenu = this.state === 'menu';
    this.menuOverlay.style.display = inMenu ? 'flex' : 'none';
    this.controlBar.style.display = inMenu ? 'none' : 'flex';
    this.pauseButton.textContent = this.state === 'paused' ? 'Resume' : 'II Pause';
  }

  private toggleAudioMute() {
    this.audioMuted = !this.audioMuted;
    this.audio.setEnabled(!this.audioMuted);
    if (!this.audioMuted) {
      this.audio.unlock();
      this.audio.playUiClick();
      if (this.state === 'menu') {
        this.audio.startMenuMusic();
      } else if (this.state === 'playing' || this.state === 'paused') {
        this.audio.startGameplayMusic();
        this.audio.setPaused(this.state === 'paused');
      }
    }
    this.refreshAudioToggleUi();
  }

  private refreshAudioToggleUi() {
    if (!this.audioToggleButton) return;
    this.audioToggleButton.classList.toggle('muted', this.audioMuted);
    this.audioToggleButton.innerHTML = this.audioMuted
      ? `<svg class="audio-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 9h4l5-4v14l-5-4H3z"></path>
          <path d="M15 9.5c.9.6 1.5 1.5 1.5 2.5s-.6 1.9-1.5 2.5"></path>
          <path d="M17.5 7c1.5 1.1 2.5 2.9 2.5 5s-1 3.9-2.5 5"></path>
          <path d="M4 20L20 4"></path>
        </svg>`
      : `<svg class="audio-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 9h4l5-4v14l-5-4H3z"></path>
          <path d="M15 9.5c.9.6 1.5 1.5 1.5 2.5s-.6 1.9-1.5 2.5"></path>
          <path d="M17.5 7c1.5 1.1 2.5 2.9 2.5 5s-1 3.9-2.5 5"></path>
        </svg>`;
    this.audioToggleButton.setAttribute('aria-label', this.audioMuted ? 'Unmute audio' : 'Mute audio');
    this.audioToggleButton.setAttribute('title', this.audioMuted ? 'Audio muted' : 'Audio on');
  }

  private buildMenuPreviewLevel(): LevelData {
    const pattern: Obstacle[] = [
      { kind: 'spike', x: 140, width: 44, height: 52 },
      { kind: 'lowCeiling', x: 310, width: 170, height: 34 },
      { kind: 'doubleSpike', x: 620, width: 104, height: 52 },
      { kind: 'choiceObstacle', x: 920, width: CHOICE_TILE_WIDTH, height: CHOICE_TILE_HEIGHT },
    ];

    const obstacles: Obstacle[] = [];
    for (let i = 0; i < PREVIEW_PATTERN_REPEAT_COUNT; i++) {
      const offset = PREVIEW_PATTERN_START + i * PREVIEW_PATTERN_SPAN;
      for (const p of pattern) {
        obstacles.push({
          kind: p.kind,
          x: offset + p.x,
          width: p.width,
          height: p.height,
        });
      }
    }

    const worldWidth = PREVIEW_PATTERN_START + PREVIEW_PATTERN_REPEAT_COUNT * PREVIEW_PATTERN_SPAN + 560;

    return {
      index: 0,
      worldWidth,
      groundY: this.canvas.height - 80,
      flagX: worldWidth - 240,
      obstacles,
    };
  }

  private normalizeChoiceObstacleDimensions(obstacles: Obstacle[]) {
    for (const o of obstacles) {
      if (o.kind !== 'choiceObstacle') continue;
      o.width = CHOICE_TILE_WIDTH;
      o.height = CHOICE_TILE_HEIGHT;
      if (o.currentWidth !== undefined) o.currentWidth = CHOICE_TILE_WIDTH;
      if (o.targetWidth !== undefined) o.targetWidth = CHOICE_TILE_WIDTH;
      if (o.trapInitialWidth !== undefined) o.trapInitialWidth = CHOICE_TILE_WIDTH;
      // Keep AI-authored crouch-counter heights (targetHeight ~= floor).
      const preserveTrapHeights = o.trapType === 'adaptiveChoiceGateCrouch';
      if (!preserveTrapHeights) {
        if (o.currentHeight !== undefined) o.currentHeight = CHOICE_TILE_HEIGHT;
        if (o.targetHeight !== undefined) o.targetHeight = CHOICE_TILE_HEIGHT;
        if (o.trapInitialHeight !== undefined) o.trapInitialHeight = CHOICE_TILE_HEIGHT;
      }
    }
  }

  private spawnPreviewPlayer() {
    const spawnY = this.level.groundY - 48;
    if (!this.player) {
      this.player = new Player(SPAWN_X, spawnY);
    } else {
      this.player.reset(SPAWN_X, spawnY);
    }
    this.player.onGround = true;
    this.player.setCrouch(false);
    this.wasOnGround = true;
    this.airStartMs = null;
    this.canCutCurrentJump = false;
    this.sampleTimer = 0;
    this.previewLastJumpObstacleX = Number.NEGATIVE_INFINITY;
  }

  private updateMenuPreview(dt: number) {
    const player = this.player;
    const obstacles = this.level.obstacles;
    const playerFront = player.pos.x + player.width;
    const upcoming = obstacles
      .filter((o) => o.x + o.width > player.pos.x - 24)
      .sort((a, b) => a.x - b.x)[0];

    let wantsCrouch = false;
    if (upcoming && (upcoming.kind === 'lowCeiling' || upcoming.kind === 'choiceObstacle')) {
      const crouchStart = upcoming.x - 30;
      const crouchEnd = upcoming.x + upcoming.width + 26;
      wantsCrouch = playerFront >= crouchStart && player.pos.x <= crouchEnd;
    }

    if (wantsCrouch && player.onGround && !player.isCrouching) {
      player.setCrouch(true);
    } else if (!wantsCrouch && player.isCrouching && (upcoming?.x ?? Infinity) - playerFront > 14) {
      player.setCrouch(false);
    }

    if (upcoming && player.onGround && !player.isCrouching) {
      const jumpDistance = upcoming.x - playerFront;
      const shouldJump =
        (upcoming.kind === 'spike' && jumpDistance <= 70 && jumpDistance >= 36)
        || (upcoming.kind === 'doubleSpike' && jumpDistance <= 54 && jumpDistance >= 24);
      if (shouldJump && this.previewLastJumpObstacleX !== upcoming.x) {
        this.previewLastJumpObstacleX = upcoming.x;
        player.jump();
      }
    }

    const playerLeft = player.pos.x + SUPPORT_EDGE_INSET;
    const playerRight = player.pos.x + player.width - SUPPORT_EDGE_INSET;
    const playerBottom = player.pos.y + player.height;
    const prevTop = player.pos.y;
    const prevBottom = playerBottom;
    const prevLeft = playerLeft;
    const prevRight = playerRight;
    const effectiveFloor = this.getEffectiveFloor(playerLeft, playerRight, playerBottom, player.vel.y);
    player.update(dt, effectiveFloor ?? this.level.groundY, effectiveFloor !== null);
    this.resolvePlatformTopCollision(prevBottom);
    this.resolveSolidPlatformHeadCollision(prevTop);
    this.resolvePlatformSideCollision(prevLeft, prevRight);
    this.resolveGapWallCollision(prevLeft, prevRight);

    const targetX = player.pos.x - this.canvas.width * 0.32;
    this.cameraX = Math.max(0, Math.min(targetX, this.level.worldWidth - this.canvas.width));

    const wrapThreshold = PREVIEW_PATTERN_START + PREVIEW_PATTERN_SPAN * 2.6;
    if (player.pos.x > wrapThreshold) {
      player.pos.x -= PREVIEW_PATTERN_SPAN;
      this.cameraX = Math.max(0, this.cameraX - PREVIEW_PATTERN_SPAN);
      this.previewLastJumpObstacleX = Number.NEGATIVE_INFINITY;
    }

    if (this.hitSpike() || this.hitPlatformNeedle() || this.hitChoiceObstacle() || this.hitLowCeiling() || player.pos.y > this.level.groundY + 80) {
      this.spawnPreviewPlayer();
      this.cameraX = 0;
    }
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
    if (this.state !== 'menu' && this.state !== 'countdown') {
      this.levelAgeSec += dt;
    }
    if (this.aiMessageTimeLeft > 0 && this.state !== 'paused' && this.state !== 'menu' && this.state !== 'countdown') {
      this.aiMessageTimeLeft = Math.max(0, this.aiMessageTimeLeft - dt);
    }

    switch (this.state) {
      case 'menu':
        this.updateMenuPreview(dt);
        this.input.consumeJump();
        this.input.consumeJumpRelease();
        break;

      case 'countdown':
        this.input.consumeJump();
        this.input.consumeJumpRelease();
        {
          const count = Math.max(1, Math.ceil(this.countdownSec));
          if (this.lastCountdownAnnounced !== count) {
            this.lastCountdownAnnounced = count;
            this.audio.playCountdownTick(count);
          }
        }
        this.countdownSec = Math.max(0, this.countdownSec - dt);
        if (this.countdownSec <= 0) {
          this.state = 'playing';
          this.audio.playCountdownGo();
          this.audio.startGameplayMusic();
        }
        break;

      case 'paused':
        // Drain jump input while paused so resume does not trigger a jump.
        this.input.consumeJump();
        this.input.consumeJumpRelease();
        break;

      case 'dead':
        this.deathTimer += dt;
        if (this.deathTimer >= DEATH_INPUT_DELAY && this.input.consumeJump()) {
          this.audio.playRetry();
          this.restartLevel();
        }
        break;

      case 'levelComplete':
        if (this.input.consumeJump()) {
          const next = this.levelIndex + 1;
          this.attempts = 1;
          this.audio.playAdvance();
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
      tracker.recordAction('crouchStart', player.pos.x, player.pos.y);
    } else if ((!wantsCrouch || !player.onGround) && player.isCrouching) {
      player.setCrouch(false);
      tracker.recordAction('crouchEnd', player.pos.x, player.pos.y);
    }

    // --- Input: only record a jump if the player is actually on the ground ---
    if (this.input.consumeJump()) {
      const wasCrouching = player.isCrouching;
      if (player.onGround) {
        tracker.recordJump(player.pos.x, player.pos.y);
        tracker.recordAction('jump', player.pos.x, player.pos.y);
      }
      const didJump = player.jump();
      if (didJump) {
        this.audio.playJump();
        this.canCutCurrentJump = true;
      }
      if (wasCrouching && !player.isCrouching) {
        tracker.recordAction('crouchEnd', player.pos.x, player.pos.y);
      }
    }

    if (this.input.consumeJumpRelease() && this.canCutCurrentJump) {
      player.cutJump(JUMP_CUT_FACTOR);
      this.canCutCurrentJump = false;
    }

    // Read previous frame's ground state before any mutation this frame
    const wasOnGround = this.wasOnGround;

    const playerLeft = player.pos.x + SUPPORT_EDGE_INSET;
    const playerRight = player.pos.x + player.width - SUPPORT_EDGE_INSET;
    const playerBottom = player.pos.y + player.height;
    const prevTop = player.pos.y;
    const prevBottom = playerBottom;
    const prevLeft = playerLeft;
    const prevRight = playerRight;
    const effectiveFloor = this.getEffectiveFloor(playerLeft, playerRight, playerBottom, player.vel.y);
    player.update(dt, effectiveFloor ?? level.groundY, effectiveFloor !== null);
    this.resolvePlatformTopCollision(prevBottom);
    this.resolveSolidPlatformHeadCollision(prevTop);
    this.resolvePlatformSideCollision(prevLeft, prevRight);
    this.resolveGapWallCollision(prevLeft, prevRight);

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
    if (player.onGround || player.vel.y >= 0) {
      this.canCutCurrentJump = false;
    }

    this.updateDisappearingPlatforms(dt);
    this.updateAiModifiers(dt);

    if (this.levelIndex > 0) {
      const runsWithCurrent = this.collectRunsWithCurrent();
      const knowledge = calculateKnowledge(runsWithCurrent, this.playerModel);
      const runtimeTrap = updateRealtimeTraps({
        obstacles: level.obstacles,
        player: {
          x: player.pos.x,
          y: player.pos.y,
          width: player.width,
          height: player.height,
          velX: player.vel.x,
          velY: player.vel.y,
          onGround: player.onGround,
          isCrouching: player.isCrouching,
        },
        playerModel: this.playerModel,
        knowledge,
        recentRuns: runsWithCurrent,
        levelIndex: this.levelIndex,
        groundY: level.groundY,
        dt,
      });
      const persistedLastMutation =
        runtimeTrap.debug.lastMutation !== 'none'
          ? runtimeTrap.debug.lastMutation
          : this.trapRuntimeDebug.lastMutation;
      this.routeMutationTotals.lower += runtimeTrap.debug.mutationCountsByRoute.lower;
      this.routeMutationTotals.mid += runtimeTrap.debug.mutationCountsByRoute.mid;
      this.routeMutationTotals.upper += runtimeTrap.debug.mutationCountsByRoute.upper;
      this.trapRuntimeDebug = {
        ...runtimeTrap.debug,
        lastMutation: persistedLastMutation,
        mutationCountsByRoute: { ...this.routeMutationTotals },
      };
      this.debugPanel.setRealtimeTrapDebug(this.trapRuntimeDebug);
      if (
        runtimeTrap.mutations.length > 0 &&
        this.levelAgeSec - this.lastTrapMessageAt >= TRAP_MESSAGE_COOLDOWN_SECS
      ) {
        this.lastTrapMessageAt = this.levelAgeSec;
        this.showAIMessage(runtimeTrap.mutations[0].message);
      }
      for (const mutation of runtimeTrap.mutations) {
        this.audio.playTrapCue(mutation.trapType);
      }
    } else {
      // Level 1 is pure baseline observation: no runtime trap mutations.
      this.trapRuntimeDebug = {
        ...this.trapRuntimeDebug,
        phase: 'observe',
        activeTrap: 'none',
        trapState: 'none',
        activeRoute: 'none',
        trapReason: 'Learning baseline behavior on Level 1',
      };
      this.debugPanel.setRealtimeTrapDebug(this.trapRuntimeDebug);
    }

    // Persist for next frame — must happen after physics, before early returns
    this.wasOnGround = player.onGround;

    // --- Choice obstacle decision tracking ---
    for (const obs of level.obstacles) {
      if (obs.kind !== 'choiceObstacle') continue;
      const obsX = obs.currentX ?? obs.x;
      const obsWidth = obs.currentWidth ?? obs.width;
      const obsHeight = obs.currentHeight ?? obs.height;
      const obsId = obs.trapGroupId ?? `choice_${Math.round(obsX)}_${Math.round(obsWidth)}`;
      if (this.observedChoices.has(obsId)) continue;

      const playerFront = player.pos.x + player.width;
      const playerTop = player.pos.y;
      const playerBottom = playerTop + player.height;
      const barBottom = level.groundY - obsHeight;
      const barTop = barBottom - CHOICE_BAR_THICKNESS;

      // Check if player is currently within the choice obstacle zone
      const inZone = playerFront > obsX && player.pos.x < obsX + obsWidth;
      const hasPassed = player.pos.x > obsX + obsWidth;

      if (inZone) {
        const state = this.choicePassState.get(obsId) ?? { airborne: false, crouching: false };
        if (!player.onGround || playerBottom < barTop) {
          state.airborne = true;
        }
        if (player.isCrouching && playerTop >= barBottom - 1) {
          state.crouching = true;
        }
        this.choicePassState.set(obsId, state);
      }

      if (!hasPassed) continue;

      const state = this.choicePassState.get(obsId) ?? { airborne: false, crouching: false };
      let decision: 'jump' | 'crouch' | null = null;
      if (state.airborne && !state.crouching) {
        decision = 'jump';
      } else if (state.crouching && !state.airborne) {
        decision = 'crouch';
      } else if (state.airborne && state.crouching) {
        decision = playerBottom < barTop ? 'jump' : 'crouch';
      } else {
        const recentActions = tracker.getCurrentRun()?.actions.slice(-4) ?? [];
        const hadJump = recentActions.some((a) => a.action === 'jump' && a.x >= obsX - 70 && a.x <= obsX + obsWidth + 16);
        const hadCrouch = recentActions.some((a) => a.action === 'crouchStart' && a.x >= obsX - 70 && a.x <= obsX + obsWidth + 16);
        if (hadJump && !hadCrouch) decision = 'jump';
        else if (hadCrouch && !hadJump) decision = 'crouch';
      }

      if (decision) {
        const event: ChoiceDecisionEvent = {
          obstacleId: obsId,
          obstacleType: obs.trapType ?? 'adaptiveChoiceGate',
          obstacleKind: obs.kind,
          x: obsX,
          chosenAction: decision,
          levelIndex: this.levelIndex,
          timeMs: this.levelAgeSec * 1000,
          success: true,
        };
        tracker.recordChoiceDecision(event);
        this.observedChoices.add(obsId);
      } else {
        // Player passed without a clear decision (might have been hit)
        this.observedChoices.add(obsId);
      }
      this.choicePassState.delete(obsId);
    }

    this.trackObstacleInteractions();

    // --- Position samples at fixed interval (not every frame) ---
    this.sampleTimer += dt;
    if (this.sampleTimer >= SAMPLE_INTERVAL) {
      tracker.recordSample(player.pos.x, player.pos.y);
      this.trackRouteBehavior();
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
    if (this.hitSpike() || this.hitPlatformNeedle()) {
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
      this.tracker.recordRouteChoice({
        routeId: this.detectRouteFromPlayer(),
        x: player.pos.x,
        levelIndex: this.levelIndex,
        timeMs: this.levelAgeSec * 1000,
        success: true,
      });
      this.publishStrategyBrief('levelComplete');
      tracker.finishRun(true);
      this.refreshPlayerModel();
      this.debugPanel.setPlayerModel(this.playerModel);
      this.audio.playLevelComplete();
      this.audio.stopMusic();
      this.state = 'levelComplete';
    }
  }

  // Returns the top floor currently supporting the player's footprint.
  // Uses full body overlap so edge contact behaves exactly like visuals.
  private getEffectiveFloor(
    playerLeft: number,
    playerRight: number,
    playerBottom: number,
    verticalVelocity: number,
  ): number | null {
    const gaps = this.level.obstacles.filter((o) => o.kind === 'gap');
    // Skip spent collapsing, invisible disappearing, and dropping/invisible AI-modifier platforms
    const platforms = this.level.obstacles.filter(
      (o) =>
        o.kind === 'platform' &&
        !(o.trapType === 'collapsingPlatform' && o.trapState === 'spent') &&
        o.disappearState !== 'invisible' &&
        !(o.aiModifier === 'droppingPlatform' && (o.aiModState === 'dropping' || o.aiModState === 'invisible')) &&
        !(o.aiModifier === 'temporaryBlocker' && o.aiModState === 'active'),
    );
    const overlapWidth = (obs: Obstacle): number => {
      const ox = obs.currentX ?? obs.x;
      const ow = obs.currentWidth ?? obs.width;
      const left = Math.max(playerLeft, ox);
      const right = Math.min(playerRight, ox + ow);
      return Math.max(0, right - left);
    };

    const footprintWidth = Math.max(0, playerRight - playerLeft);
    let totalGapOverlap = 0;
    for (const g of gaps) {
      totalGapOverlap += overlapWidth(g);
    }
    // Clamp in case overlaps ever stack.
    totalGapOverlap = Math.min(totalGapOverlap, footprintWidth);
    const groundSupport = footprintWidth - totalGapOverlap;
    const canRecoverGround = playerBottom <= this.level.groundY + GROUND_RECOVERY_TOLERANCE;
    // Do not "snap back" to ground after falling too deep into a gap.
    let floor: number | null =
      groundSupport >= MIN_SUPPORT_WIDTH && canRecoverGround
        ? this.level.groundY
        : null;

    for (const p of platforms) {
      const platformSupport = overlapWidth(p);
      if (platformSupport < MIN_SUPPORT_WIDTH) continue;
      const platformTop = this.level.groundY - (p.currentHeight ?? p.height);
      const canStandOnPlatform =
        verticalVelocity >= 0 && playerBottom <= platformTop + PLATFORM_SNAP_TOLERANCE;
      if (!canStandOnPlatform) continue;
      if (floor === null || platformTop < floor) {
        floor = platformTop;
      }
    }
    return floor;
  }

  private hitSpike(): boolean {
    const pl = this.player.pos.x;
    const pr = pl + this.player.width;
    const pb = this.player.pos.y + this.player.height;
    const INSET = 4;
    const groundY = this.level.groundY;

    return this.level.obstacles
      .filter(o => o.kind === 'spike' || o.kind === 'doubleSpike')
      .some(s => {
        const sx = s.currentX ?? s.x;
        const sw = s.currentWidth ?? s.width;
        // For animated modifiers use visual height; if 0 (retracted) → no collision
        const sh = s.aiModifier ? (s.aiModVisualHeight ?? 0) : (s.currentHeight ?? s.height);
        if (sh < 4) return false;
        const tipY = groundY - sh;

        if (pb <= tipY) return false;
        const t = Math.min(1, (pb - tipY) / sh);

        if (s.kind === 'spike') {
          const tipX = sx + sw / 2;
          const halfW = (sw / 2) * t;
          return pr - INSET > tipX - halfW && pl + INSET < tipX + halfW;
        }
        // doubleSpike: two sub-spikes separated by gap
        const DOUBLE_SPIKE_GAP = 16;
        const spikeW = (sw - DOUBLE_SPIKE_GAP) / 2;
        for (let i = 0; i < 2; i++) {
          const left = sx + i * (spikeW + DOUBLE_SPIKE_GAP);
          const tipX = left + spikeW / 2;
          const halfW = (spikeW / 2) * t;
          if (pr - INSET > tipX - halfW && pl + INSET < tipX + halfW) return true;
        }
        return false;
      });
  }

  private hitChoiceObstacle(): boolean {
    const px = this.player.pos.x;
    const pr = px + this.player.width;
    const playerTop = this.player.pos.y;
    const playerBottom = playerTop + this.player.height;
    const isCrouching = this.player.isCrouching;

    return this.level.obstacles
      .filter(o => o.kind === 'choiceObstacle')
      .some(c => {
        const cx = c.currentX ?? c.x;
        const cw = c.currentWidth ?? c.width;
        const ch = c.currentHeight ?? c.height;
        const barBottom = this.level.groundY - ch;

        // Jump counter: spike extension grows upward from barTop.
        const spikeExt = (c.trapType === 'adaptiveChoiceGateJump')
          ? (c.currentSpikeExt ?? 0)
          : 0;
        const barTop = barBottom - CHOICE_BAR_THICKNESS - spikeExt;

        const xOverlap = pr > cx && px < cx + cw;

        // Crouch counter (bar drops to floor): crouching players are NOT safe — must jump.
        const crouchCounterTriggered =
          c.trapType === 'adaptiveChoiceGateCrouch' &&
          (c.trapState === 'triggered' || c.trapState === 'spent') &&
          ch <= 6;
        if (isCrouching && !crouchCounterTriggered) return false;

        const yOverlap = playerBottom > barTop && playerTop < barBottom;
        return xOverlap && yOverlap;
      });
  }

  private hitPlatformNeedle(): boolean {
    const pl = this.player.pos.x;
    const pr = pl + this.player.width;
    const playerTop = this.player.pos.y;
    const playerBottom = playerTop + this.player.height;
    const INSET = 4;
    // Must match drawJumpBlockerSpikes geometry exactly
    const SPIKE_W = 14;
    const PITCH  = 20;
    const EDGE_PAD = 8;

    return this.level.obstacles
      .filter((o) => o.kind === 'platform' && o.trapType === 'platformNeedle')
      .some((p) => {
        const ext = p.currentSpikeExt ?? 0;
        if (ext <= 1) return false;
        const ox = p.currentX ?? p.x;
        const ow = p.currentWidth ?? p.width;
        const platformTop = this.level.groundY - (p.currentHeight ?? p.height);
        const spikeTop = platformTop - ext;
        const baseY = platformTop;

        // Player fully above tip or fully below base → no hit
        if (playerBottom <= spikeTop || playerTop >= baseY) return false;

        // Build the same spike layout as the renderer
        const spikeCount = Math.max(1, Math.floor((ow - EDGE_PAD * 2 + (PITCH - SPIKE_W)) / PITCH));
        const totalW = (spikeCount - 1) * PITCH + SPIKE_W;
        const startX = ox + (ow - totalW) / 2;

        // t = how far player's feet penetrate from tip toward base (0 = tip, 1 = base)
        const pb = Math.min(playerBottom, baseY);
        const t = Math.min(1, (pb - spikeTop) / ext);

        for (let i = 0; i < spikeCount; i++) {
          const tipX = startX + i * PITCH + SPIKE_W / 2;
          const halfW = (SPIKE_W / 2) * t;
          if (pr - INSET > tipX - halfW && pl + INSET < tipX + halfW) return true;
        }
        return false;
      });
  }

  private hitLowCeiling(): boolean {
    const ceilings = this.level.obstacles.filter(
      (o): o is Obstacle & { kind: 'lowCeiling' } => o.kind === 'lowCeiling'
    );
    const px = this.player.pos.x;
    const pr = px + this.player.width;
    const playerTop = this.player.pos.y;
    const playerBottom = playerTop + this.player.height;

    return ceilings.some((c) => {
      const cx = c.currentX ?? c.x;
      const cw = c.currentWidth ?? c.width;
      const ch = c.currentHeight ?? c.height;
      const slabTop = this.level.groundY - ch - LOW_CEILING_THICKNESS;
      const slabBottom = this.level.groundY - ch;

      const xOverlap = pr > cx && px < cx + cw;
      const yOverlap = playerBottom > slabTop && playerTop < slabBottom;
      return xOverlap && yOverlap;
    });
  }

  private resolveSolidPlatformHeadCollision(prevTop: number) {
    if (this.player.vel.y >= 0) return;

    const curTop = this.player.pos.y;
    const playerLeft = this.player.pos.x + SUPPORT_EDGE_INSET;
    const playerRight = this.player.pos.x + this.player.width - SUPPORT_EDGE_INSET;

    for (const o of this.level.obstacles) {
      if (o.kind !== 'platform' || !o.solid) continue;
      if (o.trapType === 'collapsingPlatform' && o.trapState === 'spent') continue;
      if (o.disappearState === 'invisible') continue;
      if (o.aiModifier === 'droppingPlatform' && (o.aiModState === 'dropping' || o.aiModState === 'invisible')) continue;
      if (o.aiModifier === 'temporaryBlocker' && o.aiModState === 'active') continue;

      const ox = o.currentX ?? o.x;
      const ow = o.currentWidth ?? o.width;
      const oh = o.currentHeight ?? o.height;
      const platformTop = this.level.groundY - oh;
      const platformBottom = platformTop + 16;

      const xOverlap = playerRight > ox && playerLeft < ox + ow;
      if (!xOverlap) continue;

      const crossedUnderside = prevTop >= platformBottom && curTop < platformBottom;
      if (!crossedUnderside) continue;

      this.player.pos.y = platformBottom;
      this.player.vel.y = 0;
      break;
    }
  }

  private resolvePlatformTopCollision(prevBottom: number) {
    if (this.player.vel.y < 0) return;

    const curBottom = this.player.pos.y + this.player.height;
    const playerLeft = this.player.pos.x + SUPPORT_EDGE_INSET;
    const playerRight = this.player.pos.x + this.player.width - SUPPORT_EDGE_INSET;

    for (const o of this.level.obstacles) {
      if (o.kind !== 'platform') continue;
      if (o.trapType === 'collapsingPlatform' && o.trapState === 'spent') continue;
      if (o.disappearState === 'invisible') continue;
      if (o.aiModifier === 'droppingPlatform' && (o.aiModState === 'dropping' || o.aiModState === 'invisible')) continue;
      if (o.aiModifier === 'temporaryBlocker' && o.aiModState === 'active') continue;

      const ox = o.currentX ?? o.x;
      const ow = o.currentWidth ?? o.width;
      const oh = o.currentHeight ?? o.height;
      const platformTop = this.level.groundY - oh;

      const xOverlap = playerRight > ox && playerLeft < ox + ow;
      if (!xOverlap) continue;

      const crossedTop =
        prevBottom <= platformTop + PLATFORM_SNAP_TOLERANCE &&
        curBottom >= platformTop;
      if (!crossedTop) continue;

      this.player.pos.y = platformTop - this.player.height;
      this.player.vel.y = 0;
      this.player.onGround = true;
      break;
    }
  }

  private resolvePlatformSideCollision(prevLeft: number, prevRight: number) {
    const curLeft = this.player.pos.x + SUPPORT_EDGE_INSET;
    const curRight = this.player.pos.x + this.player.width - SUPPORT_EDGE_INSET;
    const playerTop = this.player.pos.y;
    const playerBottom = playerTop + this.player.height;

    for (const o of this.level.obstacles) {
      if (o.kind !== 'platform') continue;
      if (o.trapType === 'collapsingPlatform' && o.trapState === 'spent') continue;
      if (o.disappearState === 'invisible') continue;
      if (o.aiModifier === 'droppingPlatform' && (o.aiModState === 'dropping' || o.aiModState === 'invisible')) continue;
      if (o.aiModifier === 'temporaryBlocker' && o.aiModState === 'active') continue;

      const ox = o.currentX ?? o.x;
      const ow = o.currentWidth ?? o.width;
      const oh = o.currentHeight ?? o.height;
      const platformTop = this.level.groundY - oh;
      const platformBottom = platformTop + 16;
      const yOverlap = playerBottom > platformTop + 1 && playerTop < platformBottom - 1;
      if (!yOverlap) continue;

      const crossedLeftFace = prevRight <= ox && curRight > ox;
      if (crossedLeftFace) {
        this.player.pos.x = ox - this.player.width + SUPPORT_EDGE_INSET;
        return;
      }

      const platformRight = ox + ow;
      const crossedRightFace = prevLeft >= platformRight && curLeft < platformRight;
      if (crossedRightFace) {
        this.player.pos.x = platformRight - SUPPORT_EDGE_INSET;
        return;
      }
    }
  }

  private resolveGapWallCollision(prevLeft: number, prevRight: number) {
    const curLeft = this.player.pos.x + SUPPORT_EDGE_INSET;
    const curRight = this.player.pos.x + this.player.width - SUPPORT_EDGE_INSET;
    const playerBottom = this.player.pos.y + this.player.height;

    // Gap walls exist from groundY downward.
    if (playerBottom <= this.level.groundY - 1) return;

    for (const o of this.level.obstacles) {
      if (o.kind !== 'gap') continue;
      const gapLeft = o.currentX ?? o.x;
      const gapRight = gapLeft + (o.currentWidth ?? o.width);

      // Crossing into the right wall from inside the gap.
      const crossedRightWall = prevRight <= gapRight && curRight > gapRight;
      if (crossedRightWall) {
        this.player.pos.x = gapRight - this.player.width + SUPPORT_EDGE_INSET;
        return;
      }

      // Crossing into the left wall from inside the gap.
      const crossedLeftWall = prevLeft >= gapLeft && curLeft < gapLeft;
      if (crossedLeftWall) {
        this.player.pos.x = gapLeft - SUPPORT_EDGE_INSET;
        return;
      }
    }
  }

  private updateDisappearingPlatforms(dt: number): void {
    const { player, level } = this;
    for (const p of level.obstacles) {
      if (p.kind !== 'platform' || p.disappearMode === undefined) continue;

      const state = p.disappearState ?? 'visible';

      if (state === 'visible') {
        if (p.disappearMode === 'onTouch') {
          const onIt = isPlayerOnPlatform(p, player.pos.x, player.pos.y, player.width, player.height, level.groundY);
          if (onIt) {
            p.disappearState = 'disappearing';
            p.disappearTimer = 0;
            p.disappearCount = (p.disappearCount ?? 0) + 1;
          }
        } else if (p.disappearMode === 'timed') {
          p.disappearTimer = (p.disappearTimer ?? 0) + dt * 1000;
          const period = p.disappearDelayMs ?? 2000;
          if ((p.disappearTimer ?? 0) >= period) {
            p.disappearState = 'disappearing';
            p.disappearTimer = 0;
            p.disappearCount = (p.disappearCount ?? 0) + 1;
          }
        } else if (p.disappearMode === 'afterDelay') {
          p.disappearTimer = (p.disappearTimer ?? 0) + dt * 1000;
          const delay = p.disappearDelayMs ?? 3000;
          if ((p.disappearTimer ?? 0) >= delay) {
            p.disappearState = 'disappearing';
            p.disappearTimer = 0;
            p.disappearCount = (p.disappearCount ?? 0) + 1;
          }
        }
      } else if (state === 'disappearing') {
        p.disappearTimer = (p.disappearTimer ?? 0) + dt * 1000;
        if ((p.disappearTimer ?? 0) >= DISAPPEAR_FLICKER_MS) {
          p.disappearState = 'invisible';
          p.disappearTimer = 0;
        }
      } else if (state === 'invisible') {
        const maxCount = p.maxDisappearCount;
        if (maxCount !== null && maxCount !== undefined && (p.disappearCount ?? 0) >= maxCount) {
          continue; // stay invisible permanently
        }
        p.disappearTimer = (p.disappearTimer ?? 0) + dt * 1000;
        const reappearDelay = p.reappearDelayMs ?? DISAPPEAR_INVISIBLE_MS;
        if ((p.disappearTimer ?? 0) >= reappearDelay) {
          p.disappearState = 'reappearing';
          p.disappearTimer = 0;
        }
      } else if (state === 'reappearing') {
        p.disappearTimer = (p.disappearTimer ?? 0) + dt * 1000;
        if ((p.disappearTimer ?? 0) >= DISAPPEAR_REAPPEAR_MS) {
          p.disappearState = 'visible';
          p.disappearTimer = 0;
        }
      }
    }
  }

  private updateAiModifiers(dt: number): void {
    const dtMs = dt * 1000;
    for (const o of this.level.obstacles) {
      if (!o.aiModifier) continue;
      o.aiModTimer = (o.aiModTimer ?? 0) + dtMs;
      const t = o.aiModTimer;

      switch (o.aiModifier) {
        case 'risingSpike': {
          const fullH = o.height;
          if (o.aiModState === 'inactive') {
            o.aiModVisualHeight = 0;
            if (t >= RISING_INACTIVE_MS) { o.aiModState = 'warning'; o.aiModTimer = 0; }
          } else if (o.aiModState === 'warning') {
            o.aiModVisualHeight = 0;
            if (t >= RISING_WARNING_MS) { o.aiModState = 'rising'; o.aiModTimer = 0; }
          } else if (o.aiModState === 'rising') {
            o.aiModVisualHeight = fullH * Math.min(1, t / RISING_RISE_MS);
            if (t >= RISING_RISE_MS) { o.aiModState = 'hold'; o.aiModTimer = 0; o.aiModVisualHeight = fullH; }
          } else if (o.aiModState === 'hold') {
            o.aiModVisualHeight = fullH;
            if (t >= RISING_HOLD_MS) { o.aiModState = 'retracting'; o.aiModTimer = 0; }
          } else if (o.aiModState === 'retracting') {
            o.aiModVisualHeight = fullH * Math.max(0, 1 - t / RISING_RETRACT_MS);
            if (t >= RISING_RETRACT_MS) { o.aiModState = 'inactive'; o.aiModTimer = 0; o.aiModVisualHeight = 0; }
          }
          break;
        }

        case 'pulsingSpike': {
          const fullH = o.height;
          if (o.aiModState === 'active') {
            o.aiModVisualHeight = fullH;
            if (t >= PULSE_ACTIVE_MS) { o.aiModState = 'retracting'; o.aiModTimer = 0; }
          } else if (o.aiModState === 'retracting') {
            o.aiModVisualHeight = fullH * Math.max(0, 1 - t / PULSE_RETRACT_MS);
            if (t >= PULSE_RETRACT_MS) { o.aiModState = 'inactive'; o.aiModTimer = 0; o.aiModVisualHeight = 0; }
          } else if (o.aiModState === 'inactive') {
            o.aiModVisualHeight = 0;
            if (t >= PULSE_INACTIVE_MS) { o.aiModState = 'rising'; o.aiModTimer = 0; }
          } else if (o.aiModState === 'rising') {
            o.aiModVisualHeight = fullH * Math.min(1, t / PULSE_RISE_MS);
            if (t >= PULSE_RISE_MS) { o.aiModState = 'active'; o.aiModTimer = 0; o.aiModVisualHeight = fullH; }
          }
          break;
        }

        case 'droppingPlatform': {
          if (o.aiModState === 'inactive') {
            // Trigger when player stands on it
            const onIt = isPlayerOnPlatform(o, this.player.pos.x, this.player.pos.y, this.player.width, this.player.height, this.level.groundY);
            if (onIt) { o.aiModState = 'warning'; o.aiModTimer = 0; }
          } else if (o.aiModState === 'warning') {
            // Shake handled in renderer via timer
            if (t >= DROP_WARNING_MS) { o.aiModState = 'dropping'; o.aiModTimer = 0; o.aiModDropOffset = 0; }
          } else if (o.aiModState === 'dropping') {
            const fallSpeed = (o.height + 120) / (DROP_FALL_MS / 1000);
            o.aiModDropOffset = (o.aiModDropOffset ?? 0) + fallSpeed * dt;
            if (t >= DROP_FALL_MS) { o.aiModState = 'invisible'; o.aiModTimer = 0; }
          } else if (o.aiModState === 'invisible') {
            if (t >= DROP_INVISIBLE_MS) { o.aiModState = 'spawning'; o.aiModTimer = 0; o.aiModDropOffset = o.height + 120; }
          } else if (o.aiModState === 'spawning') {
            const fullOff = o.height + 120;
            o.aiModDropOffset = fullOff * Math.max(0, 1 - t / DROP_SPAWN_MS);
            if (t >= DROP_SPAWN_MS) { o.aiModState = 'inactive'; o.aiModTimer = 0; o.aiModDropOffset = 0; }
          }
          break;
        }

        case 'temporaryBlocker': {
          if (o.aiModState === 'inactive') {
            if (t >= BLOCKER_INACTIVE_MS) { o.aiModState = 'warning'; o.aiModTimer = 0; }
          } else if (o.aiModState === 'warning') {
            if (t >= BLOCKER_WARNING_MS) { o.aiModState = 'active'; o.aiModTimer = 0; }
          } else if (o.aiModState === 'active') {
            if (t >= BLOCKER_ACTIVE_MS) { o.aiModState = 'retracting'; o.aiModTimer = 0; }
          } else if (o.aiModState === 'retracting') {
            if (t >= BLOCKER_RETRACT_MS) { o.aiModState = 'inactive'; o.aiModTimer = 0; }
          }
          break;
        }
      }
    }
  }

  private triggerDeath(reason: 'spike' | 'gap', deathX: number) {
    this.recordDeathObstacleInteraction(deathX);
    this.tracker.recordRouteChoice({
      routeId: this.detectRouteFromPlayer(),
      x: deathX,
      levelIndex: this.levelIndex,
      timeMs: this.levelAgeSec * 1000,
      success: false,
    });
    this.publishStrategyBrief('death', { reason, x: deathX });
    this.tracker.finishRun(false, reason, deathX);
    this.refreshPlayerModel();
    this.debugPanel.setPlayerModel(this.playerModel);
    this.audio.playDeath();
    this.audio.stopMusic();
    this.state = 'dead';
    this.deathTimer = 0;
  }

  private trackObstacleInteractions(): void {
    const playerLeft = this.player.pos.x;
    for (const obs of this.level.obstacles) {
      const obsX = obs.currentX ?? obs.x;
      const obsWidth = obs.currentWidth ?? obs.width;
      if (playerLeft <= obsX + obsWidth + 20) continue;

      const obstacleId = this.obstacleInteractionId(obs);
      if (this.observedObstacleInteractions.has(obstacleId)) continue;

      this.tracker.recordObstacleInteraction(this.buildObstacleInteraction(obs, 'passed'));
      this.observedObstacleInteractions.add(obstacleId);
    }
  }

  private recordDeathObstacleInteraction(deathX: number): void {
    const target = this.level.obstacles
      .filter((obs) => Math.abs(((obs.currentX ?? obs.x) + (obs.currentWidth ?? obs.width) * 0.5) - deathX) <= 120)
      .sort((a, b) => {
        const ac = (a.currentX ?? a.x) + (a.currentWidth ?? a.width) * 0.5;
        const bc = (b.currentX ?? b.x) + (b.currentWidth ?? b.width) * 0.5;
        return Math.abs(ac - deathX) - Math.abs(bc - deathX);
      })[0];
    if (!target) return;

    const obstacleId = this.obstacleInteractionId(target);
    if (this.observedObstacleInteractions.has(obstacleId)) return;

    this.tracker.recordObstacleInteraction(this.buildObstacleInteraction(target, 'death'));
    this.observedObstacleInteractions.add(obstacleId);
  }

  private buildObstacleInteraction(obs: Obstacle, outcome: ObstacleInteractionEvent['outcome']): ObstacleInteractionEvent {
    const obsX = obs.currentX ?? obs.x;
    return {
      obstacleId: this.obstacleInteractionId(obs),
      obstacleKind: obs.kind,
      trapType: obs.trapType,
      routeLayer: obs.routeLayer,
      x: obsX,
      playerX: this.player.pos.x,
      playerY: this.player.pos.y,
      levelIndex: this.levelIndex,
      action: this.inferObstacleAction(obs),
      outcome,
      timeMs: this.levelAgeSec * 1000,
    };
  }

  private obstacleInteractionId(obs: Obstacle): string {
    if (obs.trapGroupId) return obs.trapGroupId;
    return `${obs.kind}_${Math.round(obs.x)}_${Math.round(obs.width)}`;
  }

  private inferObstacleAction(obs: Obstacle): ObstacleInteractionEvent['action'] {
    const obsX = obs.currentX ?? obs.x;
    const obsWidth = obs.currentWidth ?? obs.width;
    const recentActions = this.tracker.getCurrentRun()?.actions ?? [];
    const localActions = recentActions.filter((a) => a.x >= obsX - 95 && a.x <= obsX + obsWidth + 60);
    const jumped = localActions.some((a) => a.action === 'jump');
    const crouched = localActions.some((a) => a.action === 'crouchStart');
    if (jumped && crouched) return 'mixed';
    if (jumped) return 'jump';
    if (crouched) return 'crouch';
    return 'none';
  }

  private detectRouteFromPlayer(): RouteId {
    const playerBottom = this.player.pos.y + this.player.height;
    const heightAboveGround = this.level.groundY - playerBottom;
    if (heightAboveGround <= ROUTE_LOWER_MAX_HEIGHT) return 'lower';
    if (heightAboveGround <= ROUTE_MID_MAX_HEIGHT) return 'mid';
    return 'upper';
  }

  private trackRouteBehavior(): void {
    const route = this.detectRouteFromPlayer();
    this.tracker.recordRoutePresence(route);
    if (route === this.currentRoute) return;
    if (this.player.pos.x - this.lastRouteEventX < ROUTE_SWITCH_MIN_X_DELTA) return;

    this.currentRoute = route;
    this.lastRouteEventX = this.player.pos.x;
    this.tracker.recordRouteChoice({
      routeId: route,
      x: this.player.pos.x,
      levelIndex: this.levelIndex,
      timeMs: this.levelAgeSec * 1000,
      success: true,
    });
  }

  private publishStrategyBrief(
    phase: StrategistPhase,
    latestDeathOverride?: { reason?: 'spike' | 'gap'; x?: number },
  ) {
    const context = this.makeStrategistInput(phase, latestDeathOverride);
    const localBrief = createLocalStrategyBrief(context);
    this.applyStrategyBrief(localBrief, phase);

    const requestId = ++this.strategistRequestSeq;
    const expectedLevelIndex = this.levelIndex;
    const expectedState = this.state;

    void maybeFetchStrategyBrief(context).then((remote) => {
      if (!remote) return;
      if (requestId !== this.strategistRequestSeq) return;
      if (expectedLevelIndex !== this.levelIndex) return;
      if (phase === 'levelStart' && this.state !== expectedState) return;
      if (phase === 'levelComplete' && this.state !== 'playing' && this.state !== 'levelComplete') return;
      if (phase === 'death' && this.state !== 'playing' && this.state !== 'dead') return;
      this.applyStrategyBrief(remote, phase);
    });
  }

  private applyStrategyBrief(brief: StrategyBrief, phase: StrategistPhase) {
    this.debugPanel.setStrategyBrief(brief);
    if (phase === 'levelStart') {
      this.showAIMessage(brief.taunt);
      return;
    }
    if (phase === 'levelComplete') {
      this.showAIMessage(brief.nextPlan);
      return;
    }
    this.showAIMessage(brief.summary);
  }

  private makeStrategistInput(
    phase: StrategistPhase,
    latestDeathOverride?: { reason?: 'spike' | 'gap'; x?: number },
  ): StrategyBriefInput {
    const profile = this.tracker.getProfile();
    const allRuns = this.tracker.getAllRuns();
    const currentRun = this.tracker.getCurrentRun();
    const recentRuns = summarizeRecentRuns(currentRun ? [...allRuns, currentRun] : allRuns, 5);
    const latestFinished = allRuns[allRuns.length - 1];
    const latestDeath = latestDeathOverride ?? {
      reason: latestFinished?.deathReason,
      x: latestFinished?.deathX,
    };

    const liveLandingZones = currentRun?.landings.slice(-3).map((l) => l.x) ?? [];
    const latestLandingZones = liveLandingZones.length > 0
      ? liveLandingZones
      : profile.commonLandingZones.slice(0, 3);

    return {
      phase,
      levelNumber: this.levelIndex + 1,
      playerModel: this.playerModel,
      playerProfile: profile,
      recentRuns,
      aiDebug: this.level.aiDebug
        ? {
          strategy: this.level.aiDebug.strategy,
          difficulty: this.level.aiDebug.difficulty,
          variants: this.level.aiDebug.variants,
          density: this.level.aiDebug.density,
          patterns: this.level.aiDebug.patterns,
          counterTargets: this.level.aiDebug.counterTargets,
          adaptationReasons: this.level.aiDebug.adaptationReasons,
          aiPhase: this.level.aiDebug.aiPhase,
          predictedLandingX: this.level.aiDebug.predictedLandingX,
        }
        : undefined,
      latestDeath,
      latestLandingZones,
    };
  }

  private collectRunsWithCurrent() {
    const allRuns = this.tracker.getAllRuns();
    const currentRun = this.tracker.getCurrentRun();
    return currentRun ? [...allRuns, currentRun] : allRuns;
  }

  private showAIMessage(text: string) {
    this.aiMessage = text;
    this.aiMessageTimeLeft = AI_MESSAGE_SECS;
  }

  private draw() {
    this.renderer.drawBackground(this.cameraX);
    const obstaclePulse = this.level.index > 0
      ? Math.max(0, 1 - this.levelAgeSec / LEVEL_HIGHLIGHT_SECS)
      : 0;
    const showFlag = this.state !== 'menu' && this.state !== 'countdown';
    this.renderer.drawLevel(this.level, this.cameraX, obstaclePulse, showFlag);
    if (this.hasSpawnedPlayer) {
      this.renderer.drawPlayer(this.player, this.cameraX, this.state === 'dead');
    }
    if (this.state !== 'menu' && this.hasSpawnedPlayer) {
      this.renderer.drawHUD(
        this.player.pos.x,
        this.level.flagX,
        this.canvas.width,
        this.canvas.height,
        this.levelIndex + 1,
        this.attempts,
      );
    }

    if (this.state === 'dead') {
      this.renderer.drawDeathOverlay(this.canvas, this.deathTimer, DEATH_INPUT_DELAY);
    } else if (this.state === 'levelComplete') {
      this.renderer.drawLevelCompleteOverlay(this.canvas, this.levelIndex + 2);
    } else if (this.state === 'paused') {
      this.renderer.drawPausedOverlay(this.canvas);
    }

    if (this.state === 'countdown') {
      const count = Math.max(1, Math.ceil(this.countdownSec));
      const fadeAlpha = 0.25 + (this.countdownSec - Math.floor(this.countdownSec));
      this.renderer.drawCountdownOverlay(this.canvas, count, fadeAlpha);
    }

    if (this.aiMessageTimeLeft > 0) {
      const fade = Math.min(1, this.aiMessageTimeLeft / 0.4);
      this.renderer.drawAIGameMasterMessage(this.aiMessage, fade);
    }

    if (this.showHitboxes && this.hasSpawnedPlayer) {
      this.renderer.drawHitboxOverlay(
        this.level.obstacles,
        this.level.groundY,
        this.cameraX,
        this.player.pos.x,
        this.player.pos.y,
        this.player.width,
        this.player.height,
      );
    }

    this.debugPanel.update();
  }
}
