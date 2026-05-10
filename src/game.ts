import { Player } from './player';
import { buildLevel, LevelData } from './level';
import { InputHandler } from './input';
import { Renderer } from './renderer';
import { Fireball } from './fireball';
import {
  resolvePhaseRelocation,
  PHASE_FX_DURATION,
  PHASE_DENY_FX_DURATION,
  type PhaseFxState,
  type PhaseDenyFxState,
  type PhaseDebugInfo,
} from './phase';
import { RunTracker } from './runTracker';
import { DebugPanel } from './debugPanel';
import { GameState, Obstacle } from './types';
import { generateAdaptiveLevel } from './adaptiveGenerator';
import { InfiniteGenerator } from './infiniteGenerator';
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
  PATROL_SPEED_DEFAULT,
  ELECTRIC_INACTIVE_MS, ELECTRIC_WARNING_MS, ELECTRIC_ACTIVE_MS,
  CRUSHER_RAISED_MS, CRUSHER_WARNING_MS, CRUSHER_CRUSHING_MS, CRUSHER_LOWERED_MS, CRUSHER_RAISING_MS,
  CRUSHER_LOWERED_H,
  CRUMBLE_WARNING_MS, CRUMBLE_FALL_MS, CRUMBLE_INVISIBLE_MS, CRUMBLE_SPAWN_MS,
  resetNewHazardKinds,
} from './levelMutator';
import { calculateKnowledge } from './aiKnowledge';
import { GameAudio } from './gameAudio';
import { AuthProgressClient, StoredProgress } from './authProgress';

const SPAWN_X = 80;
const DEATH_INPUT_DELAY = 0.4;  // seconds before tap-to-retry accepted after death
const TIME_WARP_DURATION = 4.0;      // seconds the effect lasts per activation
const TIME_WARP_SPEED_MULT = 0.65;   // physics dt multiplier while active
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
const COIN_STORAGE_KEY_BASE = 'you-vs-you-shop-v1';
const AUDIO_SETTINGS_STORAGE_KEY = 'you-vs-you-audio-v1';

type SkinId = 'classic' | 'ember' | 'forest' | 'void' | 'rainbow';
type PowerUpId = 'speedBoost' | 'doubleJump' | 'shield';
type AbilityId = 'fireball' | 'phase' | 'timeWarp';

interface ShopState {
  coins: number;
  ownedSkins: SkinId[];
  equippedSkin: SkinId;
  ownedPowerUps: PowerUpId[];
  activeBoosts: PowerUpId[];
  ownedAbilities: AbilityId[];
  equippedAbility: AbilityId | null;
}

const SKIN_CATALOG: Array<{ id: SkinId; label: string; cost: number; preview: string }> = [
  { id: 'ember', label: 'Ember Skin', cost: 75, preview: '🔥' },
  { id: 'forest', label: 'Forest Skin', cost: 140, preview: '🌿' },
  { id: 'void', label: 'Void Skin', cost: 220, preview: '🌌' },
  { id: 'rainbow', label: 'Rainbow Skin', cost: 400, preview: '🌈' },
];

const POWERUP_CATALOG: Array<{ id: PowerUpId; label: string; cost: number; description: string; preview: string }> = [
  { id: 'shield', label: 'Shield', cost: 100, description: 'Absorb one spike hit per level. Does not protect from falls.', preview: '🛡' },
  { id: 'speedBoost', label: 'Speed Core', cost: 180, description: 'Permanent +15% run speed.', preview: '⚡' },
  { id: 'doubleJump', label: 'Double Jump', cost: 200, description: 'Press jump again while airborne for a second leap.', preview: '🦅' },
];

const ABILITY_CATALOG: Array<{ id: AbilityId; label: string; cost: number; description: string; preview: string }> = [
  { id: 'fireball', label: 'Fire Ball', cost: 250, description: 'Shoot one fireball per life that destroys the first obstacle it hits.', preview: '🔥' },
  { id: 'phase', label: 'Phase', cost: 300, description: 'Teleport forward past the nearest obstacle directly in your path.', preview: '💨' },
  { id: 'timeWarp', label: 'Time Warp', cost: 350, description: 'Temporarily slow down movement for easier control.', preview: '⏳' },
];

const ABILITY_KEYBIND = 'E';

type ShopSection = 'hub' | 'looks' | 'boosts' | 'abilities' | 'inventory';
type MenuStackScreen = 'main' | 'auth' | 'settings' | 'shop' | 'modeSelect';
type GameMode = 'levels' | 'infinite';

function skinDisplayMeta(id: SkinId): { label: string; preview: string; subtitle: string } {
  if (id === 'classic') {
    return { label: 'Classic', preview: '🎮', subtitle: 'Default look' };
  }
  if (id === 'rainbow') {
    return { label: 'Rainbow Skin', preview: '🌈', subtitle: 'Animated rainbow' };
  }
  const row = SKIN_CATALOG.find((s) => s.id === id);
  if (row) return { label: row.label, preview: row.preview, subtitle: 'Skin' };
  return { label: id, preview: '❔', subtitle: 'Skin' };
}

