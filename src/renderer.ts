import { Player } from './player';
import { LevelData, getGroundSegments } from './level';
import { Obstacle } from './types';

const GROUND_GRASS   = '#5D8A35';
const GROUND_DIRT    = '#8B5E3C';
const SPIKE_COLOR    = '#CC2222';
const SPIKE_SHADOW   = '#881111';
const CEIL_COLOR     = '#7EE7FF';
const CEIL_GLOW      = '#2DA2C4';
const CHOICE_COLOR   = '#A855F7';
const CHOICE_GLOW    = '#7C3AED';
const DOUBLE_SPIKE_GAP = 16; // gap between the two spikes in a doubleSpike

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

  drawLevel(level: LevelData, cameraX: number, placementPulse: number = 0) {
    const { groundY, worldWidth, flagX, obstacles } = level;
    const segments = getGroundSegments(worldWidth, obstacles);

    this.drawGround(segments, groundY, cameraX);
    this.drawObstacles(obstacles, groundY, cameraX, placementPulse, level.index > 0);
    this.drawLandingMarkers(level.aiLandingMarkersX ?? [], groundY, cameraX);
    this.drawFlag(flagX - cameraX, groundY);
  }

  private drawLandingMarkers(markers: number[], groundY: number, cameraX: number) {
    if (markers.length === 0) return;
    const { ctx } = this;

    for (const x of markers) {
      const sx = x - cameraX;
      ctx.strokeStyle = 'rgba(255,255,255,0.34)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(sx, groundY - 90);
      ctx.lineTo(sx, groundY - 16);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.arc(sx, groundY - 96, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawGround(segments: ReturnType<typeof getGroundSegments>, groundY: number, cameraX: number) {
    const { ctx, canvas } = this;
    for (const seg of segments) {
      const sx = seg.x - cameraX;
      ctx.fillStyle = GROUND_GRASS;
      ctx.fillRect(sx, groundY, seg.width, 20);
      ctx.fillStyle = GROUND_DIRT;
      ctx.fillRect(sx, groundY + 20, seg.width, canvas.height - groundY);
    }
  }

  private drawObstacles(
    obstacles: Obstacle[],
    groundY: number,
    cameraX: number,
    pulse: number,
    showAiLabel: boolean,
  ) {
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      if (pulse > 0.02) {
        this.drawObstaclePulse(obs, groundY, cameraX, pulse);
        if (i === 0 && showAiLabel) {
          this.drawAiPlacedLabel(obs, groundY, cameraX, pulse);
        }
      }
      if (obs.kind === 'spike') {
        this.drawSpike(obs, groundY, cameraX);
      } else if (obs.kind === 'doubleSpike') {
        this.drawDoubleSpike(obs, groundY, cameraX);
      } else if (obs.kind === 'lowCeiling') {
        this.drawLowCeiling(obs, groundY, cameraX);
      } else if (obs.kind === 'choiceObstacle') {
        this.drawChoiceObstacle(obs, groundY, cameraX);
      }
      // gaps are rendered by absence of ground — no drawing needed
    }
  }

  private drawObstaclePulse(obs: Obstacle, groundY: number, cameraX: number, pulse: number) {
    const { ctx } = this;
    const alpha = Math.min(0.42, pulse * 0.42);
    const sx = obs.x - cameraX;

    ctx.save();
    ctx.strokeStyle = `rgba(255, 225, 120, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 4]);
    if (obs.kind === 'spike' || obs.kind === 'doubleSpike') {
      const topY = groundY - obs.height - 6;
      ctx.strokeRect(sx - 6, topY, obs.width + 12, obs.height + 12);
    } else if (obs.kind === 'lowCeiling') {
      const thickness = 16;
      const topY = groundY - obs.height - thickness - 6;
      ctx.strokeRect(sx - 6, topY, obs.width + 12, thickness + 12);
    } else if (obs.kind === 'choiceObstacle') {
      const barThickness = 12; // keep in sync with game.ts CHOICE_BAR_THICKNESS
      const topY = groundY - obs.height - barThickness - 6;
      ctx.strokeRect(sx - 6, topY, obs.width + 12, barThickness + 12);
    } else {
      const h = 70;
      ctx.strokeRect(sx - 5, groundY - h, obs.width + 10, h + 8);
    }
    ctx.restore();
  }

  private drawAiPlacedLabel(obs: Obstacle, groundY: number, cameraX: number, pulse: number) {
    const { ctx } = this;
    if (pulse < 0.2) return;
    const sx = obs.x - cameraX + obs.width / 2;
    let y: number;
    if (obs.kind === 'spike' || obs.kind === 'doubleSpike') {
      y = groundY - (obs.height + 26);
    } else if (obs.kind === 'lowCeiling') {
      y = groundY - (obs.height + 44);
    } else if (obs.kind === 'choiceObstacle') {
      y = groundY - (obs.height + 38);
    } else {
      y = groundY - 84;
    }
    const alpha = Math.min(0.9, pulse);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `bold 12px sans-serif`;
    ctx.fillStyle = `rgba(0,0,0,${0.35 * alpha})`;
    ctx.fillText('AI placed here', sx + 1, y + 1);
    ctx.fillStyle = `rgba(255,255,255,${0.9 * alpha})`;
    ctx.fillText('AI placed here', sx, y);
    ctx.restore();
  }

  private drawSpike(obs: Obstacle, groundY: number, cameraX: number) {
    const { ctx } = this;
    const sx = obs.x - cameraX;
    const tipX = sx + obs.width / 2;
    const baseY = groundY + 2; // slightly into ground so it looks planted

    // Shadow
    ctx.fillStyle = SPIKE_SHADOW;
    ctx.beginPath();
    ctx.moveTo(tipX, baseY - obs.height + 6);
    ctx.lineTo(sx + obs.width, baseY);
    ctx.lineTo(sx, baseY);
    ctx.closePath();
    ctx.fill();

    // Main spike
    ctx.fillStyle = SPIKE_COLOR;
    ctx.beginPath();
    ctx.moveTo(tipX, baseY - obs.height);
    ctx.lineTo(sx + obs.width - 4, baseY);
    ctx.lineTo(sx + 4, baseY);
    ctx.closePath();
    ctx.fill();

    // Highlight
    ctx.fillStyle = 'rgba(255,100,100,0.4)';
    ctx.beginPath();
    ctx.moveTo(tipX, baseY - obs.height);
    ctx.lineTo(tipX + 4, baseY - obs.height + 20);
    ctx.lineTo(tipX, baseY - obs.height + 10);
    ctx.closePath();
    ctx.fill();
  }

  private drawDoubleSpike(obs: Obstacle, groundY: number, cameraX: number) {
    const { ctx } = this;
    const sx = obs.x - cameraX;
    const spikeW = (obs.width - DOUBLE_SPIKE_GAP) / 2;
    const baseY = groundY + 2;

    for (let i = 0; i < 2; i++) {
      const left = sx + i * (spikeW + DOUBLE_SPIKE_GAP);
      const tipX = left + spikeW / 2;

      ctx.fillStyle = SPIKE_SHADOW;
      ctx.beginPath();
      ctx.moveTo(tipX, baseY - obs.height + 6);
      ctx.lineTo(left + spikeW, baseY);
      ctx.lineTo(left, baseY);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = SPIKE_COLOR;
      ctx.beginPath();
      ctx.moveTo(tipX, baseY - obs.height);
      ctx.lineTo(left + spikeW - 4, baseY);
      ctx.lineTo(left + 4, baseY);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = 'rgba(255,100,100,0.4)';
      ctx.beginPath();
      ctx.moveTo(tipX, baseY - obs.height);
      ctx.lineTo(tipX + 4, baseY - obs.height + 20);
      ctx.lineTo(tipX, baseY - obs.height + 10);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawChoiceObstacle(obs: Obstacle, groundY: number, cameraX: number) {
    const { ctx } = this;
    const sx = obs.x - cameraX;
    const barThickness = 12; // keep in sync with game.ts CHOICE_BAR_THICKNESS
    const topY = groundY - obs.height - barThickness;

    ctx.fillStyle = CHOICE_COLOR;
    ctx.fillRect(sx, topY, obs.width, barThickness);

    ctx.fillStyle = CHOICE_GLOW;
    ctx.fillRect(sx + 4, topY + 4, obs.width - 8, 3);

    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, topY + 0.5, obs.width - 1, barThickness - 1);
  }

  private drawLowCeiling(obs: Obstacle, groundY: number, cameraX: number) {
    const { ctx } = this;
    const sx = obs.x - cameraX;
    const thickness = 16;
    const topY = groundY - obs.height - thickness;

    ctx.fillStyle = CEIL_COLOR;
    ctx.fillRect(sx, topY, obs.width, thickness);

    ctx.fillStyle = CEIL_GLOW;
    ctx.fillRect(sx + 4, topY + 4, obs.width - 8, 3);

    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, topY + 0.5, obs.width - 1, thickness - 1);
  }

  private drawFlag(screenX: number, groundY: number) {
    const { ctx } = this;
    const poleH = 90;
    ctx.fillStyle = '#999';
    ctx.fillRect(screenX, groundY - poleH, 5, poleH);
    ctx.fillStyle = '#FF3B3B';
    ctx.beginPath();
    ctx.moveTo(screenX + 5, groundY - poleH);
    ctx.lineTo(screenX + 42, groundY - poleH + 18);
    ctx.lineTo(screenX + 5, groundY - poleH + 36);
    ctx.closePath();
    ctx.fill();
  }

  drawPlayer(player: Player, cameraX: number, isDead: boolean) {
    const { ctx } = this;
    const sx = player.pos.x - cameraX;
    const sy = player.pos.y;

    if (isDead) {
      ctx.globalAlpha = 0.4;
    }

    ctx.fillStyle = '#4A90E2';
    ctx.fillRect(sx, sy, player.width, player.height);
    ctx.fillStyle = '#6AAFF5';
    ctx.fillRect(sx + 2, sy + 2, player.width - 4, Math.min(14, player.height - 6));

    if (player.isCrouching) {
      ctx.fillStyle = '#A9E4FF';
      ctx.fillRect(sx + 5, sy + 8, player.width - 10, 5);
      ctx.fillStyle = '#16364A';
      ctx.fillRect(sx + 7, sy + 16, player.width - 14, 4);
    } else {
      ctx.fillStyle = 'white';
      ctx.fillRect(sx + 16, sy + 8, 12, 10);
      ctx.fillStyle = '#111';
      ctx.fillRect(sx + 20, sy + 11, 6, 6);
    }

    ctx.globalAlpha = 1;
  }

  drawHUD(
    playerX: number,
    flagX: number,
    canvasW: number,
    canvasH: number,
    levelNum: number,
    attempts: number,
  ) {
    const { ctx } = this;
    const fs = Math.min(18, canvasW / 22);

    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(`Level ${levelNum}`, 16, 36);
    ctx.fillStyle = 'white';
    ctx.fillText(`Level ${levelNum}`, 15, 35);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(`Attempts: ${attempts}`, canvasW - 14, 36);
    ctx.fillStyle = 'white';
    ctx.fillText(`Attempts: ${attempts}`, canvasW - 15, 35);

    // Progress bar — center top
    const pct = Math.min(playerX / flagX, 1);
    const barW = canvasW * 0.4;
    const barX = (canvasW - barW) / 2;
    const barY = 18;
    const barH = 8;

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(barX, barY, barW * pct, barH);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    // Jump hint — level 1 only, bottom center
    if (levelNum === 1) {
      ctx.textAlign = 'center';
      ctx.font = `${Math.min(15, canvasW / 26)}px sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillText('Tap to jump • Hold to crouch', canvasW / 2, canvasH - 20);
    }
  }

  drawDeathOverlay(canvas: HTMLCanvasElement, timer: number, delay: number) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(180,0,0,0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    ctx.textAlign = 'center';

    ctx.fillStyle = 'white';
    ctx.font = `bold ${Math.min(46, canvas.width / 8)}px sans-serif`;
    ctx.fillText('Oops!', cx, cy - 20);

    const ready = timer >= delay;
    ctx.font = `${Math.min(20, canvas.width / 19)}px sans-serif`;
    ctx.fillStyle = ready ? 'white' : 'rgba(255,255,255,0.45)';
    ctx.fillText(ready ? 'Tap to try again' : '...', cx, cy + 22);
  }

  drawLevelCompleteOverlay(canvas: HTMLCanvasElement, nextLevelNum: number) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    ctx.textAlign = 'center';

    ctx.fillStyle = '#FFD700';
    ctx.font = `bold ${Math.min(46, canvas.width / 7)}px sans-serif`;
    ctx.fillText('Level Clear!', cx, cy - 24);

    ctx.fillStyle = 'white';
    ctx.font = `${Math.min(20, canvas.width / 19)}px sans-serif`;
    ctx.fillText(`Tap for Level ${nextLevelNum}`, cx, cy + 24);
  }

  drawAIGameMasterMessage(message: string, alpha: number) {
    if (!message) return;
    const { ctx, canvas } = this;
    const boxW = Math.min(canvas.width - 24, 520);
    const boxH = 44;
    const x = (canvas.width - boxW) / 2;
    const y = 56;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.46)';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.strokeRect(x, y, boxW, boxH);

    ctx.textAlign = 'center';
    ctx.font = `600 ${Math.min(16, canvas.width / 22)}px sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText(message, canvas.width / 2, y + 28);
    ctx.restore();
  }

}
