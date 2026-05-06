import { Player } from './player';
import { LevelData, getGroundSegments } from './level';
import { Obstacle } from './types';

const TILE = 16;

// Fixed pixel palette (~12 colors)
const P_SKY_TOP    = '#6BA7FF';
const P_SKY_BOT    = '#A8D0FF';
const P_CLOUD      = '#FFFFFF';
const P_CLOUD_SHAD = '#D8EEFF';
const P_GRASS      = '#5B8A3C';
const P_GRASS_LT   = '#74AA50';
const P_DIRT       = '#8B5A2B';
const P_DIRT_DK    = '#6B4020';
const P_PLAT       = '#C97E3A';
const P_PLAT_DK    = '#8B5520';
const P_SPIKE      = '#FF4D4D';
const P_SPIKE_DK   = '#CC2200';
const P_CEIL       = '#4A5568';
const P_CEIL_DK    = '#2D3748';
const P_CEIL_LT    = '#6A7A92';
const P_CHOICE     = '#A855F7';
const P_CHOICE_DK  = '#7C3AED';
const P_PLYR_HAT   = '#F2C94C';
const P_PLYR       = '#4A90E2';
const P_PLYR_DK    = '#2A6AB0';

const DOUBLE_SPIKE_GAP = 16; // keep in sync with original
const CEIL_THICKNESS   = 16; // keep in sync with game.ts LOW_CEILING_THICKNESS
const CHOICE_THICKNESS = 12; // keep in sync with game.ts CHOICE_BAR_THICKNESS
const CLOUD_PERIOD     = 1400;
const PIXEL_FONT       = "'Press Start 2P', monospace";

