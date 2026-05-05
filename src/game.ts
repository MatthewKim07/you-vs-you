import { Player } from './player';
import { Level, createLevel } from './level';
import { InputHandler } from './input';
import { Renderer } from './renderer';
import { GameState } from './types';

export class Game {
  private player!: Player;
  private level!: Level;
  private input!: InputHandler;
  private renderer!: Renderer;
  private state: GameState = 'playing';
  private cameraX = 0;
  private lastTime = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input = new InputHandler(canvas);
    this.setupResize();
    this.reset();
  }

  private reset() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;

    this.level = createLevel(this.canvas.height);
    const spawnY = this.level.groundY - 48;
    this.player = new Player(80, spawnY);
    this.cameraX = 0;
    this.state = 'playing';

    // AI HOOK (Milestone 2+): pass previous RunRecord to level generator here
  }

  private setupResize() {
    window.addEventListener('resize', () => {
      if (this.state === 'playing') {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.level.groundY = this.canvas.height - 80;
      }
    });
  }

  start() {
    requestAnimationFrame(this.loop);
  }

  private loop = (timestamp: number) => {
    // Cap dt to avoid spiral-of-death on tab blur/focus
    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
    this.lastTime = timestamp;

    this.update(dt);
    this.draw();

    requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    if (this.state === 'win') {
      if (this.input.consumeJump()) this.reset();
      return;
    }

    if (this.input.consumeJump()) {
      this.player.jump();
    }

    this.player.update(dt, this.level.groundY);

    // Camera: keep player at ~25% from left edge
    const targetX = this.player.pos.x - this.canvas.width * 0.25;
    this.cameraX = Math.max(0, Math.min(targetX, this.level.worldWidth - this.canvas.width));

    // Win condition
    if (this.player.pos.x + this.player.width >= this.level.flagX) {
      this.state = 'win';
      // AI HOOK (Milestone 2+): serialize and store RunRecord to localStorage here
    }
  }

  private draw() {
    this.renderer.drawBackground();
    this.renderer.drawLevel(this.level, this.cameraX);
    this.renderer.drawPlayer(this.player, this.cameraX);
    this.renderer.drawHUD(this.player.pos.x, this.level.flagX, this.canvas.width);

    if (this.state === 'win') {
      this.renderer.drawWinOverlay(this.canvas);
    }
  }
}