/** 8×8 pixel coin for HUD + shop (crispEdges SVG). */
function pixelCoinSvg(cssClass: string): string {
  const face = '#ffd46e';
  const edge = '#b8860b';
  const hi = '#fff3c4';
  const cells: Array<[number, number, string]> = [
    [2, 0, edge], [3, 0, hi], [4, 0, hi], [5, 0, edge],
    [1, 1, edge], [2, 1, face], [3, 1, face], [4, 1, face], [5, 1, face], [6, 1, edge],
    [0, 2, edge], [1, 2, face], [6, 2, face], [7, 2, edge],
    [0, 3, edge], [1, 3, face], [6, 3, face], [7, 3, edge],
    [0, 4, edge], [1, 4, face], [6, 4, face], [7, 4, edge],
    [1, 5, edge], [2, 5, face], [3, 5, face], [4, 5, face], [5, 5, face], [6, 5, edge],
    [2, 6, edge], [3, 6, hi], [4, 6, hi], [5, 6, edge],
  ];
  const rects = cells
    .map(([x, y, c]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`)
    .join('');
  return `<svg class="${cssClass}" viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${rects}</svg>`;
}

function shopBuyButtonHtml(price: number): string {
  return `<span class="shop-buy-row"><span class="shop-buy-word">Buy</span><span class="shop-buy-price">${pixelCoinSvg('pixel-coin pixel-coin--btn')}<span class="shop-buy-amount">${price}</span></span></span>`;
}

export class Game {
  private player!: Player;
  private level!: LevelData;
  private input!: InputHandler;
  private renderer!: Renderer;
  private tracker: RunTracker;
  private debugPanel: DebugPanel;
  private state: GameState = 'menu';
  private preMenuState: GameState | null = null;
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
  private menuMainStack!: HTMLDivElement;
  private playButton!: HTMLButtonElement;
  private authToggleButton!: HTMLButtonElement;
  private settingsToggleButton!: HTMLButtonElement;
  private authPanel!: HTMLDivElement;
  private settingsPanel!: HTMLDivElement;
  private shopPanel!: HTMLDivElement;
  private authStatusLabel!: HTMLParagraphElement;
  private authEmailInput!: HTMLInputElement;
  private authPasswordInput!: HTMLInputElement;
  private authSignInButton!: HTMLButtonElement;
  private authSignUpButton!: HTMLButtonElement;
  private authSignOutButton!: HTMLButtonElement;
  private menuButton!: HTMLButtonElement;
  private mobileControls: HTMLDivElement | null = null;
  private deathTapZone: HTMLDivElement | null = null;
  private pauseMenu!: HTMLDivElement;
  private pauseSoundToggleButton!: HTMLButtonElement;
  private pauseResumeButton!: HTMLButtonElement;
  private pauseExitButton!: HTMLButtonElement;
  private pauseSfxSlider!: HTMLInputElement;
  private pauseMusicSlider!: HTMLInputElement;
  private menuSoundToggleButton!: HTMLButtonElement;
  private menuSfxSlider!: HTMLInputElement;
  private menuMusicSlider!: HTMLInputElement;
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

  // ── Infinite Mode ──────────────────────────────────────────────────────────
  private gameMode: GameMode = 'levels';
  private infiniteRunScore = 0;
  private infiniteBestScore = 0;
  private infiniteGen: InfiniteGenerator | null = null;
  private infiniteGameOverEl!: HTMLDivElement;
  private infiniteScoreEl!: HTMLSpanElement;
  private infiniteBestEl!: HTMLSpanElement;
  private modeSelectPanel!: HTMLDivElement;
  private static readonly INFINITE_BEST_KEY = 'you-vs-you-infinite-best-v1';
  // Throttle playerModel refreshes during infinite runs so the AI adapts to recent behavior.
  private infiniteModelRefreshTimer = 0;
  private static readonly INFINITE_MODEL_REFRESH_INTERVAL = 6; // seconds
  private audioMuted = false;
  private authClient = new AuthProgressClient();
  private authUserId: string | null = null;
  private highestLevelUnlocked = 1;
  private menuStackScreen: MenuStackScreen = 'main';
  private shopSection: ShopSection = 'hub';
  private shopNavButton!: HTMLButtonElement;
  private shopHeadingEl!: HTMLHeadingElement;
  private shopBodyEl!: HTMLDivElement;
  private shopToggleButton!: HTMLButtonElement;
  private shopStatusLabel!: HTMLParagraphElement;
  private coinHudBadge!: HTMLDivElement;
  private shopFeedbackMessage: string | null = null;
  private shopFeedbackKind: 'info' | 'error' = 'info';
  private coins = 0;
  private ownedSkins = new Set<SkinId>(['classic']);
  private equippedSkin: SkinId = 'classic';
  private ownedPowerUps = new Set<PowerUpId>();
  private activeBoosts = new Set<PowerUpId>();
  private ownedAbilities = new Set<AbilityId>();
  private equippedAbility: AbilityId | null = null;
  private abilityHudBadge!: HTMLDivElement;
  private consumedShield = false;
  private invincibleUntilMs: number | null = null;
  private fireball: Fireball | null = null;
  private fireballUsed = false;
  private phaseUsed = false;
  private phaseFx: PhaseFxState | null = null;
  private phaseDenyFx: PhaseDenyFxState | null = null;
  private timeWarpUsed = false;
  private timeWarpActive = false;
  private timeWarpTimeLeft = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input = new InputHandler(canvas);
    this.tracker = new RunTracker();
    this.debugPanel = new DebugPanel(this.tracker);
    this.debugPanel.setPlayerModel(this.playerModel);
    this.loadLocalShopState();
    this.loadAudioSettings();
    this.loadInfiniteBest();
    this.setupResize();
    this.setupUi();
    this.armAudioOnFirstGesture();
    this.enterMenu();
    void this.initializeAuth();
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
    const isMobile = navigator.maxTouchPoints > 0;
    // Use visualViewport so dimensions exclude browser chrome (toolbar, etc).
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const isLandscape = vw > vh;

    if (isMobile && isLandscape) {
      const GAME_H = 600;
      const scale = vh / GAME_H;
      this.canvas.height = GAME_H;
      this.canvas.width = Math.round(vw / scale);
      this.canvas.style.width = vw + 'px';
      this.canvas.style.height = vh + 'px';
      this.canvas.style.transform = '';
    } else {
      this.canvas.style.width = '';
      this.canvas.style.height = '';
      this.canvas.style.transform = '';
      this.canvas.width = vw;
      this.canvas.height = vh;
    }
  }

  private baseShopState(): ShopState {
    return {
      coins: 10000,
      ownedSkins: ['classic'],
      equippedSkin: 'classic',
      ownedPowerUps: [],
      activeBoosts: [],
      ownedAbilities: [],
      equippedAbility: null,
    };
  }

  private normalizeShopState(input: Partial<ShopState> | null | undefined): ShopState {
    const base = this.baseShopState();
    const ownedSkins = new Set<SkinId>(base.ownedSkins);
    for (const skin of input?.ownedSkins ?? []) {
      if (skin === 'classic' || SKIN_CATALOG.some((entry) => entry.id === skin)) {
        ownedSkins.add(skin);
      }
    }
    const ownedPowerUps = new Set<PowerUpId>();
    for (const power of input?.ownedPowerUps ?? []) {
      if (POWERUP_CATALOG.some((entry) => entry.id === power)) {
        ownedPowerUps.add(power);
      }
    }
    // activeBoosts defaults to all owned if not saved yet
    const savedActive = input?.activeBoosts;
    const activeBoosts = new Set<PowerUpId>();
    if (savedActive !== undefined) {
      for (const power of savedActive) {
        if (ownedPowerUps.has(power)) activeBoosts.add(power);
      }
    } else {
      ownedPowerUps.forEach((p) => activeBoosts.add(p));
    }
    const equippedSkin =
      input?.equippedSkin && ownedSkins.has(input.equippedSkin)
        ? input.equippedSkin
        : 'classic';
    const ownedAbilities = new Set<AbilityId>();
    for (const ab of input?.ownedAbilities ?? []) {
      if (ABILITY_CATALOG.some((entry) => entry.id === ab)) {
        ownedAbilities.add(ab);
      }
    }
    const rawEquipped = input?.equippedAbility ?? null;
    const equippedAbility: AbilityId | null =
      rawEquipped !== null && ownedAbilities.has(rawEquipped) ? rawEquipped : null;
    return {
      coins: Math.max(0, Math.floor(input?.coins ?? base.coins)),
      ownedSkins: Array.from(ownedSkins),
      equippedSkin,
      ownedPowerUps: Array.from(ownedPowerUps),
      activeBoosts: Array.from(activeBoosts),
      ownedAbilities: Array.from(ownedAbilities),
      equippedAbility,
    };
  }

  private applyShopState(state: ShopState) {
    this.coins = state.coins;
    this.ownedSkins = new Set(state.ownedSkins);
    this.equippedSkin = state.equippedSkin;
    this.ownedPowerUps = new Set(state.ownedPowerUps);
    this.activeBoosts = new Set(state.activeBoosts);
    this.ownedAbilities = new Set(state.ownedAbilities);
    this.equippedAbility = state.equippedAbility;
    this.updatePlayerSpeedFromPowerUps();
    this.updateCoinHudBadge();
    this.updateAbilityHudBadge();
  }

  private currentShopState(): ShopState {
    return this.normalizeShopState({
      coins: this.coins,
      ownedSkins: Array.from(this.ownedSkins),
      equippedSkin: this.equippedSkin,
      ownedPowerUps: Array.from(this.ownedPowerUps),
      activeBoosts: Array.from(this.activeBoosts),
      ownedAbilities: Array.from(this.ownedAbilities),
      equippedAbility: this.equippedAbility,
    });
  }

  private loadLocalShopState() {
    if (!this.authUserId) {
      this.applyShopState(this.baseShopState());
      return;
    }
    try {
      const raw = window.localStorage.getItem(this.shopStorageKey());
      if (!raw) {
        this.applyShopState(this.baseShopState());
        return;
      }
      const parsed = JSON.parse(raw) as Partial<ShopState>;
      this.applyShopState(this.normalizeShopState(parsed));
    } catch {
      this.applyShopState(this.baseShopState());
    }
  }

  private saveLocalShopState() {
    if (!this.authUserId) return;
    try {
      window.localStorage.setItem(this.shopStorageKey(), JSON.stringify(this.currentShopState()));
    } catch {
      // Ignore storage failures (private mode/storage quota).
    }
  }

  private shopStorageKey(): string {
    return `${COIN_STORAGE_KEY_BASE}:${this.authUserId ?? 'guest'}`;
  }

  private loadAudioSettings() {
    try {
      const raw = window.localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        muted?: unknown;
        sfx?: unknown;
        music?: unknown;
      };
      if (typeof parsed.muted === 'boolean') {
        this.audioMuted = parsed.muted;
        this.audio.setEnabled(!this.audioMuted);
      }
      if (typeof parsed.sfx === 'number' && Number.isFinite(parsed.sfx)) {
        this.audio.setSfxVolume(parsed.sfx);
      }
      if (typeof parsed.music === 'number' && Number.isFinite(parsed.music)) {
        this.audio.setMusicVolume(parsed.music);
      }
    } catch {
      // Ignore corrupt or missing storage.
    }
  }

  private persistAudioSettings() {
    try {
      window.localStorage.setItem(
        AUDIO_SETTINGS_STORAGE_KEY,
        JSON.stringify({
          muted: this.audioMuted,
          sfx: this.audio.getSfxVolume(),
          music: this.audio.getMusicVolume(),
        }),
      );
    } catch {
      // Private mode / quota: ignore.
    }
  }

  private updatePlayerSpeedFromPowerUps() {
    if (!this.player) return;
    const multiplier = this.activeBoosts.has('speedBoost') ? 1.15 : 1;
    this.player.setSpeedMultiplier(multiplier);
    this.player.hasDoubleJump = this.activeBoosts.has('doubleJump');
  }

  private updateCoinHudBadge() {
    if (!this.coinHudBadge) return;
    this.coinHudBadge.innerHTML = `<span class="coin-hud-inner">${pixelCoinSvg('pixel-coin pixel-coin--hud')}<span class="coin-hud-value">${this.coins}</span></span>`;
    this.coinHudBadge.setAttribute('aria-label', `Balance ${this.coins}`);
  }

  private updateAbilityHudBadge() {
    if (!this.abilityHudBadge) return;
    const isLevels = this.gameMode === 'levels';
    const inGame = this.state === 'playing' || this.state === 'countdown' || this.state === 'dead' || this.state === 'levelComplete';
    if (this.equippedAbility && isLevels && inGame) {
      const meta = ABILITY_CATALOG.find((a) => a.id === this.equippedAbility);
      const label = meta?.label ?? '';
      let statusClass: string;
      let statusText: string;
      if (this.equippedAbility === 'timeWarp') {
        if (this.timeWarpActive) {
          statusClass = 'ability-hud-status--active';
          statusText = `Active ${this.timeWarpTimeLeft.toFixed(1)}s`;
        } else if (this.timeWarpUsed) {
          statusClass = 'ability-hud-status--used';
          statusText = 'Used';
        } else {
          statusClass = 'ability-hud-status--ready';
          statusText = 'Ready';
        }
      } else {
        const used =
          (this.fireballUsed && this.equippedAbility === 'fireball') ||
          (this.phaseUsed && this.equippedAbility === 'phase');
        statusClass = used ? 'ability-hud-status--used' : 'ability-hud-status--ready';
        statusText = used ? 'Used' : 'Ready';
      }
      this.abilityHudBadge.innerHTML = `<span class="ability-hud-inner"><span class="ability-hud-key">[${ABILITY_KEYBIND}]</span><span class="ability-hud-name">${label}</span><span class="ability-hud-status ${statusClass}">${statusText}</span></span>`;
      this.abilityHudBadge.dataset.abilityState = statusClass.replace('ability-hud-status--', '');
      this.abilityHudBadge.style.display = 'flex';
    } else {
      this.abilityHudBadge.style.display = 'none';
    }
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
    this.consumedShield = false;
    this.invincibleUntilMs = null;
    this.fireball = null;
    this.fireballUsed = false;
    this.phaseUsed = false;
    this.phaseFx = null;
    this.phaseDenyFx = null;
    this.timeWarpUsed = false;
    this.timeWarpActive = false;
    this.timeWarpTimeLeft = 0;
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
    // Reset new hazard kind state machines (electricField, crusherCeiling).
    resetNewHazardKinds(this.level.obstacles);
    // Restore any obstacles destroyed by fireball — destruction is per-life only.
    for (const o of this.level.obstacles) o.fireballDestroyed = false;
    this.spawnPlayer();
    this.cameraX = 0;
    this.state = 'playing';
    this.invincibleUntilMs = null;
    this.fireball = null;
    this.fireballUsed = false;
    this.phaseUsed = false;
    this.phaseFx = null;
    this.phaseDenyFx = null;
    this.timeWarpUsed = false;
    this.timeWarpActive = false;
    this.timeWarpTimeLeft = 0;
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
    this.updatePlayerSpeedFromPowerUps();
    // Spawn starts grounded; prevents a false air→ground landing on first frame.
    this.player.onGround = true;
  }

  private setupResize() {
    const onResize = () => {
      this.resizeCanvas();
      this.updatePortraitOverlay();
      this.level.groundY = this.canvas.height - 80;
      if ((this.state === 'playing' || this.state === 'paused') && this.hasSpawnedPlayer) {
        this.player.pos.y = Math.min(this.player.pos.y, this.level.groundY - this.player.height);
      }
    };
    window.addEventListener('resize', onResize);
    // visualViewport fires when browser toolbar shows/hides (window resize doesn't).
    window.visualViewport?.addEventListener('resize', onResize);
  }

  private portraitOverlay: HTMLDivElement | null = null;

  private updatePortraitOverlay() {
    if (!this.portraitOverlay) return;
    const isMobile = navigator.maxTouchPoints > 0;
    const isPortrait = window.innerHeight > window.innerWidth;
    this.portraitOverlay.style.display = (isMobile && isPortrait) ? 'flex' : 'none';
  }

  private setupUi() {
    if (navigator.maxTouchPoints > 0) {
      this.portraitOverlay = document.createElement('div');
      this.portraitOverlay.id = 'portrait-overlay';
      this.portraitOverlay.innerHTML = '<div class="portrait-msg"><div class="portrait-icon">⟳</div><div>Rotate your device</div><div class="portrait-sub">This game plays best in landscape</div></div>';
      document.body.appendChild(this.portraitOverlay);
      this.updatePortraitOverlay();

      // Show "Add to Home Screen" prompt once if not already running as standalone PWA.
      const isStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
        || window.matchMedia('(display-mode: standalone)').matches;
      const dismissed = localStorage.getItem('a2hs-dismissed');
      if (!isStandalone && !dismissed) {
        const banner = document.createElement('div');
        banner.id = 'a2hs-banner';
        banner.innerHTML = `
          <span>Add to Home Screen for fullscreen</span>
          <button id="a2hs-dismiss">✕</button>
        `;
        document.body.appendChild(banner);
        document.getElementById('a2hs-dismiss')!.addEventListener('click', () => {
          banner.remove();
          localStorage.setItem('a2hs-dismissed', '1');
        });
      }
    }

    this.deathTapZone = document.createElement('div');
    this.deathTapZone.id = 'death-tap-zone';
    this.deathTapZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.pressJump();
    });
    document.body.appendChild(this.deathTapZone);

    this.menuButton = document.createElement('button');
    this.menuButton.id = 'menu-btn';
    this.menuButton.className = 'game-control-btn menu-fab';
    this.menuButton.textContent = '';
    this.menuButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePauseMenu();
    });
    this.menuButton.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(this.menuButton);

    if (navigator.maxTouchPoints > 0) {
      this.mobileControls = document.createElement('div');
      this.mobileControls.id = 'mobile-controls';

      const crouchBtn = document.createElement('button');
      crouchBtn.id = 'mobile-crouch-btn';
      crouchBtn.className = 'mobile-action-btn';
      crouchBtn.textContent = '▼';

      const jumpBtn = document.createElement('button');
      jumpBtn.id = 'mobile-jump-btn';
      jumpBtn.className = 'mobile-action-btn';
      jumpBtn.textContent = '▲';

      const bindBtn = (btn: HTMLButtonElement, onDown: () => void, onUp: () => void) => {
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onDown(); });
        btn.addEventListener('pointerup', (e) => { e.preventDefault(); e.stopPropagation(); onUp(); });
        btn.addEventListener('pointercancel', (e) => { e.preventDefault(); e.stopPropagation(); onUp(); });
        btn.addEventListener('pointerleave', (e) => { e.preventDefault(); e.stopPropagation(); onUp(); });
      };

      const abilityBtn = document.createElement('button');
      abilityBtn.id = 'mobile-ability-btn';
      abilityBtn.className = 'mobile-action-btn mobile-ability-btn';
      abilityBtn.textContent = '★';
      abilityBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.input.pressAbility(); });

      bindBtn(crouchBtn, () => this.input.pressCrouch(), () => this.input.releaseCrouch());
      bindBtn(jumpBtn, () => this.input.pressJump(), () => this.input.releaseJump());

      this.mobileControls.appendChild(abilityBtn);
      this.mobileControls.appendChild(crouchBtn);
      this.mobileControls.appendChild(jumpBtn);
      document.body.appendChild(this.mobileControls);
    }

    this.coinHudBadge = document.createElement('div');
    this.coinHudBadge.id = 'coin-hud-badge';
    document.body.appendChild(this.coinHudBadge);

    this.abilityHudBadge = document.createElement('div');
    this.abilityHudBadge.id = 'ability-hud-badge';
    this.abilityHudBadge.style.display = 'none';
    document.body.appendChild(this.abilityHudBadge);

    this.setupPauseMenuUi();

    this.menuOverlay = document.createElement('div');
    this.menuOverlay.id = 'start-menu';

    this.menuMainStack = document.createElement('div');
    this.menuMainStack.id = 'menu-main-stack';
    this.menuMainStack.className = 'menu-main-stack';

    const menuCard = document.createElement('div');
    menuCard.className = 'menu-card';
    menuCard.innerHTML = `
      <h1>You vs You</h1>
      <p>The level learns you.</p>
    `;
    this.menuMainStack.appendChild(menuCard);

    this.playButton = document.createElement('button');
    this.playButton.id = 'play-btn';
    this.playButton.textContent = 'Play';
    this.playButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.menuStackScreen = 'modeSelect';
      this.refreshAuthUi();
    });
    this.playButton.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.authToggleButton = document.createElement('button');
    this.authToggleButton.id = 'auth-toggle-btn';
    this.authToggleButton.className = 'menu-secondary-btn';
    this.authToggleButton.textContent = 'Log In';
    this.authToggleButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.menuStackScreen = 'auth';
      this.refreshAuthUi();
    });
    this.authToggleButton.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.settingsToggleButton = document.createElement('button');
    this.settingsToggleButton.id = 'settings-toggle-btn';
    this.settingsToggleButton.className = 'menu-secondary-btn';
    this.settingsToggleButton.textContent = 'Settings';
    this.settingsToggleButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.menuStackScreen = 'settings';
      this.refreshAuthUi();
    });
    this.settingsToggleButton.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.shopToggleButton = document.createElement('button');
    this.shopToggleButton.id = 'shop-toggle-btn';
    this.shopToggleButton.className = 'menu-secondary-btn';
    this.shopToggleButton.textContent = 'Shop';
    this.shopToggleButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.menuStackScreen = 'shop';
      this.shopSection = 'hub';
      this.refreshAuthUi();
    });
    this.shopToggleButton.addEventListener('pointerdown', (e) => e.stopPropagation());

    const menuActions = document.createElement('div');
    menuActions.className = 'menu-actions';
    menuActions.appendChild(this.playButton);
    menuActions.appendChild(this.authToggleButton);
    menuActions.appendChild(this.settingsToggleButton);
    menuActions.appendChild(this.shopToggleButton);
    this.menuMainStack.appendChild(menuActions);
    this.menuOverlay.appendChild(this.menuMainStack);

    this.authPanel = document.createElement('div');
    this.authPanel.id = 'auth-panel';
    this.menuOverlay.appendChild(this.authPanel);
    this.setupAuthUi();

    this.settingsPanel = document.createElement('div');
    this.settingsPanel.id = 'settings-panel';
    this.menuOverlay.appendChild(this.settingsPanel);
    this.setupMenuSettingsUi();

    this.shopPanel = document.createElement('div');
    this.shopPanel.id = 'shop-panel';
    this.menuOverlay.appendChild(this.shopPanel);
    this.setupShopUi();

    this.modeSelectPanel = document.createElement('div');
    this.modeSelectPanel.id = 'mode-select-panel';
    this.menuOverlay.appendChild(this.modeSelectPanel);
    this.setupModeSelectUi();

    document.body.appendChild(this.menuOverlay);

    this.setupInfiniteGameOverUi();
    this.updateCoinHudBadge();
    this.refreshAuthUi();
    this.syncUiVisibility();
  }

  private goMenuMain() {
    this.menuStackScreen = 'main';
    this.shopSection = 'hub';
    this.refreshAuthUi();
  }

  private setupPauseMenuUi() {
    this.pauseMenu = document.createElement('div');
    this.pauseMenu.id = 'pause-menu';
    this.pauseMenu.innerHTML = `
      <div class="pause-card">
        <h2>Paused</h2>
        <div class="pause-audio-row">
          <div class="pause-sound-row">
            <button id="pause-sound-toggle" class="pause-icon-btn" aria-label="Toggle sound">🔊</button>
            <span class="pause-sound-label">Sound</span>
          </div>
          <label class="pause-slider-wrap">
            <span>SFX</span>
            <input id="pause-sfx-slider" type="range" min="0" max="100" step="1" />
          </label>
          <label class="pause-slider-wrap">
            <span>♪</span>
            <input id="pause-music-slider" type="range" min="0" max="100" step="1" />
          </label>
        </div>
        <button id="pause-resume-btn" class="pause-action-btn">Resume</button>
        <button id="pause-exit-btn" class="pause-action-btn">Exit</button>
      </div>
    `;
    document.body.appendChild(this.pauseMenu);

    this.pauseSoundToggleButton = this.pauseMenu.querySelector('#pause-sound-toggle') as HTMLButtonElement;
    this.pauseResumeButton = this.pauseMenu.querySelector('#pause-resume-btn') as HTMLButtonElement;
    this.pauseExitButton = this.pauseMenu.querySelector('#pause-exit-btn') as HTMLButtonElement;
    this.pauseSfxSlider = this.pauseMenu.querySelector('#pause-sfx-slider') as HTMLInputElement;
    this.pauseMusicSlider = this.pauseMenu.querySelector('#pause-music-slider') as HTMLInputElement;

    this.pauseSfxSlider.value = String(Math.round(this.audio.getSfxVolume() * 100));
    this.pauseMusicSlider.value = String(Math.round(this.audio.getMusicVolume() * 100));

    this.pauseSoundToggleButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleAudioMute();
    });
    this.pauseResumeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closePauseMenu();
    });
    this.pauseExitButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playUiClick();
      this.closePauseMenu();
      this.enterMenu();
    });
    this.pauseSfxSlider.addEventListener('input', () => {
      this.audio.setSfxVolume(Number(this.pauseSfxSlider.value) / 100);
      this.persistAudioSettings();
    });
    this.pauseMusicSlider.addEventListener('input', () => {
      this.audio.setMusicVolume(Number(this.pauseMusicSlider.value) / 100);
      this.persistAudioSettings();
    });
    this.refreshPauseAudioUi();
  }

  private setupAuthUi() {
    const authBox = this.authPanel;
    authBox.className = 'auth-box menu-sub-panel';

    const authBack = document.createElement('button');
    authBack.type = 'button';
    authBack.className = 'menu-sub-back-btn';
    authBack.textContent = '← Main menu';
    authBack.addEventListener('click', (e) => {
      e.stopPropagation();
      this.goMenuMain();
    });
    authBack.addEventListener('pointerdown', (e) => e.stopPropagation());
    authBox.appendChild(authBack);

    const authTitle = document.createElement('h3');
    authTitle.className = 'menu-sub-page-title';
    authTitle.textContent = 'Account';
    authBox.appendChild(authTitle);

    this.authStatusLabel = document.createElement('p');
    this.authStatusLabel.className = 'auth-status';
    this.authStatusLabel.textContent = 'Guest mode: progress is not saved after you leave.';
    authBox.appendChild(this.authStatusLabel);

    const formRow = document.createElement('div');
    formRow.className = 'auth-input-row';

    this.authEmailInput = document.createElement('input');
    this.authEmailInput.type = 'email';
    this.authEmailInput.placeholder = 'Email';
    this.authEmailInput.autocomplete = 'email';
    this.authEmailInput.className = 'auth-input';

    this.authPasswordInput = document.createElement('input');
    this.authPasswordInput.type = 'password';
    this.authPasswordInput.placeholder = 'Password';
    this.authPasswordInput.autocomplete = 'current-password';
    this.authPasswordInput.className = 'auth-input';

    formRow.appendChild(this.authEmailInput);
    formRow.appendChild(this.authPasswordInput);
    authBox.appendChild(formRow);

    const buttonRow = document.createElement('div');
    buttonRow.className = 'auth-button-row';

    this.authSignInButton = document.createElement('button');
    this.authSignInButton.className = 'auth-btn';
    this.authSignInButton.textContent = 'Sign In';
    this.authSignInButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.signInWithForm();
    });

    this.authSignUpButton = document.createElement('button');
    this.authSignUpButton.className = 'auth-btn';
    this.authSignUpButton.textContent = 'Sign Up';
    this.authSignUpButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.signUpWithForm();
    });

    this.authSignOutButton = document.createElement('button');
    this.authSignOutButton.className = 'auth-btn';
    this.authSignOutButton.textContent = 'Sign Out';
    this.authSignOutButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.signOutAccount();
    });

    buttonRow.appendChild(this.authSignInButton);
    buttonRow.appendChild(this.authSignUpButton);
    buttonRow.appendChild(this.authSignOutButton);
    authBox.appendChild(buttonRow);
  }

  private setupMenuSettingsUi() {
    const panel = this.settingsPanel;
    panel.className = 'auth-box menu-sub-panel';
    panel.innerHTML = `
      <button type="button" id="settings-menu-back" class="menu-sub-back-btn">← Main menu</button>
      <h3 class="menu-sub-page-title">Settings</h3>
      <div class="pause-audio-row">
        <div class="pause-sound-row">
          <button id="menu-sound-toggle" class="pause-icon-btn" aria-label="Toggle sound">🔊</button>
          <span class="pause-sound-label">Sound</span>
        </div>
        <label class="pause-slider-wrap">
          <span>SFX</span>
          <input id="menu-sfx-slider" type="range" min="0" max="100" step="1" />
        </label>
        <label class="pause-slider-wrap">
          <span>♪</span>
          <input id="menu-music-slider" type="range" min="0" max="100" step="1" />
        </label>
      </div>
    `;

    this.menuSoundToggleButton = panel.querySelector('#menu-sound-toggle') as HTMLButtonElement;
    this.menuSfxSlider = panel.querySelector('#menu-sfx-slider') as HTMLInputElement;
    this.menuMusicSlider = panel.querySelector('#menu-music-slider') as HTMLInputElement;

    const settingsBack = panel.querySelector('#settings-menu-back') as HTMLButtonElement;
    settingsBack.addEventListener('click', (e) => {
      e.stopPropagation();
      this.goMenuMain();
    });
    settingsBack.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.menuSfxSlider.addEventListener('input', () => {
      this.audio.setSfxVolume(Number(this.menuSfxSlider.value) / 100);
      this.persistAudioSettings();
    });
    this.menuMusicSlider.addEventListener('input', () => {
      this.audio.setMusicVolume(Number(this.menuMusicSlider.value) / 100);
      this.persistAudioSettings();
    });
    this.menuSoundToggleButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleAudioMute();
    });
    this.refreshPauseAudioUi();
  }

  private setupShopUi() {
    this.shopPanel.className = 'shop-panel-root menu-sub-panel';
    this.shopPanel.innerHTML = `
      <button type="button" id="shop-exit-to-main" class="menu-sub-back-btn">← Main menu</button>
      <div class="shop-storefront">
        <div class="shop-roof-block">
          <div class="shop-wood-sign">
            <h3 class="shop-title" id="shop-heading">Shop</h3>
          </div>
          <div class="shop-awning" aria-hidden="true">
            <div class="shop-awning-stripes"></div>
            <div class="shop-awning-scallops"></div>
          </div>
        </div>
        <div class="shop-facade">
          <div class="shop-shell">
            <div id="shop-body" class="shop-body"></div>
          </div>
        </div>
      </div>
    `;
    this.shopNavButton = this.shopPanel.querySelector('#shop-exit-to-main') as HTMLButtonElement;
    this.shopHeadingEl = this.shopPanel.querySelector('#shop-heading') as HTMLHeadingElement;
    this.shopBodyEl = this.shopPanel.querySelector('#shop-body') as HTMLDivElement;
    this.shopNavButton.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.shopSection === 'hub') {
        this.goMenuMain();
      } else {
        this.shopSection = 'hub';
        this.refreshShopUi();
      }
    });
    this.shopNavButton.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.shopStatusLabel = document.createElement('p');
    this.shopStatusLabel.className = 'auth-status';
    this.shopStatusLabel.style.textAlign = 'center';
    this.shopStatusLabel.style.marginTop = '2px';
    this.shopPanel.appendChild(this.shopStatusLabel);
    this.refreshShopUi();
  }

  private setupModeSelectUi() {
    const panel = this.modeSelectPanel;
    panel.className = 'mode-select-panel menu-sub-panel';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'menu-sub-back-btn';
    back.textContent = '← Main menu';
    back.addEventListener('click', (e) => { e.stopPropagation(); this.goMenuMain(); });
    back.addEventListener('pointerdown', (e) => e.stopPropagation());
    panel.appendChild(back);

    const title = document.createElement('p');
    title.className = 'mode-select-title';
    title.textContent = 'Choose Mode';
    panel.appendChild(title);

    const levelsBtn = document.createElement('button');
    levelsBtn.className = 'mode-btn mode-btn-levels';
    levelsBtn.innerHTML = `
      <span class="mode-btn-icon">🗺</span>
      <span class="mode-btn-text">
        <span class="mode-btn-name">Levels</span>
        <span class="mode-btn-desc">AI adapts the course to your playstyle</span>
      </span>`;
    levelsBtn.addEventListener('click', (e) => { e.stopPropagation(); this.startFromMenu(); });
    levelsBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    panel.appendChild(levelsBtn);

    const infiniteBtn = document.createElement('button');
    infiniteBtn.className = 'mode-btn mode-btn-infinite';
    infiniteBtn.innerHTML = `
      <span class="mode-btn-icon">∞</span>
      <span class="mode-btn-text">
        <span class="mode-btn-name">Infinite</span>
        <span class="mode-btn-desc">Endless run — survive as long as you can</span>
      </span>`;
    infiniteBtn.addEventListener('click', (e) => { e.stopPropagation(); this.startInfiniteMode(); });
    infiniteBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    panel.appendChild(infiniteBtn);
  }

  private setupInfiniteGameOverUi() {
    this.infiniteGameOverEl = document.createElement('div');
    this.infiniteGameOverEl.id = 'infinite-game-over';

    const card = document.createElement('div');
    card.className = 'infinite-over-card';

    const modeLabel = document.createElement('p');
    modeLabel.className = 'infinite-over-label';
    modeLabel.textContent = '— INFINITE MODE —';
    card.appendChild(modeLabel);

    const title = document.createElement('h2');
    title.className = 'infinite-over-title';
    title.textContent = 'GAME OVER';
    card.appendChild(title);

    const scoreLabel = document.createElement('p');
    scoreLabel.className = 'infinite-over-label';
    scoreLabel.textContent = 'Score';
    card.appendChild(scoreLabel);

    this.infiniteScoreEl = document.createElement('span');
    this.infiniteScoreEl.className = 'infinite-over-score';
    this.infiniteScoreEl.textContent = '0';
    card.appendChild(this.infiniteScoreEl);

    this.infiniteBestEl = document.createElement('p');
    this.infiniteBestEl.className = 'infinite-over-best';
    card.appendChild(this.infiniteBestEl);

    const actions = document.createElement('div');
    actions.className = 'infinite-over-actions';

    const retryBtn = document.createElement('button');
    retryBtn.className = 'infinite-over-btn infinite-over-btn-primary';
    retryBtn.textContent = 'Play Again';
    retryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playRetry();
      this.restartInfiniteMode();
    });
    retryBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    actions.appendChild(retryBtn);

    const menuBtn = document.createElement('button');
    menuBtn.className = 'infinite-over-btn infinite-over-btn-secondary';
    menuBtn.textContent = 'Main Menu';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playUiClick();
      this.enterMenu();
    });
    menuBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    actions.appendChild(menuBtn);

    card.appendChild(actions);
    this.infiniteGameOverEl.appendChild(card);
    document.body.appendChild(this.infiniteGameOverEl);
  }

  private refreshShopUi() {
    if (!this.shopPanel || !this.shopStatusLabel || !this.shopBodyEl) return;
    if (this.shopFeedbackMessage) {
      this.shopStatusLabel.textContent = this.shopFeedbackMessage;
      this.shopStatusLabel.style.display = 'block';
      this.shopStatusLabel.style.color =
        this.shopFeedbackKind === 'error'
          ? '#ffd1d1'
          : 'rgba(210, 235, 255, 0.92)';
    } else {
      this.shopStatusLabel.textContent = '';
      this.shopStatusLabel.style.display = 'none';
    }
    this.shopPanel.style.display = this.menuStackScreen === 'shop' ? 'flex' : 'none';

    const isHub = this.shopSection === 'hub';
    this.shopNavButton.textContent = isHub ? '← Main menu' : '← Shop';

    const headings: Record<ShopSection, string> = {
      hub: 'Shop',
      looks: 'Skins',
      boosts: 'Boosts',
      abilities: 'Abilities',
      inventory: 'Inventory',
    };
    this.shopHeadingEl.textContent = headings[this.shopSection];

    this.shopBodyEl.innerHTML = '';
    if (isHub) {
      this.renderShopCategoryHub(this.shopBodyEl);
    } else if (this.shopSection === 'looks') {
      this.renderShopLooksStore(this.shopBodyEl);
    } else if (this.shopSection === 'boosts') {
      this.renderShopBoostsStore(this.shopBodyEl);
    } else if (this.shopSection === 'abilities') {
      this.renderShopAbilitiesStore(this.shopBodyEl);
    } else {
      this.renderShopInventory(this.shopBodyEl);
    }
    this.updateCoinHudBadge();
  }

  private renderShopCategoryHub(container: HTMLDivElement) {
    const hub = document.createElement('div');
    hub.className = 'shop-category-hub';
    const categories: Array<{
      section: Exclude<ShopSection, 'hub'>;
      title: string;
      icon: string;
    }> = [
      { section: 'looks', title: 'Skins', icon: '👤' },
      { section: 'boosts', title: 'Boosts', icon: '⚡' },
      { section: 'abilities', title: 'Abilities', icon: '✨' },
      { section: 'inventory', title: 'Inventory', icon: '🎒' },
    ];
    for (const cat of categories) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'shop-category-tile';
      tile.innerHTML = `
        <span class="shop-category-icon" aria-hidden="true">${cat.icon}</span>
        <span class="shop-category-title">${cat.title}</span>
      `;
      tile.addEventListener('click', (e) => {
        e.stopPropagation();
        this.shopSection = cat.section;
        this.refreshShopUi();
      });
      tile.addEventListener('pointerdown', (e) => e.stopPropagation());
      hub.appendChild(tile);
    }
    container.appendChild(hub);
  }

  private renderShopLooksStore(container: HTMLDivElement) {
    const grid = document.createElement('div');
    grid.className = 'shop-grid';
    for (const skin of SKIN_CATALOG) {
      const owned = this.ownedSkins.has(skin.id);
      const canAfford = this.coins >= skin.cost;
      const subtitle = 'Skin';
      const actionLabel = owned ? 'Owned' : '';
      const buttonKind = owned ? 'owned' : canAfford ? 'buy-ready' : 'buy-locked';
      const card = this.createShopCard({
        title: skin.label,
        subtitle,
        preview: skin.preview,
        previewHtml: skin.id === 'rainbow' ? '<span class="rainbow-skin-preview-block"></span>' : undefined,
        actionLabel,
        buyPrice: owned ? undefined : skin.cost,
        buttonKind,
        onAffordableClick: () => this.buySkin(skin.id),
        onInsufficientFundsTap: () => {
          if (owned || canAfford) return;
          const missing = skin.cost - this.coins;
          this.shopFeedbackMessage = `Need ${missing} more for ${skin.label}.`;
          this.shopFeedbackKind = 'error';
          this.refreshShopUi();
        },
      });
      grid.appendChild(card);
    }
    container.appendChild(grid);
  }

  private renderShopBoostsStore(container: HTMLDivElement) {
    const wrap = document.createElement('div');
    wrap.className = 'shop-abilities-store';

    const notice = document.createElement('p');
    notice.className = 'shop-abilities-notice';
    notice.textContent = 'Boosts only work in Level Mode. They have no effect in Infinite Mode.';
    wrap.appendChild(notice);

    const grid = document.createElement('div');
    grid.className = 'shop-grid';
    for (const power of POWERUP_CATALOG) {
      const owned = this.ownedPowerUps.has(power.id);
      const canAfford = this.coins >= power.cost;
      const actionLabel = owned ? 'Owned' : '';
      const buttonKind = owned ? 'owned' : canAfford ? 'buy-ready' : 'buy-locked';
      const card = this.createShopCard({
        title: power.label,
        subtitle: power.description,
        preview: power.preview,
        actionLabel,
        buyPrice: owned ? undefined : power.cost,
        buttonKind,
        onAffordableClick: () => this.buyPowerUp(power.id),
        onInsufficientFundsTap: () => {
          if (owned || canAfford) return;
          const missing = power.cost - this.coins;
          this.shopFeedbackMessage = `Need ${missing} more for ${power.label}.`;
          this.shopFeedbackKind = 'error';
          this.refreshShopUi();
        },
      });
      grid.appendChild(card);
    }
    wrap.appendChild(grid);
    container.appendChild(wrap);
  }

  private renderShopAbilitiesStore(container: HTMLDivElement) {
    const wrap = document.createElement('div');
    wrap.className = 'shop-abilities-store';

    const notice = document.createElement('p');
    notice.className = 'shop-abilities-notice';
    notice.textContent = `Abilities only work in Level Mode. Only one ability can be equipped at a time. Press [${ABILITY_KEYBIND}] to activate your equipped ability during a run.`;
    wrap.appendChild(notice);

    const grid = document.createElement('div');
    grid.className = 'shop-grid';
    for (const ability of ABILITY_CATALOG) {
      const owned = this.ownedAbilities.has(ability.id);
      const equipped = this.equippedAbility === ability.id;
      const canAfford = this.coins >= ability.cost;
      let actionLabel: string;
      let buttonKind: Parameters<typeof this.createShopCard>[0]['buttonKind'];
      if (!owned) {
        actionLabel = '';
        buttonKind = canAfford ? 'buy-ready' : 'buy-locked';
      } else if (equipped) {
        actionLabel = 'Equipped';
        buttonKind = 'equipped';
      } else {
        actionLabel = 'Equip';
        buttonKind = 'equip';
      }
      const card = this.createShopCard({
        title: ability.label,
        subtitle: ability.description,
        preview: ability.preview,
        actionLabel,
        buyPrice: owned ? undefined : ability.cost,
        buttonKind,
        onAffordableClick: () => {
          if (!owned) {
            this.buyAbility(ability.id);
          } else {
            this.equipAbility(ability.id);
          }
        },
        onInsufficientFundsTap: () => {
          if (owned || canAfford) return;
          const missing = ability.cost - this.coins;
          this.shopFeedbackMessage = `Need ${missing} more for ${ability.label}.`;
          this.shopFeedbackKind = 'error';
          this.refreshShopUi();
        },
      });
      grid.appendChild(card);
    }
    wrap.appendChild(grid);
    container.appendChild(wrap);
  }

  private renderShopInventory(container: HTMLDivElement) {
    const wrap = document.createElement('div');
    wrap.className = 'shop-inventory';

    const skinsTitle = document.createElement('h4');
    skinsTitle.className = 'shop-inventory-section-title';
    skinsTitle.textContent = 'Skins';
    wrap.appendChild(skinsTitle);

    const skinGrid = document.createElement('div');
    skinGrid.className = 'shop-grid';
    const skinOrder: SkinId[] = ['classic', ...SKIN_CATALOG.map((s) => s.id)];
    for (const skinId of skinOrder) {
      if (!this.ownedSkins.has(skinId)) continue;
      const meta = skinDisplayMeta(skinId);
      const equipped = this.equippedSkin === skinId;
      const actionLabel = equipped ? 'Equipped' : 'Equip';
      const buttonKind = equipped ? 'equipped' : 'equip';
      const card = this.createShopCard({
        title: meta.label,
        subtitle: meta.subtitle,
        preview: meta.preview,
        previewHtml: skinId === 'rainbow' ? '<span class="rainbow-skin-preview-block"></span>' : undefined,
        actionLabel,
        buttonKind,
        onAffordableClick: () => {
          this.equippedSkin = skinId;
          this.shopFeedbackMessage = `${meta.label} equipped.`;
          this.shopFeedbackKind = 'info';
          this.saveLocalShopState();
          this.persistProgressIfSignedIn();
          this.refreshShopUi();
        },
      });
      skinGrid.appendChild(card);
    }
    wrap.appendChild(skinGrid);

    const boostsTitle = document.createElement('h4');
    boostsTitle.className = 'shop-inventory-section-title';
    boostsTitle.textContent = 'Boosts';
    wrap.appendChild(boostsTitle);

    const boostGrid = document.createElement('div');
    boostGrid.className = 'shop-grid';
    let anyBoost = false;
    for (const power of POWERUP_CATALOG) {
      if (!this.ownedPowerUps.has(power.id)) continue;
      anyBoost = true;
      const isOn = this.activeBoosts.has(power.id);
      const card = this.createShopCard({
        title: power.label,
        subtitle: power.description,
        preview: power.preview,
        actionLabel: isOn ? 'Active' : 'Off',
        buttonKind: isOn ? 'boost-on' : 'boost-off',
        onAffordableClick: () => {
          if (this.activeBoosts.has(power.id)) {
            this.activeBoosts.delete(power.id);
          } else {
            this.activeBoosts.add(power.id);
          }
          this.updatePlayerSpeedFromPowerUps();
          this.saveLocalShopState();
          this.persistProgressIfSignedIn();
          this.refreshShopUi();
        },
      });
      boostGrid.appendChild(card);
    }
    if (!anyBoost) {
      const empty = document.createElement('p');
      empty.className = 'auth-status shop-inventory-empty';
      empty.textContent = 'No boosts yet. Open Boosts to purchase.';
      wrap.appendChild(empty);
    } else {
      wrap.appendChild(boostGrid);
    }

    const abilitiesTitle = document.createElement('h4');
    abilitiesTitle.className = 'shop-inventory-section-title';
    abilitiesTitle.textContent = 'Special Abilities';
    wrap.appendChild(abilitiesTitle);



    const abilityGrid = document.createElement('div');
    abilityGrid.className = 'shop-grid';
    let anyAbility = false;
    for (const ability of ABILITY_CATALOG) {
      if (!this.ownedAbilities.has(ability.id)) continue;
      anyAbility = true;
      const equipped = this.equippedAbility === ability.id;
      const card = this.createShopCard({
        title: ability.label,
        subtitle: ability.description,
        preview: ability.preview,
        actionLabel: equipped ? 'Equipped' : 'Equip',
        buttonKind: equipped ? 'equipped' : 'equip',
        onAffordableClick: () => this.equipAbility(ability.id),
      });
      abilityGrid.appendChild(card);
    }
    if (!anyAbility) {
      const empty = document.createElement('p');
      empty.className = 'auth-status shop-inventory-empty';
      empty.textContent = 'No abilities yet. Open Abilities to purchase.';
      wrap.appendChild(empty);
    } else {
      wrap.appendChild(abilityGrid);
    }

    container.appendChild(wrap);
  }

  private createShopCard(opts: {
    title: string;
    subtitle: string;
    preview: string;
    previewHtml?: string;
    actionLabel: string;
    buyPrice?: number;
    buttonKind: 'buy-ready' | 'buy-locked' | 'equip' | 'equipped' | 'owned' | 'active' | 'boost-on' | 'boost-off';
    onAffordableClick: () => void;
    onInsufficientFundsTap?: () => void;
  }): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'shop-card';
    const isLocked = opts.buttonKind === 'buy-locked';
    const isActive = opts.buttonKind === 'buy-ready' || opts.buttonKind === 'equip' || opts.buttonKind === 'boost-on' || opts.buttonKind === 'boost-off';
    if (isLocked) {
      card.classList.add('shop-card--locked');
      card.style.cursor = 'pointer';
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        opts.onInsufficientFundsTap?.();
      });
    }

    const preview = document.createElement('div');
    preview.className = 'shop-item-preview';
    if (opts.previewHtml) {
      preview.innerHTML = opts.previewHtml;
    } else {
      preview.textContent = opts.preview;
    }

    const title = document.createElement('p');
    title.className = 'shop-item-title';
    title.textContent = opts.title;

    const subtitle = document.createElement('p');
    subtitle.className = 'shop-item-subtitle';
    subtitle.textContent = opts.subtitle;

    const button = document.createElement('button');
    button.className = 'shop-buy-btn';
    const useBuyLayout =
      opts.buyPrice !== undefined && (opts.buttonKind === 'buy-ready' || opts.buttonKind === 'buy-locked');
    if (useBuyLayout) {
      button.innerHTML = shopBuyButtonHtml(opts.buyPrice!);
      button.setAttribute('aria-label', `Buy for ${opts.buyPrice}`);
    } else {
      button.textContent = opts.actionLabel;
    }
    if (isActive) {
      if (opts.buttonKind === 'boost-off') {
        button.classList.add('shop-buy-btn--muted');
      } else {
        button.classList.add('shop-buy-btn--active');
      }
      button.disabled = false;
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onAffordableClick();
      });
    } else if (isLocked) {
      button.classList.add('shop-buy-btn--muted', 'shop-buy-btn--locked');
      button.disabled = false;
      button.setAttribute('aria-disabled', 'true');
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onInsufficientFundsTap?.();
      });
    } else {
      button.classList.add('shop-buy-btn--muted');
      if (opts.buttonKind === 'active') {
        button.classList.add('shop-buy-btn--active-tag');
      }
      button.disabled = true;
    }

    card.appendChild(preview);
    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(button);
    return card;
  }

  private buySkin(skinId: SkinId) {
    const item = SKIN_CATALOG.find((entry) => entry.id === skinId);
    if (!item || this.ownedSkins.has(skinId)) return;
    if (this.coins < item.cost) {
      const missing = item.cost - this.coins;
      this.shopFeedbackMessage = `Need ${missing} more for ${item.label}.`;
      this.shopFeedbackKind = 'error';
      this.refreshShopUi();
      return;
    }
    this.coins -= item.cost;
    this.ownedSkins.add(skinId);
    this.equippedSkin = skinId;
    this.shopFeedbackMessage = `${item.label} purchased and equipped!`;
    this.shopFeedbackKind = 'info';
    this.saveLocalShopState();
    this.persistProgressIfSignedIn();
    this.refreshShopUi();
  }

  private buyPowerUp(powerId: PowerUpId) {
    const item = POWERUP_CATALOG.find((entry) => entry.id === powerId);
    if (!item || this.ownedPowerUps.has(powerId)) return;
    if (this.coins < item.cost) {
      const missing = item.cost - this.coins;
      this.shopFeedbackMessage = `Need ${missing} more for ${item.label}.`;
      this.shopFeedbackKind = 'error';
      this.refreshShopUi();
      return;
    }
    this.coins -= item.cost;
    this.ownedPowerUps.add(powerId);
    this.activeBoosts.add(powerId);
    this.shopFeedbackMessage = `${item.label} purchased!`;
    this.shopFeedbackKind = 'info';
    this.updatePlayerSpeedFromPowerUps();
    this.saveLocalShopState();
    this.persistProgressIfSignedIn();
    this.refreshShopUi();
  }

  private buyAbility(abilityId: AbilityId) {
    const item = ABILITY_CATALOG.find((entry) => entry.id === abilityId);
    if (!item || this.ownedAbilities.has(abilityId)) return;
    if (this.coins < item.cost) {
      const missing = item.cost - this.coins;
      this.shopFeedbackMessage = `Need ${missing} more for ${item.label}.`;
      this.shopFeedbackKind = 'error';
      this.refreshShopUi();
      return;
    }
    this.coins -= item.cost;
    this.ownedAbilities.add(abilityId);
    this.equippedAbility = abilityId;
    this.shopFeedbackMessage = `${item.label} purchased and equipped! Press [${ABILITY_KEYBIND}] to use it in Level Mode.`;
    this.shopFeedbackKind = 'info';
    this.saveLocalShopState();
    this.persistProgressIfSignedIn();
    this.updateAbilityHudBadge();
    this.refreshShopUi();
  }

  private equipAbility(abilityId: AbilityId) {
    if (!this.ownedAbilities.has(abilityId)) return;
    const item = ABILITY_CATALOG.find((entry) => entry.id === abilityId);
    if (this.equippedAbility === abilityId) {
      this.equippedAbility = null;
      this.shopFeedbackMessage = `${item?.label ?? abilityId} unequipped.`;
    } else {
      this.equippedAbility = abilityId;
      this.shopFeedbackMessage = `${item?.label ?? abilityId} equipped. Press [${ABILITY_KEYBIND}] in Level Mode to activate.`;
    }
    this.shopFeedbackKind = 'info';
    this.saveLocalShopState();
    this.persistProgressIfSignedIn();
    this.updateAbilityHudBadge();
    this.refreshShopUi();
  }

  private rewardCoinsForLevel(levelIndex: number): number {
    const reward = 20 + levelIndex * 12;
    this.coins += reward;
    this.saveLocalShopState();
    this.refreshShopUi();
    return reward;
  }

  private async initializeAuth() {
    if (!this.authClient.isConfigured()) {
      this.setAuthStatus('Auth not configured. Guest mode only.');
      this.refreshAuthUi();
      return;
    }

    try {
      const user = await this.authClient.getCurrentUser();
      await this.handleAuthUserChanged(user?.id ?? null, user?.email ?? null);
    } catch (err) {
      this.setAuthStatus(`Auth init failed: ${this.errorMessage(err)}`);
    }

    this.authClient.onAuthStateChange((user) => {
      void this.handleAuthUserChanged(user?.id ?? null, user?.email ?? null);
    });
  }

  private async handleAuthUserChanged(userId: string | null, email: string | null) {
    this.authUserId = userId;
    this.loadLocalShopState();
    if (!userId) {
      this.highestLevelUnlocked = 1;
      this.playButton.textContent = 'Play';
      this.setAuthStatus('Guest mode: progress is not saved after you leave.');
      this.refreshAuthUi();
      return;
    }

    this.playButton.textContent = 'Play';
    this.setAuthStatus(`Signed in as ${email ?? 'player'}. Loading progress...`);
    this.refreshAuthUi();

    try {
      const progress = await this.authClient.loadProgress(userId);
      this.applyLoadedProgress(progress);
      this.setAuthStatus(`Signed in as ${email ?? 'player'}. Progress loaded.`);
      // Successful login should return user to the clean main menu surface.
      this.menuStackScreen = 'main';
      this.shopSection = 'hub';
      this.authPasswordInput.value = '';
      this.refreshAuthUi();
    } catch (err) {
      this.setAuthStatus(`Failed to load progress: ${this.errorMessage(err)}`);
    }
    this.refreshAuthUi();
  }

  private applyLoadedProgress(progress: StoredProgress | null) {
    const safeProgress = progress ?? { highestLevelUnlocked: 1, runs: [] };
    this.highestLevelUnlocked = Math.max(1, safeProgress.highestLevelUnlocked);
    this.tracker.replaceRuns(safeProgress.runs);
    this.refreshPlayerModel();
    this.debugPanel.setPlayerModel(this.playerModel);
  }

  private async signInWithForm() {
    if (!this.authClient.isConfigured()) return;
    const email = this.authEmailInput.value.trim();
    const password = this.authPasswordInput.value;
    if (!email || !password) {
      this.setAuthStatus('Enter email and password.');
      return;
    }
    this.setAuthStatus('Signing in...');
    try {
      await this.authClient.signIn(email, password);
      this.authPasswordInput.value = '';
    } catch (err) {
      this.setAuthStatus(`Sign in failed: ${this.errorMessage(err)}`);
    }
  }

  private async signUpWithForm() {
    if (!this.authClient.isConfigured()) return;
    const email = this.authEmailInput.value.trim();
    const password = this.authPasswordInput.value;
    if (!email || !password) {
      this.setAuthStatus('Enter email and password.');
      return;
    }
    if (password.length < 6) {
      this.setAuthStatus('Password must be at least 6 characters.');
      return;
    }
    this.setAuthStatus('Creating account...');
    try {
      await this.authClient.signUp(email, password);
      try {
        await this.authClient.signIn(email, password);
      } catch (err) {
        const msg = this.errorMessage(err);
        if (msg.toLowerCase().includes('email not confirmed')) {
          this.setAuthStatus('Account created. Check your email to confirm, then sign in.');
          return;
        }
        throw err;
      }
      this.authPasswordInput.value = '';
    } catch (err) {
      this.setAuthStatus(`Sign up failed: ${this.errorMessage(err)}`);
    }
  }

  private async signOutAccount() {
    try {
      await this.authClient.signOut();
      this.tracker.replaceRuns([]);
      this.refreshPlayerModel();
      this.debugPanel.setPlayerModel(this.playerModel);
      this.highestLevelUnlocked = 1;
      this.setAuthStatus('Signed out. Guest mode active.');
      this.refreshAuthUi();
      this.enterMenu();
    } catch (err) {
      this.setAuthStatus(`Sign out failed: ${this.errorMessage(err)}`);
    }
  }

  private refreshAuthUi() {
    const configured = this.authClient.isConfigured();
    const signedIn = !!this.authUserId;
    this.authEmailInput.disabled = !configured || signedIn;
    this.authPasswordInput.disabled = !configured || signedIn;
    this.authSignInButton.disabled = !configured || signedIn;
    this.authSignUpButton.disabled = !configured || signedIn;
    this.authSignOutButton.disabled = !configured || !signedIn;
    this.authSignInButton.style.display = signedIn ? 'none' : 'block';
    this.authSignUpButton.style.display = signedIn ? 'none' : 'block';
    this.authSignOutButton.style.display = signedIn ? 'block' : 'none';
    this.authToggleButton.textContent = signedIn ? 'Account' : 'Log In';
    this.authToggleButton.classList.remove('danger');

    const onMain = this.menuStackScreen === 'main';
    this.menuMainStack.style.display = onMain ? 'flex' : 'none';
    this.authPanel.style.display = this.menuStackScreen === 'auth' ? 'flex' : 'none';
    this.settingsPanel.style.display = this.menuStackScreen === 'settings' ? 'flex' : 'none';
    if (this.modeSelectPanel) {
      this.modeSelectPanel.style.display = this.menuStackScreen === 'modeSelect' ? 'flex' : 'none';
    }
    this.refreshShopUi();
  }

  private setAuthStatus(message: string) {
    if (!this.authStatusLabel) return;
    this.authStatusLabel.textContent = message;
  }

  private persistProgressIfSignedIn() {
    if (!this.authUserId) return;
    const progress: StoredProgress = {
      highestLevelUnlocked: this.highestLevelUnlocked,
      runs: this.tracker.getAllRuns().slice(-80),
    };
    void this.authClient
      .saveProgress(this.authUserId, progress)
      .then(() => this.setAuthStatus('Progress saved.'))
      .catch((err) => this.setAuthStatus(`Save failed: ${this.errorMessage(err)}`));
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object' && 'message' in err) {
      const msg = (err as { message?: unknown }).message;
      if (typeof msg === 'string' && msg.trim().length > 0) return msg;
    }
    if (typeof err === 'string') return err;
    try {
      return JSON.stringify(err);
    } catch {
      return 'Unknown error';
    }
  }

  private enterMenu() {
    if (this.state === 'playing' || this.state === 'paused') {
      this.tracker.finishRun(false);
      this.refreshPlayerModel();
      this.debugPanel.setPlayerModel(this.playerModel);
      this.persistProgressIfSignedIn();
    }

    this.gameMode = 'levels';
    this.infiniteGen = null;
    this.infiniteRunScore = 0;

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
    this.menuStackScreen = 'main';
    this.shopSection = 'hub';
    this.refreshAuthUi();
    this.syncUiVisibility();
    this.audio.startMenuMusic();
  }

  private startFromMenu() {
    this.audio.unlock();
    this.audio.playUiClick();
    this.audio.playMenuStart();
    this.audio.stopMusic();
    this.attempts = 1;
    this.menuStackScreen = 'main';
    this.shopSection = 'hub';
    this.refreshAuthUi();
    const startAt = Math.max(0, this.highestLevelUnlocked - 1);
    this.startLevel(startAt, 'countdown');
  }

  private startInfiniteMode() {
    this.audio.unlock();
    this.audio.playUiClick();
    this.audio.playMenuStart();
    this.audio.stopMusic();
    this.gameMode = 'infinite';
    this.infiniteRunScore = 0;
    this.attempts = 1;
    this.menuStackScreen = 'main';
    this.shopSection = 'hub';
    this.refreshAuthUi();
    this.refreshPlayerModel();

    this.resizeCanvas();
    this.infiniteGen = new InfiniteGenerator();
    this.level = {
      index: 0,
      worldWidth: this.infiniteGen.currentFrontier + this.canvas.width + 1000,
      groundY: this.canvas.height - 80,
      flagX: Number.MAX_SAFE_INTEGER,
      obstacles: [],
    };
    this.spawnPlayer();
    this.hasSpawnedPlayer = true;
    this.cameraX = 0;
    this.state = 'countdown';
    this.countdownSec = START_COUNTDOWN_SECS;
    this.lastCountdownAnnounced = null;
    this.resetFrameTracking();
    this.tracker.startRun(0, this.attempts, [], {});
    this.infiniteModelRefreshTimer = 0;
    this.updateInfiniteGeneration(0);
    this.levelAgeSec = 0;
    this.consumedShield = false;
    this.invincibleUntilMs = null;
    this.syncUiVisibility();
  }

  private restartInfiniteMode() {
    this.infiniteRunScore = 0;
    this.attempts++;
    this.infiniteGen = new InfiniteGenerator();
    this.refreshPlayerModel();

    this.resizeCanvas();
    this.level = {
      index: 0,
      worldWidth: this.infiniteGen.currentFrontier + this.canvas.width + 1000,
      groundY: this.canvas.height - 80,
      flagX: Number.MAX_SAFE_INTEGER,
      obstacles: [],
    };
    this.spawnPlayer();
    this.hasSpawnedPlayer = true;
    this.cameraX = 0;
    this.state = 'playing';
    this.invincibleUntilMs = null;
    this.resetFrameTracking();
    this.tracker.startRun(0, this.attempts, [], {});
    this.infiniteModelRefreshTimer = 0;
    this.updateInfiniteGeneration(0);
    this.levelAgeSec = 0;
    this.consumedShield = false;
    this.syncUiVisibility();
    this.audio.startGameplayMusic();
  }

  private updateInfiniteGeneration(dt: number) {
    if (!this.infiniteGen) return;
    const newObs = this.infiniteGen.generateChunks(
      this.player.pos.x,
      this.infiniteRunScore,
      this.playerModel,
    );
    for (const o of newObs) this.level.obstacles.push(o);
    // Remove off-screen obstacles to keep the array bounded
    this.level.obstacles = this.infiniteGen.cleanupBefore(this.cameraX, this.level.obstacles);
    // Extend worldWidth so ground always renders ahead of the player
    this.level.worldWidth = this.infiniteGen.currentFrontier + this.canvas.width + 1000;
    // Periodically refresh the player model so trap weighting reflects recent behavior.
    this.infiniteModelRefreshTimer += dt;
    if (this.infiniteModelRefreshTimer >= Game.INFINITE_MODEL_REFRESH_INTERVAL) {
      this.infiniteModelRefreshTimer = 0;
      this.refreshPlayerModel();
    }
  }

  // ── Infinite Mode persistent best score ────────────────────────────────────
  private loadInfiniteBest() {
    try {
      const raw = window.localStorage.getItem(Game.INFINITE_BEST_KEY);
      if (raw) this.infiniteBestScore = Math.max(0, parseInt(raw, 10) || 0);
    } catch { /* ignore private mode / quota */ }
  }

  private saveInfiniteBest() {
    try {
      window.localStorage.setItem(Game.INFINITE_BEST_KEY, String(this.infiniteBestScore));
    } catch { /* ignore */ }
  }

  private togglePauseMenu() {
    if (this.state === 'paused') {
      this.closePauseMenu();
      return;
    }
    if (this.state === 'playing' || this.state === 'dead' || this.state === 'levelComplete') {
      this.openPauseMenu();
    }
  }

  private openPauseMenu() {
    this.preMenuState = this.state;
    this.state = 'paused';
    this.audio.setPaused(true);
    this.audio.playUiClick();
    this.syncUiVisibility();
  }

  private closePauseMenu() {
    if (this.state !== 'paused') return;
    this.state = this.preMenuState ?? 'playing';
    this.preMenuState = null;
    this.audio.setPaused(this.state !== 'playing');
    this.audio.playUiClick();
    this.syncUiVisibility();
  }

  private syncUiVisibility() {
    const inMenu = this.state === 'menu';
    this.menuOverlay.style.display = inMenu ? 'flex' : 'none';
    const inGameplay = this.state === 'playing' || this.state === 'paused' || this.state === 'countdown' || this.state === 'dead' || this.state === 'levelComplete';
    // Hide menu button when showing the infinite game-over overlay (it has its own buttons)
    const infiniteOver = this.gameMode === 'infinite' && this.state === 'dead';
    this.menuButton.style.display = (inGameplay && !infiniteOver) ? 'inline-flex' : 'none';
    this.pauseMenu.style.display = this.state === 'paused' ? 'flex' : 'none';
    const isActivePlay = this.state === 'playing' || this.state === 'paused' || this.state === 'countdown';
    this.mobileControls?.classList.toggle('is-playing', isActivePlay);
    this.mobileControls?.classList.toggle('is-dead', this.state === 'dead');
    this.updateAbilityHudBadge();
    if (this.deathTapZone) {
      // In infinite mode dead state, buttons are on the overlay — don't show the tap zone
      const showTap = (this.state === 'dead' && this.gameMode === 'levels') || this.state === 'levelComplete';
      this.deathTapZone.style.display = showTap ? 'block' : 'none';
    }
    // Infinite game-over overlay
    if (this.infiniteGameOverEl) {
      this.infiniteGameOverEl.style.display = infiniteOver ? 'flex' : 'none';
      if (infiniteOver) {
        this.infiniteScoreEl.textContent = String(this.infiniteRunScore);
        const hasBest = this.infiniteBestScore > 0;
        this.infiniteBestEl.textContent = hasBest
          ? (this.infiniteRunScore >= this.infiniteBestScore ? `NEW BEST: ${this.infiniteBestScore}` : `Best: ${this.infiniteBestScore}`)
          : '';
      }
    }
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
    this.refreshPauseAudioUi();
    this.persistAudioSettings();
  }

  private refreshPauseAudioUi() {
    if (!this.pauseSoundToggleButton) return;
    this.pauseSoundToggleButton.textContent = this.audioMuted ? '🔇' : '🔊';
    this.pauseSoundToggleButton.setAttribute('title', this.audioMuted ? 'Sound off' : 'Sound on');
    if (this.menuSoundToggleButton) {
      this.menuSoundToggleButton.textContent = this.audioMuted ? '🔇' : '🔊';
      this.menuSoundToggleButton.setAttribute('title', this.audioMuted ? 'Sound off' : 'Sound on');
    }
    if (this.pauseSfxSlider) this.pauseSfxSlider.value = String(Math.round(this.audio.getSfxVolume() * 100));
    if (this.pauseMusicSlider) this.pauseMusicSlider.value = String(Math.round(this.audio.getMusicVolume() * 100));
    if (this.menuSfxSlider) this.menuSfxSlider.value = String(Math.round(this.audio.getSfxVolume() * 100));
    if (this.menuMusicSlider) this.menuMusicSlider.value = String(Math.round(this.audio.getMusicVolume() * 100));
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
    player.update(dt, effectiveFloor ?? this.level.groundY, effectiveFloor !== null, {
      freezeVertical: false,
    });
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
        this.input.consumeAbility();
        break;

      case 'countdown':
        this.input.consumeJump();
        this.input.consumeJumpRelease();
        this.input.consumeAbility();
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
          this.syncUiVisibility();
        }
        break;

      case 'paused':
        // Drain jump input while paused so resume does not trigger a jump.
        this.input.consumeJump();
        this.input.consumeJumpRelease();
        this.input.consumeAbility();
        break;

      case 'dead':
        this.deathTimer += dt;
        this.input.consumeAbility();
        // Infinite mode: retry is handled by the HTML game-over overlay buttons
        if (this.gameMode === 'levels' && this.deathTimer >= DEATH_INPUT_DELAY && this.input.consumeJump()) {
          this.audio.playRetry();
          this.restartLevel();
        }
        break;

      case 'levelComplete':
        this.input.consumeAbility();
        if (this.input.consumeJump()) {
          const next = this.levelIndex + 1;
          this.attempts = 1;
          this.audio.playAdvance();
          this.startLevel(next);
        }
        break;

      case 'playing':
        if (this.gameMode === 'infinite') this.updateInfiniteGeneration(dt);
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

    // Ability activation — Level Mode only; Infinite Mode ignores it entirely
    if (this.input.consumeAbility() && this.gameMode === 'levels' && this.equippedAbility) {
      this.activateEquippedAbility();
    }

    if (this.phaseFx) {
      this.phaseFx.age += dt;
      if (this.phaseFx.age >= PHASE_FX_DURATION) this.phaseFx = null;
    }
    if (this.phaseDenyFx) {
      this.phaseDenyFx.age += dt;
      if (this.phaseDenyFx.age >= PHASE_DENY_FX_DURATION) this.phaseDenyFx = null;
    }

    // Update fireball (Level Mode only — already gated at activation)
    this.updateFireball(dt);

    // Tick time warp — only in level mode (activation is already level-only gated)
    if (this.timeWarpActive && this.gameMode === 'levels') {
      this.timeWarpTimeLeft = Math.max(0, this.timeWarpTimeLeft - dt);
      if (this.timeWarpTimeLeft <= 0) {
        this.timeWarpActive = false;
        this.updateAbilityHudBadge();
      } else {
        this.updateAbilityHudBadge();
      }
    }

    // Physics dt — scaled for time warp to slow both horizontal and vertical motion uniformly
    const physicsDt = this.timeWarpActive ? dt * TIME_WARP_SPEED_MULT : dt;

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
    player.update(physicsDt, effectiveFloor ?? level.groundY, effectiveFloor !== null, {
      freezeVertical: this.phaseFx !== null,
    });
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
    this.updateElectricFields(dt);
    this.updateCrusherCeilings(dt);

    // Run the real-time trap director for levels mode (level > 0) and for infinite mode
    // once the player has been running long enough to generate meaningful telemetry.
    const infiniteTrapsActive = this.gameMode === 'infinite' && this.infiniteRunScore >= 200;
    if (this.levelIndex > 0 || infiniteTrapsActive) {
      // In infinite mode use a synthetic level index that grows with score so the AI
      // unlocks more aggressive phases over time (must be >= 2 to pass the observe gate).
      const effectiveLevelIndex = infiniteTrapsActive
        ? Math.max(2, Math.floor(this.infiniteRunScore / 150))
        : this.levelIndex;
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
        levelIndex: effectiveLevelIndex,
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
      const observeReason = this.gameMode === 'infinite'
        ? `AI observing... adapts at score 200 (${this.infiniteRunScore}/200)`
        : 'Learning baseline behavior on Level 1';
      this.trapRuntimeDebug = {
        ...this.trapRuntimeDebug,
        phase: 'observe',
        activeTrap: 'none',
        trapState: 'none',
        activeRoute: 'none',
        trapReason: observeReason,
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
    const nowMs = performance.now();
    const isInvincible = this.invincibleUntilMs !== null && nowMs < this.invincibleUntilMs;
    if (!isInvincible && this.invincibleUntilMs !== null && nowMs >= this.invincibleUntilMs) {
      this.invincibleUntilMs = null;
    }
    if (player.pos.y > level.groundY + 60) {
      this.triggerDeath('gap', player.pos.x);
      return;
    }
    if (!isInvincible) {
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
      if (this.hitElectricField()) {
        this.triggerDeath('spike', player.pos.x);
        return;
      }
      if (this.hitCrusherCeiling()) {
        this.triggerDeath('spike', player.pos.x);
        return;
      }
    }

    // --- Infinite mode: update run score ---
    if (this.gameMode === 'infinite') {
      const rawScore = Math.max(0, Math.floor((player.pos.x - SPAWN_X) / 10));
      this.infiniteRunScore = Math.max(this.infiniteRunScore, rawScore);
    }

    // --- Win check (never fires in infinite mode: flagX = MAX_SAFE_INTEGER) ---
    if (this.gameMode !== 'infinite' && player.pos.x + player.width >= level.flagX) {
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
      this.highestLevelUnlocked = Math.max(this.highestLevelUnlocked, this.levelIndex + 2);
      const earnedCoins = this.rewardCoinsForLevel(this.levelIndex + 1);
      this.showAIMessage(`Level clear: +${earnedCoins}`);
      this.persistProgressIfSignedIn();
      this.audio.playLevelComplete();
      this.audio.stopMusic();
      this.state = 'levelComplete';
      this.syncUiVisibility();
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
        !o.fireballDestroyed &&
        !(o.trapType === 'collapsingPlatform' && o.trapState === 'spent') &&
        o.disappearState !== 'invisible' &&
        !(o.aiModifier === 'droppingPlatform' && (o.aiModState === 'dropping' || o.aiModState === 'invisible')) &&
        !(o.aiModifier === 'crumblePlatform' && (o.aiModState === 'dropping' || o.aiModState === 'invisible')) &&
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
      .filter(o => (o.kind === 'spike' || o.kind === 'doubleSpike') && !o.fireballDestroyed)
      .some(s => {
        const sx = s.currentX ?? s.x;
        const sw = s.currentWidth ?? s.width;
        // Height-animating modifiers use aiModVisualHeight; patrol/others use real height
        const usesAnimatedHeight = s.aiModifier === 'risingSpike' || s.aiModifier === 'pulsingSpike';
        const sh = usesAnimatedHeight ? (s.aiModVisualHeight ?? 0) : (s.currentHeight ?? s.height);
        if (sh < 4) return false;
        // Elevated spikes sit on a platform surface; ground spikes sit at groundY
        const baseY = s.elevationH !== undefined ? groundY - s.elevationH : groundY;
        const tipY = baseY - sh;

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
    const pl = this.player.pos.x;
    const pr = pl + this.player.width;
    const playerTop = this.player.pos.y;
    const playerBottom = playerTop + this.player.height;
    const isCrouching = this.player.isCrouching;
    const INSET = 4;

    return this.level.obstacles
      .filter(o => o.kind === 'choiceObstacle' && !o.fireballDestroyed)
      .some(c => {
        const cx = c.currentX ?? c.x;
        const cw = c.currentWidth ?? c.width;
        const ch = c.currentHeight ?? c.height;
        const barBottom = this.level.groundY - ch;

        // Jump counter: spike extension grows upward from barTop.
        const spikeExt = (c.trapType === 'adaptiveChoiceGateJump')
          ? (c.currentSpikeExt ?? 0)
          : 0;
        const spikeBaseY = barBottom - CHOICE_BAR_THICKNESS; // top of the bar = base of spikes
        const barTop = spikeBaseY - spikeExt;                // tip of spikes

        // Crouch counter (bar drops to floor): crouching players are NOT safe — must jump.
        const crouchCounterTriggered =
          c.trapType === 'adaptiveChoiceGateCrouch' &&
          (c.trapState === 'triggered' || c.trapState === 'spent') &&
          ch <= 6;
        if (isCrouching && !crouchCounterTriggered) return false;

        // Bar region: solid rectangle collision
        const inBarZone = playerBottom > spikeBaseY && playerTop < barBottom;
        if (inBarZone && pr > cx && pl < cx + cw) return true;

        // Spike zone: per-spike triangle collision (matches drawJumpBlockerSpikes exactly)
        if (spikeExt > 1 && playerBottom > barTop && playerTop < spikeBaseY) {
          const SPIKE_W = 14;
          const PITCH   = 20;
          const EDGE_PAD = 8;
          const spikeCount = Math.max(1, Math.floor((cw - EDGE_PAD * 2 + (PITCH - SPIKE_W)) / PITCH));
          const totalW = (spikeCount - 1) * PITCH + SPIKE_W;
          const startX = cx + (cw - totalW) / 2;
          const pb = Math.min(playerBottom, spikeBaseY);
          const t = Math.min(1, (pb - barTop) / spikeExt);
          for (let i = 0; i < spikeCount; i++) {
            const tipX = startX + i * PITCH + SPIKE_W / 2;
            const halfW = (SPIKE_W / 2) * t;
            if (pr - INSET > tipX - halfW && pl + INSET < tipX + halfW) return true;
          }
        }

        return false;
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
      (o): o is Obstacle & { kind: 'lowCeiling' } => o.kind === 'lowCeiling' && !o.fireballDestroyed
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
      if (o.fireballDestroyed) continue;
      if (o.trapType === 'collapsingPlatform' && o.trapState === 'spent') continue;
      if (o.disappearState === 'invisible') continue;
      if (o.aiModifier === 'droppingPlatform' && (o.aiModState === 'dropping' || o.aiModState === 'invisible')) continue;
      if (o.aiModifier === 'crumblePlatform' && (o.aiModState === 'dropping' || o.aiModState === 'invisible')) continue;
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
      if (o.fireballDestroyed) continue;
      if (o.trapType === 'collapsingPlatform' && o.trapState === 'spent') continue;
      if (o.disappearState === 'invisible') continue;
      if (o.aiModifier === 'droppingPlatform' && (o.aiModState === 'dropping' || o.aiModState === 'invisible')) continue;
      if (o.aiModifier === 'crumblePlatform' && (o.aiModState === 'dropping' || o.aiModState === 'invisible')) continue;
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
      if (o.fireballDestroyed) continue;
      if (o.trapType === 'collapsingPlatform' && o.trapState === 'spent') continue;
      if (o.disappearState === 'invisible') continue;
      if (o.aiModifier === 'droppingPlatform' && (o.aiModState === 'dropping' || o.aiModState === 'invisible')) continue;
      if (o.aiModifier === 'crumblePlatform' && (o.aiModState === 'dropping' || o.aiModState === 'invisible')) continue;
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
        } else if (p.disappearMode === 'onApproach') {
          const triggerDist = p.approachTriggerPx ?? 300;
          const warnDist = triggerDist + 180;
          const platCenterX = (p.currentX ?? p.x) + p.width / 2;
          const playerX = player.pos.x + player.width / 2;
          const dist = platCenterX - playerX; // positive = platform is ahead of player
          if (dist > 0 && dist <= warnDist) {
            p.approachWarning = true;
          } else {
            p.approachWarning = false;
          }
          if (dist > 0 && dist <= triggerDist) {
            p.disappearState = 'disappearing';
            p.disappearTimer = 0;
            p.approachWarning = false;
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

        case 'patrollingHazard': {
          const speed = (o.patrolSpeed ?? PATROL_SPEED_DEFAULT) * (o.patrolDir ?? 1);
          o.currentX = (o.currentX ?? o.x) + speed * dt;
          const minX = o.patrolMinX ?? (o.x - 80);
          const maxX = o.patrolMaxX ?? (o.x + 80);
          if ((o.patrolDir ?? 1) > 0 && o.currentX >= maxX) {
            o.currentX = maxX;
            o.patrolDir = -1;
          } else if ((o.patrolDir ?? 1) < 0 && o.currentX <= minX) {
            o.currentX = minX;
            o.patrolDir = 1;
          }
          break;
        }

        case 'crumblePlatform': {
          if (o.aiModState === 'inactive' || o.aiModState === undefined) {
            const onIt = isPlayerOnPlatform(o, this.player.pos.x, this.player.pos.y, this.player.width, this.player.height, this.level.groundY);
            if (onIt) { o.aiModState = 'warning'; o.aiModTimer = 0; }
          } else if (o.aiModState === 'warning') {
            if (t >= CRUMBLE_WARNING_MS) { o.aiModState = 'dropping'; o.aiModTimer = 0; o.aiModDropOffset = 0; }
          } else if (o.aiModState === 'dropping') {
            const fallSpeed = (o.height + 100) / (CRUMBLE_FALL_MS / 1000);
            o.aiModDropOffset = (o.aiModDropOffset ?? 0) + fallSpeed * dt;
            if (t >= CRUMBLE_FALL_MS) { o.aiModState = 'invisible'; o.aiModTimer = 0; }
          } else if (o.aiModState === 'invisible') {
            if (t >= CRUMBLE_INVISIBLE_MS) { o.aiModState = 'spawning'; o.aiModTimer = 0; o.aiModDropOffset = o.height + 100; }
          } else if (o.aiModState === 'spawning') {
            const fullOff = o.height + 100;
            o.aiModDropOffset = fullOff * Math.max(0, 1 - t / CRUMBLE_SPAWN_MS);
            if (t >= CRUMBLE_SPAWN_MS) { o.aiModState = 'inactive'; o.aiModTimer = 0; o.aiModDropOffset = 0; }
          }
          break;
        }
      }
    }
  }

  private updateElectricFields(dt: number): void {
    const dtMs = dt * 1000;
    for (const o of this.level.obstacles) {
      if (o.kind !== 'electricField') continue;
      o.aiModTimer = (o.aiModTimer ?? 0) + dtMs;
      const t = o.aiModTimer;
      if (!o.aiModState || o.aiModState === 'inactive') {
        if (t >= ELECTRIC_INACTIVE_MS) { o.aiModState = 'warning'; o.aiModTimer = 0; }
      } else if (o.aiModState === 'warning') {
        if (t >= ELECTRIC_WARNING_MS) { o.aiModState = 'active'; o.aiModTimer = 0; }
      } else if (o.aiModState === 'active') {
        if (t >= ELECTRIC_ACTIVE_MS) { o.aiModState = 'inactive'; o.aiModTimer = 0; }
      }
    }
  }

  private updateCrusherCeilings(dt: number): void {
    const dtMs = dt * 1000;
    for (const o of this.level.obstacles) {
      if (o.kind !== 'crusherCeiling') continue;
      o.aiModTimer = (o.aiModTimer ?? 0) + dtMs;
      const t = o.aiModTimer;
      if (!o.aiModState || o.aiModState === 'inactive') {
        o.aiModVisualHeight = o.height;
        if (t >= CRUSHER_RAISED_MS) { o.aiModState = 'warning'; o.aiModTimer = 0; }
      } else if (o.aiModState === 'warning') {
        o.aiModVisualHeight = o.height;
        if (t >= CRUSHER_WARNING_MS) { o.aiModState = 'crushing'; o.aiModTimer = 0; }
      } else if (o.aiModState === 'crushing') {
        const progress = Math.min(1, t / CRUSHER_CRUSHING_MS);
        o.aiModVisualHeight = o.height + (CRUSHER_LOWERED_H - o.height) * progress;
        if (t >= CRUSHER_CRUSHING_MS) { o.aiModState = 'active'; o.aiModTimer = 0; o.aiModVisualHeight = CRUSHER_LOWERED_H; }
      } else if (o.aiModState === 'active') {
        o.aiModVisualHeight = CRUSHER_LOWERED_H;
        if (t >= CRUSHER_LOWERED_MS) { o.aiModState = 'retracting'; o.aiModTimer = 0; }
      } else if (o.aiModState === 'retracting') {
        const progress = Math.min(1, t / CRUSHER_RAISING_MS);
        o.aiModVisualHeight = CRUSHER_LOWERED_H + (o.height - CRUSHER_LOWERED_H) * progress;
        if (t >= CRUSHER_RAISING_MS) { o.aiModState = 'inactive'; o.aiModTimer = 0; o.aiModVisualHeight = o.height; }
      }
    }
  }

  private hitElectricField(): boolean {
    const pl = this.player.pos.x;
    const pr = pl + this.player.width;
    const pb = this.player.pos.y + this.player.height;
    const pt = this.player.pos.y;
    const groundY = this.level.groundY;
    return this.level.obstacles
      .filter(o => o.kind === 'electricField' && o.aiModState === 'active' && !o.fireballDestroyed)
      .some(ef => {
        const ex = ef.x;
        const ew = ef.width;
        const fieldTop = groundY - ef.height;
        return pr > ex && pl < ex + ew && pb > fieldTop && pt < groundY;
      });
  }

  private hitCrusherCeiling(): boolean {
    const px = this.player.pos.x;
    const pr = px + this.player.width;
    const pt = this.player.pos.y;
    const pb = pt + this.player.height;
    const groundY = this.level.groundY;
    const CEIL_THICKNESS = 16;
    return this.level.obstacles
      .filter(o => o.kind === 'crusherCeiling' && o.aiModState === 'active' && !o.fireballDestroyed)
      .some(c => {
        const clearance = CRUSHER_LOWERED_H;
        const slabTop = groundY - clearance - CEIL_THICKNESS;
        const slabBottom = groundY - clearance;
        const xOverlap = pr > c.x && px < c.x + c.width;
        const yOverlap = pb > slabTop && pt < slabBottom;
        return xOverlap && yOverlap;
      });
  }

  private triggerDeath(reason: 'spike' | 'gap', deathX: number) {
    if (reason === 'spike' && this.activeBoosts.has('shield') && !this.consumedShield) {
      this.consumedShield = true;
      this.invincibleUntilMs = performance.now() + 1000;
      this.showAIMessage('Shield!');
      return;
    }

    if (this.gameMode === 'infinite') {
      // Infinite mode death: update best score then show overlay
      this.infiniteBestScore = Math.max(this.infiniteBestScore, this.infiniteRunScore);
      this.saveInfiniteBest();
      this.tracker.finishRun(false, reason, deathX);
      this.refreshPlayerModel();
      this.audio.playDeath();
      this.audio.stopMusic();
      this.state = 'dead';
      this.deathTimer = 0;
      this.syncUiVisibility();
      return;
    }

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
    this.persistProgressIfSignedIn();
    this.audio.playDeath();
    this.audio.stopMusic();
    this.state = 'dead';
    this.deathTimer = 0;
    this.syncUiVisibility();
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

  private activateEquippedAbility() {
    if (this.equippedAbility === 'fireball') {
      if (this.fireballUsed) return; // one per life — silently ignore re-press
      this.fireballUsed = true;
      const cx = this.player.pos.x + this.player.width; // launch from player front
      const cy = this.player.pos.y + this.player.height * 0.45; // mid-torso height
      this.fireball = new Fireball(cx, cy);
      this.updateAbilityHudBadge();
    } else if (this.equippedAbility === 'phase') {
      this.tryActivatePhase();
    } else if (this.equippedAbility === 'timeWarp') {
      if (this.timeWarpUsed) return;
      this.timeWarpUsed = true;
      this.timeWarpActive = true;
      this.timeWarpTimeLeft = TIME_WARP_DURATION;
      this.updateAbilityHudBadge();
    }
  }

  private hazardsWouldKillAt(px: number, pyTop: number): boolean {
    const ox = this.player.pos.x;
    const oy = this.player.pos.y;
    this.player.pos.x = px;
    this.player.pos.y = pyTop;
    const dead =
      this.hitSpike() ||
      this.hitPlatformNeedle() ||
      this.hitLowCeiling() ||
      this.hitChoiceObstacle() ||
      this.hitElectricField() ||
      this.hitCrusherCeiling();
    this.player.pos.x = ox;
    this.player.pos.y = oy;
    return dead;
  }

  /** Solid AABB overlap for airborne phase destinations (platform slabs + low-ceiling mass). */
  private playerBodyOverlapsSolid(px: number, pyTop: number, w: number, h: number): boolean {
    const pl = px + SUPPORT_EDGE_INSET;
    const pr = px + w - SUPPORT_EDGE_INSET;
    const pt = pyTop;
    const pb = pyTop + h;
    const groundY = this.level.groundY;

    for (const o of this.level.obstacles) {
      if (o.kind === 'platform' && o.solid) {
        if (o.fireballDestroyed) continue;
        if (o.trapType === 'collapsingPlatform' && o.trapState === 'spent') continue;
        if (o.disappearState === 'invisible') continue;
        if (o.aiModifier === 'droppingPlatform' && (o.aiModState === 'dropping' || o.aiModState === 'invisible')) continue;
        if (o.aiModifier === 'crumblePlatform' && (o.aiModState === 'dropping' || o.aiModState === 'invisible')) continue;
        if (o.aiModifier === 'temporaryBlocker' && o.aiModState === 'active') continue;

        const ox = o.currentX ?? o.x;
        const ow = o.currentWidth ?? o.width;
        const oh = o.currentHeight ?? o.height;
        const platformTop = groundY - oh;
        const platformBottom = platformTop + 16;
        const xOverlap = pr > ox && pl < ox + ow;
        const yOverlap = pb > platformTop && pt < platformBottom;
        if (xOverlap && yOverlap) return true;
      }

      if (o.kind === 'lowCeiling' && !o.fireballDestroyed) {
        const cx = o.currentX ?? o.x;
        const cw = o.currentWidth ?? o.width;
        const ch = o.currentHeight ?? o.height;
        const slabTop = groundY - ch - LOW_CEILING_THICKNESS;
        const slabBottom = groundY - ch;
        const xOverlap = pr > cx && pl < cx + cw;
        const yOverlap = pb > slabTop && pt < slabBottom;
        if (xOverlap && yOverlap) return true;
      }
    }
    return false;
  }

  private tryActivatePhase() {
    if (this.phaseUsed) return;
    const p = this.player;
    const fromX = p.pos.x;
    const fromY = p.pos.y;
    const airborne = !p.onGround;
    const debugInfo: PhaseDebugInfo = {
      reason: 'noCandidates',
      candidateCount: 0,
      candidateKinds: [],
      candidateAttempts: [],
      airborne,
      playerX: p.pos.x,
      playerY: p.pos.y,
      playerOnGround: p.onGround,
    };
    const res = resolvePhaseRelocation(
      this.level.obstacles,
      this.level.groundY,
      this.level.flagX,
      this.level.worldWidth,
      p.pos.x,
      p.pos.y,
      p.width,
      p.height,
      p.pos.x + p.width,
      airborne,
      (pl, pr, pb, vy) => this.getEffectiveFloor(pl, pr, pb, vy),
      (px, pyTop) => this.hazardsWouldKillAt(px, pyTop),
      (px, pyTop, w, h) => this.playerBodyOverlapsSolid(px, pyTop, w, h),
      p.getHorizontalSpeed(),
      debugInfo,
    );
    this.debugPanel.setLastPhaseDebug(debugInfo);
    if (!res) {
      this.phaseDenyFx = {
        age: 0,
        x: fromX + p.width / 2,
        y: fromY + p.height / 2,
      };
      this.audio.playPhaseDenied();
      return;
    }
    this.phaseUsed = true;
    p.pos.x = res.x;
    p.pos.y = res.y;
    if (!airborne) {
      p.vel.y = 0;
      p.onGround = true;
    } else {
      p.onGround = false;
    }
    this.phaseFx = {
      age: 0,
      fromX,
      fromY,
      toX: res.x,
      toY: res.y,
      playerH: p.height,
      crouch: p.isCrouching,
    };
    this.audio.playPhase();
    this.updateAbilityHudBadge();
  }

  private updateFireball(dt: number) {
    if (!this.fireball) return;
    const fb = this.fireball;
    fb.update(dt, this.level.obstacles, this.level.groundY);

    // Obstacle destruction is non-permanent: fireballDestroyed flag set on the obstacle,
    // cleared on respawn so nothing is permanently removed from the level.

    // Clean up fully expired fireball
    if (!fb.isRenderable) {
      this.fireball = null;
    }
  }

  private draw() {
    this.renderer.drawBackground(this.cameraX);
    const obstaclePulse = this.level.index > 0
      ? Math.max(0, 1 - this.levelAgeSec / LEVEL_HIGHLIGHT_SECS)
      : 0;
    const showFlag = this.state !== 'menu' && this.state !== 'countdown';
    this.renderer.drawLevel(this.level, this.cameraX, obstaclePulse, showFlag);
    if (this.hasSpawnedPlayer) {
      const isInvincible = this.invincibleUntilMs !== null && performance.now() < this.invincibleUntilMs;
      this.renderer.drawPlayer(this.player, this.cameraX, this.state === 'dead', this.equippedSkin, isInvincible);
      if (this.phaseFx) {
        this.renderer.drawPhaseEffect(this.phaseFx, this.cameraX, this.equippedSkin);
      }
      if (this.phaseDenyFx) {
        this.renderer.drawPhaseDeny(this.phaseDenyFx, this.cameraX);
      }
    }
    // Draw fireball + hit effect (Level Mode only — fireball is null during infinite)
    if (this.fireball) {
      if (this.fireball.alive) {
        this.renderer.drawFireball(this.fireball, this.cameraX);
      }
      if (this.fireball.hitEffect) {
        this.renderer.drawFireballHitEffect(this.fireball.hitEffect, this.cameraX);
      }
    }
    if (this.state !== 'menu' && this.hasSpawnedPlayer) {
      if (this.gameMode === 'infinite') {
        this.renderer.drawInfiniteHUD(
          this.infiniteRunScore,
          this.infiniteBestScore,
          this.canvas.width,
          this.canvas.height,
        );
      } else {
        const abilityMeta = this.equippedAbility
          ? ABILITY_CATALOG.find((a) => a.id === this.equippedAbility)
          : undefined;
        const abilityUsed =
          (this.fireballUsed && this.equippedAbility === 'fireball') ||
          (this.phaseUsed && this.equippedAbility === 'phase') ||
          (this.timeWarpUsed && this.equippedAbility === 'timeWarp' && !this.timeWarpActive);
        this.renderer.drawHUD(
          this.player.pos.x,
          this.level.flagX,
          this.canvas.width,
          this.canvas.height,
          this.levelIndex + 1,
          this.attempts,
          abilityMeta?.label,
          abilityUsed,
          this.timeWarpActive,
          this.timeWarpTimeLeft,
        );
        if (this.timeWarpActive) {
          const warpProgress = 1 - this.timeWarpTimeLeft / TIME_WARP_DURATION;
          this.renderer.drawTimeWarpOverlay(this.canvas.width, this.canvas.height, warpProgress, this.levelAgeSec);
        }
      }
    }

    if (this.state === 'dead') {
      // Infinite mode shows an HTML overlay instead of the canvas death overlay
      if (this.gameMode === 'levels') {
        this.renderer.drawDeathOverlay(this.canvas, this.deathTimer, DEATH_INPUT_DELAY);
      }
    } else if (this.state === 'levelComplete') {
      this.renderer.drawLevelCompleteOverlay(this.canvas, this.levelIndex + 2);
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