function px(v: number): number {
  return Math.round(v);
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
  }

  private get W() { return this.canvas.width; }
  private get H() { return this.canvas.height; }

  drawBackground(cameraX: number = 0) {
    const { ctx } = this;
    ctx.imageSmoothingEnabled = false;

    // Two-tone sky (no gradient = pixel aesthetic)
    const skyMid = px(this.H * 0.52);
    ctx.fillStyle = P_SKY_TOP;
    ctx.fillRect(0, 0, this.W, skyMid);
    ctx.fillStyle = P_SKY_BOT;
    ctx.fillRect(0, skyMid, this.W, this.H - skyMid);

    this.drawClouds(cameraX);
  }

  private drawClouds(cameraX: number) {
    const { ctx } = this;
    // Cloud world-x values within one CLOUD_PERIOD tile
    const defs = [
      { wx: 100, y: 42,  w: 80,  h: 28 },
      { wx: 380, y: 72,  w: 64,  h: 22 },
      { wx: 620, y: 36,  w: 96,  h: 32 },
      { wx: 900, y: 58,  w: 72,  h: 26 },
      { wx: 1180, y: 46, w: 88,  h: 30 },
    ];
    for (const c of defs) {
      const parallaxX = c.wx - cameraX * 0.2;
      const t0 = Math.floor(-parallaxX / CLOUD_PERIOD) - 1;
      const t1 = Math.ceil((this.W - parallaxX) / CLOUD_PERIOD) + 1;
      for (let t = t0; t <= t1; t++) {
        const sx = px(parallaxX + t * CLOUD_PERIOD);
        if (sx + c.w < 0 || sx > this.W) continue;
        this.drawCloud(sx, c.y, c.w, c.h);
      }
    }
    ctx; // keep linter happy
  }

  private drawCloud(sx: number, sy: number, w: number, h: number) {
    const { ctx } = this;
    const h3 = px(h * 0.35);
    ctx.fillStyle = P_CLOUD;
    ctx.fillRect(sx,              sy + h3, w,             h - h3);        // base
    ctx.fillRect(sx + px(w*0.08), sy,      px(w * 0.3),   h3 + 4);        // left bump
    ctx.fillRect(sx + px(w*0.34), sy - 4,  px(w * 0.3),   h3 + 6);        // center bump
    ctx.fillRect(sx + px(w*0.62), sy + 4,  px(w * 0.27),  h3 + 2);        // right bump
    ctx.fillStyle = P_CLOUD_SHAD;
    ctx.fillRect(sx + 4,          sy + h - px(h*0.3), w - 8, px(h*0.3));  // bottom shadow
  }

  drawLevel(level: LevelData, cameraX: number, placementPulse: number = 0, showFlag: boolean = true) {
    const { groundY, worldWidth, flagX, obstacles } = level;
    const segments = getGroundSegments(worldWidth, obstacles);

    this.drawGround(segments, groundY, cameraX);
    this.drawObstacles(obstacles, groundY, cameraX, placementPulse, level.index > 0);
    this.drawLandingMarkers(level.aiLandingMarkersX ?? [], groundY, cameraX);
    if (showFlag) this.drawFlag(flagX - cameraX, groundY);
  }

  private drawLandingMarkers(markers: number[], groundY: number, cameraX: number) {
    if (markers.length === 0) return;
    const { ctx } = this;
    for (const x of markers) {
      const sx = px(x - cameraX);
      ctx.strokeStyle = 'rgba(255,255,255,0.34)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sx, groundY - 90);
      ctx.lineTo(sx, groundY - 16);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(sx - 2, groundY - 96, 4, 4);
    }
  }

  // Tiling brick/block fill. All positions world-aligned so camera panning never shifts the pattern.
  private drawBricks(
    sx: number, y: number, w: number, h: number,
    worldX: number, cameraX: number,
    brickColor: string, mortarColor: string,
    brickW = 24, brickH = 8,
  ) {
    const { ctx } = this;
    const mW = 1; // mortar width
    const mH = 1; // mortar height
    const colPitch = brickW + mW;
    const rowPitch = brickH + mH;

    ctx.fillStyle = mortarColor;
    ctx.fillRect(sx, y, w, h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, y, w, h);
    ctx.clip();

    ctx.fillStyle = brickColor;
    const totalRows = Math.ceil(h / rowPitch) + 1;
    for (let row = 0; row <= totalRows; row++) {
      const ry = y + row * rowPitch;
      const rowOff = (row % 2 === 0) ? 0 : Math.floor(colPitch / 2);
      // World-aligned first brick for this row
      const n0 = Math.floor((worldX - rowOff) / colPitch);
      let bx = n0 * colPitch + rowOff;
      while (bx < worldX + w + colPitch) {
        ctx.fillRect(px(bx - cameraX) + mW, ry + mH, brickW, brickH);
        bx += colPitch;
      }
    }
    ctx.restore();
  }

  private drawGround(segments: ReturnType<typeof getGroundSegments>, groundY: number, cameraX: number) {
    const { ctx } = this;
    const grassH = 4;

    for (const seg of segments) {
      const sx = px(seg.x - cameraX);
      const sw = px(seg.width);
      const dirtY = px(groundY) + grassH;
      const dirtH = this.H - dirtY + 10;

      this.drawBricks(sx, dirtY, sw, dirtH, seg.x, cameraX, P_DIRT, P_DIRT_DK);

      // Grass strip on top (drawn after bricks so it overlaps cleanly)
      ctx.fillStyle = P_GRASS;
      ctx.fillRect(sx, px(groundY), sw, grassH);
      ctx.fillStyle = P_GRASS_LT;
      ctx.fillRect(sx, px(groundY), sw, 2); // highlight
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
        if (i === 0 && showAiLabel) this.drawAiPlacedLabel(obs, groundY, cameraX, pulse);
      }
      if      (obs.kind === 'spike')          this.drawSpike(obs, groundY, cameraX);
      else if (obs.kind === 'doubleSpike')    this.drawDoubleSpike(obs, groundY, cameraX);
      else if (obs.kind === 'lowCeiling')     this.drawLowCeiling(obs, groundY, cameraX);
      else if (obs.kind === 'choiceObstacle') this.drawChoiceObstacle(obs, groundY, cameraX);
      else if (obs.kind === 'platform')       this.drawPlatform(obs, groundY, cameraX);
      // gaps = empty ground — no draw needed
    }
  }

  private drawObstaclePulse(obs: Obstacle, groundY: number, cameraX: number, pulse: number) {
    const { ctx } = this;
    const alpha = Math.min(0.42, pulse * 0.42);
    const sx = px(obs.x - cameraX);

    ctx.save();
    ctx.strokeStyle = `rgba(255,225,120,${alpha})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    if (obs.kind === 'spike' || obs.kind === 'doubleSpike') {
      ctx.strokeRect(sx - 6, groundY - obs.height - 6, obs.width + 12, obs.height + 12);
    } else if (obs.kind === 'lowCeiling') {
      ctx.strokeRect(sx - 6, groundY - obs.height - CEIL_THICKNESS - 6, obs.width + 12, CEIL_THICKNESS + 12);
    } else if (obs.kind === 'choiceObstacle') {
      ctx.strokeRect(sx - 6, groundY - obs.height - CHOICE_THICKNESS - 6, obs.width + 12, CHOICE_THICKNESS + 12);
    } else if (obs.kind === 'platform') {
      ctx.strokeRect(sx - 5, groundY - obs.height - 5, obs.width + 10, TILE + 10);
    } else {
      ctx.strokeRect(sx - 5, groundY - 70, obs.width + 10, 78);
    }
    ctx.restore();
  }

  private drawAiPlacedLabel(obs: Obstacle, groundY: number, cameraX: number, pulse: number) {
    const { ctx } = this;
    if (pulse < 0.2) return;
    const sx = px(obs.x - cameraX + obs.width / 2);
    let y: number;
    if (obs.kind === 'spike' || obs.kind === 'doubleSpike')  y = groundY - obs.height - 26;
    else if (obs.kind === 'lowCeiling')                       y = groundY - obs.height - 44;
    else if (obs.kind === 'choiceObstacle')                   y = groundY - obs.height - 38;
    else if (obs.kind === 'platform')                         y = groundY - obs.height - 30;
    else                                                       y = groundY - 84;

    const alpha = Math.min(0.9, pulse);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `bold 10px monospace`;
    ctx.fillStyle = `rgba(0,0,0,${0.35 * alpha})`;
    ctx.fillText('AI PLACED', sx + 1, y + 1);
    ctx.fillStyle = `rgba(255,255,255,${0.9 * alpha})`;
    ctx.fillText('AI PLACED', sx, y);
    ctx.restore();
  }

  private drawSpike(obs: Obstacle, groundY: number, cameraX: number) {
    const { ctx } = this;
    const sx  = px(obs.x - cameraX);
    const baseY = px(groundY + 2);
    const tipX  = px(obs.x - cameraX + obs.width / 2);
    const tipY  = px(groundY - obs.height);

    ctx.fillStyle = P_SPIKE_DK;
    ctx.beginPath();
    ctx.moveTo(tipX + 3, tipY + 8);
    ctx.lineTo(sx + obs.width, baseY);
    ctx.lineTo(sx, baseY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = P_SPIKE;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(sx + obs.width - 3, baseY);
    ctx.lineTo(sx + 3, baseY);
    ctx.closePath();
    ctx.fill();

    // Left-face highlight
    ctx.fillStyle = 'rgba(255,150,150,0.45)';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - 4, tipY + 16);
    ctx.lineTo(sx + 3, baseY);
    ctx.closePath();
    ctx.fill();
  }

  private drawDoubleSpike(obs: Obstacle, groundY: number, cameraX: number) {
    const spikeW = (obs.width - DOUBLE_SPIKE_GAP) / 2;
    const baseY  = px(groundY + 2);

    for (let i = 0; i < 2; i++) {
      const left = px(obs.x - cameraX + i * (spikeW + DOUBLE_SPIKE_GAP));
      const tipX = px(left + spikeW / 2);
      const tipY = px(groundY - obs.height);

      this.ctx.fillStyle = P_SPIKE_DK;
      this.ctx.beginPath();
      this.ctx.moveTo(tipX + 3, tipY + 8);
      this.ctx.lineTo(left + spikeW, baseY);
      this.ctx.lineTo(left, baseY);
      this.ctx.closePath();
      this.ctx.fill();

      this.ctx.fillStyle = P_SPIKE;
      this.ctx.beginPath();
      this.ctx.moveTo(tipX, tipY);
      this.ctx.lineTo(left + spikeW - 3, baseY);
      this.ctx.lineTo(left + 3, baseY);
      this.ctx.closePath();
      this.ctx.fill();

      this.ctx.fillStyle = 'rgba(255,150,150,0.45)';
      this.ctx.beginPath();
      this.ctx.moveTo(tipX, tipY);
      this.ctx.lineTo(tipX - 4, tipY + 16);
      this.ctx.lineTo(left + 3, baseY);
      this.ctx.closePath();
      this.ctx.fill();
    }
  }

  private drawPlatform(obs: Obstacle, groundY: number, cameraX: number) {
    const { ctx } = this;
    const sx       = px(obs.x - cameraX);
    const surfaceY = px(groundY - obs.height);
    const thick    = TILE; // 16px = 1 tile

    // Brick body (below grass strip)
    this.drawBricks(sx, surfaceY + 4, px(obs.width), thick - 4, obs.x, cameraX, P_PLAT, P_PLAT_DK, 20, 10);

    // Grass top
    ctx.fillStyle = P_GRASS;
    ctx.fillRect(sx, surfaceY, px(obs.width), 4);
    ctx.fillStyle = P_GRASS_LT;
    ctx.fillRect(sx, surfaceY, px(obs.width), 2);

    // Edge caps (left/right dark pixels)
    ctx.fillStyle = P_PLAT_DK;
    ctx.fillRect(sx, surfaceY + 4, 2, thick - 4);
    ctx.fillRect(sx + px(obs.width) - 2, surfaceY + 4, 2, thick - 4);
  }

  private drawLowCeiling(obs: Obstacle, groundY: number, cameraX: number) {
    const { ctx } = this;
    const sx   = px(obs.x - cameraX);
    const topY = px(groundY - obs.height - CEIL_THICKNESS);

    // Stone block pattern
    this.drawBricks(sx, topY, px(obs.width), CEIL_THICKNESS, obs.x, cameraX, P_CEIL, P_CEIL_DK, 20, 13);

    // Underside highlight strip
    ctx.fillStyle = P_CEIL_LT;
    ctx.fillRect(sx, topY + CEIL_THICKNESS - 3, px(obs.width), 3);

    // Danger spikes on top surface — signals "can't land/jump on this"
    this.drawTopSpikes(sx, topY, px(obs.width), obs.x, cameraX);
  }

  private drawChoiceObstacle(obs: Obstacle, groundY: number, cameraX: number) {
    const { ctx } = this;
    const sx   = px(obs.x - cameraX);
    const topY = px(groundY - obs.height - CHOICE_THICKNESS);
    const w    = px(obs.width);

    ctx.fillStyle = P_CHOICE_DK;
    ctx.fillRect(sx, topY, w, CHOICE_THICKNESS);
    ctx.fillStyle = P_CHOICE;
    ctx.fillRect(sx + 1, topY + 1, w - 2, CHOICE_THICKNESS - 2);

    // Top highlight
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(sx + 2, topY + 2, w - 4, 3);

    // Pixel gem dots
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    let dotX = sx + 8;
    while (dotX < sx + w - 8) {
      ctx.fillRect(px(dotX), topY + 4, 4, 4);
      dotX += 16;
    }

    // Danger spikes on top surface — signals "can't land/jump on this"
    this.drawTopSpikes(sx, topY, w, obs.x, cameraX);
  }

  // Upward-pointing pixel spikes on the top surface of a ceiling obstacle.
  // World-aligned so pattern stays fixed as camera pans.
  private drawTopSpikes(sx: number, surfaceY: number, width: number, worldX: number, cameraX: number) {
    const { ctx } = this;
    const spikeW = 8;
    const spikeH = 8;
    const pitch  = 16; // one spike per tile

    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, surfaceY - spikeH - 1, width, spikeH + 1);
    ctx.clip();

    const n0 = Math.floor(worldX / pitch);
    let wx = n0 * pitch;

    while (wx < worldX + width + pitch) {
      const left = px(wx - cameraX);
      const tipX = px(wx - cameraX + spikeW / 2);
      const tipY = surfaceY - spikeH;

      // Shadow (offset right face)
      ctx.fillStyle = P_SPIKE_DK;
      ctx.beginPath();
      ctx.moveTo(tipX + 2, tipY + 6);
      ctx.lineTo(left + spikeW, surfaceY);
      ctx.lineTo(left,          surfaceY);
      ctx.closePath();
      ctx.fill();

      // Main spike
      ctx.fillStyle = P_SPIKE;
      ctx.beginPath();
      ctx.moveTo(tipX,              tipY);
      ctx.lineTo(left + spikeW - 2, surfaceY);
      ctx.lineTo(left + 2,          surfaceY);
      ctx.closePath();
      ctx.fill();

      // Left-face highlight
      ctx.fillStyle = 'rgba(255,150,150,0.45)';
      ctx.beginPath();
      ctx.moveTo(tipX,     tipY);
      ctx.lineTo(tipX - 3, tipY + 10);
      ctx.lineTo(left + 2, surfaceY);
      ctx.closePath();
      ctx.fill();

      wx += pitch;
    }

    ctx.restore();
  }

  private drawFlag(screenX: number, groundY: number) {
    const { ctx } = this;
    const poleH = 80;
    const sx    = px(screenX);

    // Pole
    ctx.fillStyle = '#888888';
    ctx.fillRect(sx, px(groundY - poleH), 4, poleH);

    // Pixel triangle flag: 4 rows of decreasing width
    ctx.fillStyle = '#FF3B3B';
    const rows = 4;
    const rowH = 8;
    const maxW = 36;
    for (let r = 0; r < rows; r++) {
      const rw = px(maxW * (1 - r / rows));
      ctx.fillRect(sx + 4, px(groundY - poleH + r * rowH), rw, rowH - 1);
    }

    // Gold tip
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(sx - 1, px(groundY - poleH) - 5, 6, 5);
  }

  drawPlayer(player: Player, cameraX: number, isDead: boolean) {
    const { ctx } = this;
    const sx = px(player.pos.x - cameraX);
    const sy = px(player.pos.y);
    const w  = player.width;   // 32
    const h  = player.height;  // 48 normal | 30 crouching

    if (isDead) ctx.globalAlpha = 0.4;

    if (player.isCrouching) {
      // Dark outline
      ctx.fillStyle = P_PLYR_DK;
      ctx.fillRect(sx, sy, w, h);
      // Body fill
      ctx.fillStyle = P_PLYR;
      ctx.fillRect(sx + 2, sy + 2, w - 4, h - 4);
      // Hat (thin strip)
      ctx.fillStyle = P_PLYR_HAT;
      ctx.fillRect(sx + 4, sy, w - 8, 5);
      // Wide scared eyes
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx + 4, sy + 7, 9, 7);
      ctx.fillRect(sx + 17, sy + 7, 9, 7);
      ctx.fillStyle = '#111';
      ctx.fillRect(sx + 7, sy + 9, 6, 5);
      ctx.fillRect(sx + 20, sy + 9, 6, 5);
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx + 7, sy + 9, 2, 2);
      ctx.fillRect(sx + 20, sy + 9, 2, 2);
    } else {
      // Outline
      ctx.fillStyle = P_PLYR_DK;
      ctx.fillRect(sx, sy, w, h);
      // Hat (top 8px)
      ctx.fillStyle = P_PLYR_HAT;
      ctx.fillRect(sx + 3, sy, w - 6, 8);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(sx + 3, sy, w - 6, 3); // hat highlight
      // Head (8–22px)
      ctx.fillStyle = P_PLYR;
      ctx.fillRect(sx + 2, sy + 8, w - 4, 14);
      // Eyes
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx + 5, sy + 12, 8, 6);
      ctx.fillRect(sx + 17, sy + 12, 8, 6);
      ctx.fillStyle = '#111';
      ctx.fillRect(sx + 8, sy + 14, 5, 4);
      ctx.fillRect(sx + 20, sy + 14, 5, 4);
      ctx.fillStyle = '#fff'; // pupil shine
      ctx.fillRect(sx + 8, sy + 14, 2, 2);
      ctx.fillRect(sx + 20, sy + 14, 2, 2);
      // Body (22–36px)
      ctx.fillStyle = P_PLYR_DK;
      ctx.fillRect(sx + 2, sy + 22, w - 4, 14);
      ctx.fillStyle = P_PLYR;
      ctx.fillRect(sx + 6, sy + 24, 8, 10);
      ctx.fillRect(sx + 17, sy + 24, 7, 10);
      // Belt
      ctx.fillStyle = P_PLYR_HAT;
      ctx.fillRect(sx + 2, sy + 35, w - 4, 2);
      // Legs (36–48px)
      ctx.fillStyle = P_PLYR_DK;
      ctx.fillRect(sx + 4, sy + 37, 10, 11);
      ctx.fillRect(sx + 18, sy + 37, 10, 11);
      // Shoes
      ctx.fillStyle = '#1A3A60';
      ctx.fillRect(sx + 4, sy + 44, 10, 4);
      ctx.fillRect(sx + 18, sy + 44, 10, 4);
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

    // HUD bar background
    const barBgH = 32;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, canvasW, barBgH);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, barBgH, canvasW, 1);

    const fs = Math.min(10, px(canvasW / 32));
    ctx.font = `${fs}px ${PIXEL_FONT}`;

    ctx.textAlign = 'left';
    ctx.fillStyle = P_PLYR_HAT;
    ctx.fillText(`LVL ${levelNum}`, 10, barBgH - 10);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#FF9999';
    ctx.fillText(`x${attempts}`, canvasW - 10, barBgH - 10);

    // Progress bar — pixel style
    const pct  = Math.min(playerX / flagX, 1);
    const bW   = px(canvasW * 0.36);
    const bX   = px((canvasW - bW) / 2);
    const bY   = 10;
    const bH   = 12;

    ctx.fillStyle = '#111133';
    ctx.fillRect(bX - 1, bY - 1, bW + 2, bH + 2);
    ctx.fillStyle = '#2A2A4A';
    ctx.fillRect(bX, bY, bW, bH);

    if (pct > 0) {
      ctx.fillStyle = P_PLYR_HAT;
      ctx.fillRect(bX, bY, px(bW * pct), bH);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(bX, bY, px(bW * pct), 4);
    }

    // Flag end marker
    ctx.fillStyle = '#FF6B35';
    ctx.fillRect(bX + bW - 4, bY, 4, bH);

    // Level 1 jump hint
    if (levelNum === 1) {
      ctx.textAlign = 'center';
      ctx.font = `${Math.min(8, px(canvasW / 44))}px ${PIXEL_FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText('TAP JUMP   HOLD CROUCH', px(canvasW / 2), canvasH - 14);
    }
  }

  drawDeathOverlay(canvas: HTMLCanvasElement, timer: number, delay: number) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(160,0,0,0.38)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = px(canvas.width / 2);
    const cy = px(canvas.height / 2);
    ctx.textAlign = 'center';

    const fs = Math.min(28, px(canvas.width / 13));
    ctx.font = `${fs}px ${PIXEL_FONT}`;
    ctx.fillStyle = '#FF4444';
    ctx.fillText('OOPS!', cx + 2, cy - 18 + 2);
    ctx.fillStyle = '#fff';
    ctx.fillText('OOPS!', cx, cy - 18);

    const ready = timer >= delay;
    ctx.font = `${Math.min(10, px(canvas.width / 34))}px ${PIXEL_FONT}`;
    ctx.fillStyle = ready ? P_PLYR_HAT : 'rgba(255,255,255,0.38)';
    ctx.fillText(ready ? 'TAP TO RETRY' : '...', cx, cy + 22);
  }

  drawLevelCompleteOverlay(canvas: HTMLCanvasElement, nextLevelNum: number) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = px(canvas.width / 2);
    const cy = px(canvas.height / 2);
    ctx.textAlign = 'center';

    const fs = Math.min(24, px(canvas.width / 15));
    ctx.font = `${fs}px ${PIXEL_FONT}`;
    ctx.fillStyle = P_PLYR_HAT;
    ctx.fillText('LEVEL CLEAR!', cx + 2, cy - 22 + 2);
    ctx.fillStyle = '#fff';
    ctx.fillText('LEVEL CLEAR!', cx, cy - 22);

    ctx.font = `${Math.min(10, px(canvas.width / 34))}px ${PIXEL_FONT}`;
    ctx.fillStyle = '#88FF88';
    ctx.fillText(`TAP FOR LEVEL ${nextLevelNum}`, cx, cy + 22);
  }

  drawPausedOverlay(canvas: HTMLCanvasElement) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.52)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = px(canvas.width / 2);
    const cy = px(canvas.height / 2);
    ctx.textAlign = 'center';

    const fs = Math.min(28, px(canvas.width / 13));
    ctx.font = `${fs}px ${PIXEL_FONT}`;
    ctx.fillStyle = '#fff';
    ctx.fillText('PAUSED', cx, cy - 12);

    ctx.font = `${Math.min(10, px(canvas.width / 34))}px ${PIXEL_FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('TAP PAUSE TO RESUME', cx, cy + 22);
  }

  drawCountdownOverlay(canvas: HTMLCanvasElement, count: number, alpha: number) {
    const { ctx } = this;
    const cx = px(canvas.width / 2);
    const cy = px(canvas.height / 2);

    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.12 * alpha})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';

    const fs = Math.min(80, px(canvas.width / 4));
    ctx.font = `${fs}px ${PIXEL_FONT}`;
    ctx.fillStyle = `rgba(255,215,0,${Math.max(0.2, alpha)})`;
    ctx.fillText(String(count), cx + 3, cy + 30 + 3);
    ctx.fillStyle = `rgba(255,255,255,${Math.max(0.2, alpha)})`;
    ctx.fillText(String(count), cx, cy + 30);
    ctx.restore();
  }

  drawAIGameMasterMessage(message: string, alpha: number) {
    if (!message) return;
    const { ctx, canvas } = this;
    const boxW = Math.min(canvas.width - 28, 500);
    const boxH = 56;
    const x    = px((canvas.width - boxW) / 2);
    const y    = 48;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Pixel speech box: dark fill + yellow pixel border
    ctx.fillStyle = '#0D1B2A';
    ctx.fillRect(x, y, boxW, boxH);

    ctx.fillStyle = P_PLYR_HAT;
    ctx.fillRect(x,             y,              boxW, 2); // top
    ctx.fillRect(x,             y + boxH - 2,   boxW, 2); // bottom
    ctx.fillRect(x,             y,              2, boxH); // left
    ctx.fillRect(x + boxW - 2,  y,              2, boxH); // right

    ctx.fillStyle = 'rgba(255,215,0,0.07)';
    ctx.fillRect(x + 2, y + 2, boxW - 4, boxH - 4);

    // "AI" label
    ctx.font = `bold 8px ${PIXEL_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = P_PLYR_HAT;
    ctx.fillText('AI', x + 8, y + 16);

    // Message text (use monospace for readability at small size)
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.min(12, px(canvas.width / 28))}px monospace`;
    ctx.fillStyle = '#fff';
    ctx.fillText(message, px(canvas.width / 2), y + 37);

    ctx.restore();
  }
}
