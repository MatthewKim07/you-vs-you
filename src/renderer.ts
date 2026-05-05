import { Player } from './player';
import { Level } from './level';

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
  }

  drawBackground() {
    const { ctx, canvas } = this;
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, '#87CEEB');
    grad.addColorStop(1, '#D0EEFF');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  drawLevel(level: Level, cameraX: number) {
    const { ctx, canvas } = this;
    const { groundY, worldWidth, flagX } = level;

    // Grass top
    ctx.fillStyle = '#5D8A35';
    ctx.fillRect(-cameraX, groundY, worldWidth, 20);

    // Dirt body
    ctx.fillStyle = '#8B5E3C';
    ctx.fillRect(-cameraX, groundY + 20, worldWidth, canvas.height - groundY);

    // Flag pole
    const flagScreenX = flagX - cameraX;
    this.drawFlag(flagScreenX, groundY);

    // AI HOOK (Milestone 2+): drawObstacles(level.obstacles, cameraX)
  }

  private drawFlag(screenX: number, groundY: number) {
    const { ctx } = this;
    const poleH = 90;

    ctx.fillStyle = '#999';
    ctx.fillRect(screenX, groundY - poleH, 5, poleH);

    ctx.fillStyle = '#FF3B3B';
    ctx.beginPath();
    ctx.moveTo(screenX + 5, groundY - poleH);
    ctx.lineTo(screenX + 40, groundY - poleH + 18);
    ctx.lineTo(screenX + 5, groundY - poleH + 36);
    ctx.closePath();
    ctx.fill();
  }

  drawPlayer(player: Player, cameraX: number) {
    const { ctx } = this;
    const sx = player.pos.x - cameraX;
    const sy = player.pos.y;

    // Body
    ctx.fillStyle = '#4A90E2';
    ctx.fillRect(sx, sy, player.width, player.height);

    // Face highlight
    ctx.fillStyle = '#6AAFF5';
    ctx.fillRect(sx + 2, sy + 2, player.width - 4, 14);

    // Eye
    ctx.fillStyle = 'white';
    ctx.fillRect(sx + 16, sy + 8, 12, 10);
    ctx.fillStyle = '#111';
    ctx.fillRect(sx + 20, sy + 11, 6, 6);
  }

  drawWinOverlay(canvas: HTMLCanvasElement) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFD700';
    ctx.font = `bold ${Math.min(52, canvas.width / 7)}px sans-serif`;
    ctx.fillText('You Win!', cx, cy - 24);

    ctx.fillStyle = 'white';
    ctx.font = `${Math.min(22, canvas.width / 18)}px sans-serif`;
    ctx.fillText('Tap or press Space to restart', cx, cy + 24);
  }

  drawHUD(playerX: number, flagX: number, canvasWidth: number) {
    const { ctx } = this;
    const pct = Math.min(playerX / flagX, 1);
    const barW = canvasWidth * 0.5;
    const barX = (canvasWidth - barW) / 2;
    const barY = 16;
    const barH = 10;

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(barX, barY, barW, barH);

    ctx.fillStyle = '#FFD700';
    ctx.fillRect(barX, barY, barW * pct, barH);

    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);
  }
}
