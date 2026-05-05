import { Player } from './player';
import { buildLevel, LevelData, TOTAL_LEVELS } from './level';
import { InputHandler } from './input';
import { Renderer } from './renderer';
import { GameState, Obstacle } from './types';

const SPAWN_X = 80;
const DEATH_INPUT_DELAY = 0.4; // seconds before tap-to-retry accepted after death

export class Game {
  private player!: Player;
  private level!: LevelData;
  private input!: InputHandler;
  private renderer!: Renderer;
  private state: GameState = 'playing';
  private cameraX = 0;
  private lastTime = 0;
  private levelIndex = 0;
  private attempts = 1;
  private deathTimer = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input = new InputHandler(canvas);
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
    this.level.groundY = this.canvas.height - 80;
    this.spawnPlayer();
    this.cameraX = 0;
    this.state = 'playing';
    // AI HOOK (Milestone 3+): record run start time for RunRecord.completionTimeMs
  }

  private restartLevel() {
    this.attempts++;
    this.level.groundY = this.canvas.height - 80;
    this.spawnPlayer();
    this.cameraX = 0;
    this.state = 'playing';
    // AI HOOK (Milestone 3+): record run start time for RunRecord.completionTimeMs
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
      // Reposition player to match new ground if alive
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
    if (this.input.consumeJump()) {
      this.player.jump();
      // AI HOOK (Milestone 3+): record { x: player.pos.x, t: elapsed } into RunRecord.jumps
    }

    const overGap = this.isOverGap();
    this.player.update(dt, this.level.groundY, !overGap);

    // Camera: player stays at ~25% from left
    const targetX = this.player.pos.x - this.canvas.width * 0.25;
    this.cameraX = Math.max(0, Math.min(targetX, this.level.worldWidth - this.canvas.width));

    // Death: fell into gap
    if (this.player.pos.y > this.level.groundY + 60) {
      this.triggerDeath();
      return;
    }

    // Death: spike collision
    if (this.hitSpike()) {
      this.triggerDeath();
      return;
    }

    // Win: reached flag
    if (this.player.pos.x + this.player.width >= this.level.flagX) {
      this.state = 'levelComplete';
      // AI HOOK (Milestone 3+): store completed RunRecord to localStorage
    }
  }

  private isOverGap(): boolean {
    const cx = this.player.pos.x + this.player.width / 2;
    return this.level.obstacles.some(
      o => o.kind === 'gap' && cx >= o.x && cx <= o.x + o.width
    );
  }

  private hitSpike(): boolean {
    const spikes = this.level.obstacles.filter((o): o is Obstacle & { kind: 'spike' } => o.kind === 'spike');
    const px = this.player.pos.x;
    const pr = px + this.player.width;
    const pb = this.player.pos.y + this.player.height;

    return spikes.some(s => {
      const inset = 6; // forgiving hitbox
      const spikeHitTop = this.level.groundY - s.height + 12;
      return px + inset < s.x + s.width - inset && pr - inset > s.x + inset && pb > spikeHitTop;
    });
  }

  private triggerDeath() {
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
  }
}
