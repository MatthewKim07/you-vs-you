import { Player } from './player';
import { buildLevel, LevelData } from './level';
import { InputHandler } from './input';
import { Renderer } from './renderer';
import { RunTracker } from './runTracker';
import { DebugPanel } from './debugPanel';
import { GameState, Obstacle } from './types';
import { generateAdaptiveLevel } from './adaptiveGenerator';
import { introMessage } from './aiGameMaster';
import { PlayerModel, ChoiceDecisionEvent } from './telemetry';
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
import { updateRealtimeTraps, resetTrapHosts, RealtimeTrapDebug } from './aiTrapDirector';
import { calculateKnowledge } from './aiKnowledge';

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
const SUPPORT_EDGE_INSET = 2;     // use a tiny inset so visual edge contact still counts
const PLATFORM_SNAP_TOLERANCE = 10;

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
  private lastTrapMessageAt = Number.NEGATIVE_INFINITY;

  // Ground-state tracking for landing/airtime detection
  private wasOnGround = true; // previous frame's ground state, persisted across frames
  private airStartMs: number | null = null;
  private sampleTimer = 0;
  private canCutCurrentJump = false;
  // Choice obstacle tracking: which choice obs we've already recorded a decision for
  private observedChoices = new Set<string>();
  private choicePassState = new Map<string, { airborne: boolean; crouching: boolean }>();
  private trapRuntimeDebug: RealtimeTrapDebug = {
    phase: 'observe',
    activeTrap: 'none',
    trapState: 'none',
    predictedAction: 'unknown',
    predictedLandingX: undefined as number | undefined,
    trapReason: 'none',
    confidence: 0,
    lastMutation: 'none',
  };

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input = new InputHandler(canvas);
    this.tracker = new RunTracker();
    this.debugPanel = new DebugPanel(this.tracker);
    this.debugPanel.setPlayerModel(this.playerModel);
    this.setupResize();
    this.setupUi();
    this.enterMenu();
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
    this.syncUiVisibility();

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
    this.lastTrapMessageAt = Number.NEGATIVE_INFINITY;
    this.trapRuntimeDebug = {
      phase: 'observe',
      activeTrap: 'none',
      trapState: 'none',
      predictedAction: 'unknown',
      predictedLandingX: undefined,
      trapReason: 'none',
      confidence: 0,
      lastMutation: 'none',
    };
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
      this.enterMenu();
    });
    this.exitButton.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.controlBar.appendChild(this.pauseButton);
    this.controlBar.appendChild(this.exitButton);
    document.body.appendChild(this.controlBar);

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
    this.level.groundY = this.canvas.height - 80;
    this.cameraX = 0;
    this.levelAgeSec = 0;
    this.countdownSec = 0;
    this.aiMessage = '';
    this.aiMessageTimeLeft = 0;
    this.spawnPreviewPlayer();
    this.hasSpawnedPlayer = true;
    this.state = 'menu';
    this.debugPanel.setAdaptiveSnapshot(this.level);
    this.syncUiVisibility();
  }

  private startFromMenu() {
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
    this.pauseButton.textContent = this.state === 'paused' ? 'Resume' : 'II Pause';
    this.syncUiVisibility();
  }

  private syncUiVisibility() {
    const inMenu = this.state === 'menu';
    this.menuOverlay.style.display = inMenu ? 'flex' : 'none';
    this.controlBar.style.display = inMenu ? 'none' : 'flex';
    this.pauseButton.textContent = this.state === 'paused' ? 'Resume' : 'II Pause';
  }

  private buildMenuPreviewLevel(): LevelData {
    const pattern: Obstacle[] = [
      { kind: 'spike', x: 140, width: 44, height: 52 },
      { kind: 'lowCeiling', x: 310, width: 170, height: 34 },
      { kind: 'doubleSpike', x: 620, width: 104, height: 52 },
      { kind: 'choiceObstacle', x: 920, width: 100, height: 34 },
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
    const effectiveFloor = this.getEffectiveFloor(playerLeft, playerRight, playerBottom, player.vel.y);
    player.update(dt, effectiveFloor ?? this.level.groundY, effectiveFloor !== null);
    this.resolveSolidPlatformHeadCollision(prevTop);

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
        this.countdownSec = Math.max(0, this.countdownSec - dt);
        if (this.countdownSec <= 0) {
          this.state = 'playing';
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
      const didJump = player.jump();
      if (didJump) {
        this.canCutCurrentJump = true;
      }
      if (wasCrouching && !player.isCrouching) {
        tracker.recordAction('crouchEnd', player.pos.x);
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
    const effectiveFloor = this.getEffectiveFloor(playerLeft, playerRight, playerBottom, player.vel.y);
    player.update(dt, effectiveFloor ?? level.groundY, effectiveFloor !== null);
    this.resolveSolidPlatformHeadCollision(prevTop);

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
    this.trapRuntimeDebug = {
      ...runtimeTrap.debug,
      lastMutation: persistedLastMutation,
    };
    this.debugPanel.setRealtimeTrapDebug(this.trapRuntimeDebug);
    if (
      runtimeTrap.mutations.length > 0 &&
      this.levelAgeSec - this.lastTrapMessageAt >= TRAP_MESSAGE_COOLDOWN_SECS
    ) {
      this.lastTrapMessageAt = this.levelAgeSec;
      this.showAIMessage(runtimeTrap.mutations[0].message);
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
      this.publishStrategyBrief('levelComplete');
      tracker.finishRun(true);
      this.refreshPlayerModel();
      this.debugPanel.setPlayerModel(this.playerModel);
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
    // Task 5: Skip spent/triggered platforms (collapsing platform trap)
    const platforms = this.level.obstacles.filter(
      (o) =>
        o.kind === 'platform' &&
        !(o.trapType === 'collapsingPlatform' && o.trapState === 'spent'),
    );
    const overlapsX = (obs: Obstacle): boolean =>
      playerRight > (obs.currentX ?? obs.x) &&
      playerLeft < (obs.currentX ?? obs.x) + (obs.currentWidth ?? obs.width);

    const fullyInsideGap = gaps.some((g) => {
      const gx = g.currentX ?? g.x;
      const gw = g.currentWidth ?? g.width;
      return playerLeft >= gx && playerRight <= gx + gw;
    });
    let floor: number | null = fullyInsideGap ? null : this.level.groundY;

    for (const p of platforms) {
      if (!overlapsX(p)) continue;
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
    const px = this.player.pos.x;
    const pr = px + this.player.width;
    const pb = this.player.pos.y + this.player.height;
    const inset = 6;

    return this.level.obstacles
      .filter(o => o.kind === 'spike' || o.kind === 'doubleSpike')
      .some(s => {
        const sx = s.currentX ?? s.x;
        const sw = s.currentWidth ?? s.width;
        const sh = s.currentHeight ?? s.height;
        const spikeHitTop = this.level.groundY - sh + 12;
        return px + inset < sx + sw - inset && pr - inset > sx + inset && pb > spikeHitTop;
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
    const px = this.player.pos.x;
    const pr = px + this.player.width;
    const playerTop = this.player.pos.y;
    const playerBottom = playerTop + this.player.height;

    return this.level.obstacles
      .filter((o) => o.kind === 'platform' && o.trapType === 'platformNeedle')
      .some((p) => {
        const ext = p.currentSpikeExt ?? 0;
        if (ext <= 1) return false;
        const ox = p.currentX ?? p.x;
        const ow = p.currentWidth ?? p.width;
        const platformTop = this.level.groundY - (p.currentHeight ?? p.height);
        const spikeTop = platformTop - ext;
        const xOverlap = pr - 4 > ox + 2 && px + 4 < ox + ow - 2;
        const yOverlap = playerBottom > spikeTop && playerTop < platformTop;
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

  private triggerDeath(reason: 'spike' | 'gap', deathX: number) {
    this.publishStrategyBrief('death', { reason, x: deathX });
    this.tracker.finishRun(false, reason, deathX);
    this.refreshPlayerModel();
    this.debugPanel.setPlayerModel(this.playerModel);
    this.state = 'dead';
    this.deathTimer = 0;
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

    this.debugPanel.update();
  }
}
