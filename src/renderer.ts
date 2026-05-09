import { Player } from './player';
import { LevelData, getGroundSegments } from './level';
import { Obstacle, TrapState } from './types';
import { BLOCKER_RETRACT_MS, CRUMBLE_WARNING_MS, CRUSHER_RAISED_H } from './levelMutator';

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
const PLAYER_SKINS = {
  classic: { hat: '#F2C94C', body: '#4A90E2', dark: '#2A6AB0' },
  ember: { hat: '#FFD166', body: '#F97316', dark: '#9A3412' },
  forest: { hat: '#84CC16', body: '#22C55E', dark: '#166534' },
  void: { hat: '#C084FC', body: '#8B5CF6', dark: '#4C1D95' },
} as const;
type PlayerSkinId = keyof typeof PLAYER_SKINS;
// New hazard colors
const P_ELEC_POST  = '#1A2A3A';  // electric field post
const P_ELEC_BEAM  = '#00FFFF';  // active electric beam
const P_ELEC_WARN  = '#FFE040';  // warning sparks
const P_CRUSH      = '#7B1A1A';  // crusher ceiling body
const P_CRUSH_DK   = '#4A0A0A';  // crusher ceiling dark
const P_CRUSH_WARN = '#FF7800';  // crusher warning stripe
const P_WARN_MKR   = '#FFD700';  // warning marker base

const DOUBLE_SPIKE_GAP = 16; // keep in sync with original
const CEIL_THICKNESS   = 16; // keep in sync with game.ts LOW_CEILING_THICKNESS
const CHOICE_THICKNESS = 12; // keep in sync with game.ts CHOICE_BAR_THICKNESS
const CLOUD_PERIOD     = 1400;
const PIXEL_FONT       = "'Press Start 2P', monospace";

function px(v: number): number {
  return Math.round(v);
}

function obsX(obs: Obstacle): number {
  return obs.currentX ?? obs.x;
}

function obsW(obs: Obstacle): number {
  return obs.currentWidth ?? obs.width;
}

function obsH(obs: Obstacle): number {
  return obs.currentHeight ?? obs.height;
}

function routeAccentColor(obs: Obstacle): string | null {
  if (obs.routeLayer === 'mid') return 'rgba(80,220,255,0.22)';
  if (obs.routeLayer === 'upper') return 'rgba(255,210,90,0.20)';
  return null;
}

// Alpha value for disappearing/reappearing platforms.
function computeDisappearAlpha(obs: Obstacle): number {
  const timer = obs.disappearTimer ?? 0;
  const FLICKER_MS = 400;
  const t = Math.min(1, timer / FLICKER_MS);

  if (obs.disappearState === 'disappearing') {
    // Rapid flicker + fade out
    const flicker = 0.5 + 0.5 * Math.sin(t * Math.PI * 7);
    return Math.max(0.05, (1 - t) * flicker);
  }
  if (obs.disappearState === 'reappearing') {
    return Math.min(1, t);
  }
  return 1;
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
      else if (obs.kind === 'electricField')  this.drawElectricField(obs, groundY, cameraX);
      else if (obs.kind === 'crusherCeiling') this.drawCrusherCeiling(obs, groundY, cameraX);
      else if (obs.kind === 'warningMarker')  this.drawWarningMarker(obs, groundY, cameraX);
      else if (obs.kind === 'gap' && obs.trapHost && obs.trapType === 'shiftingGap') {
        this.drawShiftingGapMarker(obs, groundY, cameraX);
      }
      // gaps = empty ground — no draw needed

      // Task 5: Draw trap host indicator
      if (obs.trapHost) {
        this.drawTrapMutationOverlay(obs, groundY, cameraX);
        this.drawTrapHostIndicator(obs, groundY, cameraX, obs.trapState);
      }
    }
  }

  private drawObstaclePulse(obs: Obstacle, groundY: number, cameraX: number, pulse: number) {
    const { ctx } = this;
    const alpha = Math.min(0.42, pulse * 0.42);
    const sx = px(obsX(obs) - cameraX);
    const w = obsW(obs);
    const h = obsH(obs);

    ctx.save();
    ctx.strokeStyle = `rgba(255,225,120,${alpha})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    if (obs.kind === 'spike' || obs.kind === 'doubleSpike') {
      ctx.strokeRect(sx - 6, groundY - h - 6, w + 12, h + 12);
    } else if (obs.kind === 'lowCeiling') {
      ctx.strokeRect(sx - 6, groundY - h - CEIL_THICKNESS - 6, w + 12, CEIL_THICKNESS + 12);
    } else if (obs.kind === 'choiceObstacle') {
      ctx.strokeRect(sx - 6, groundY - h - CHOICE_THICKNESS - 6, w + 12, CHOICE_THICKNESS + 12);
    } else if (obs.kind === 'platform') {
      ctx.strokeRect(sx - 5, groundY - h - 5, w + 10, TILE + 10);
    } else {
      ctx.strokeRect(sx - 5, groundY - 70, w + 10, 78);
    }
    ctx.restore();
  }

  private drawAiPlacedLabel(obs: Obstacle, groundY: number, cameraX: number, pulse: number) {
    const { ctx } = this;
    if (pulse < 0.2) return;
    const sx = px(obsX(obs) - cameraX + obsW(obs) / 2);
    const h = obsH(obs);
    let y: number;
    if (obs.kind === 'spike' || obs.kind === 'doubleSpike')  y = groundY - h - 26;
    else if (obs.kind === 'lowCeiling')                       y = groundY - h - 44;
    else if (obs.kind === 'choiceObstacle')                   y = groundY - h - 38;
    else if (obs.kind === 'platform')                         y = groundY - h - 30;
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
    const sx  = px(obsX(obs) - cameraX);
    const w = obsW(obs);
    const baseY = px(groundY + 2);
    const tipX  = px(obsX(obs) - cameraX + w / 2);

    // AI modifier: draw warning indicator, then use animated height
    if (obs.aiModifier === 'risingSpike' || obs.aiModifier === 'pulsingSpike') {
      this.drawSpikeModifierWarning(obs, sx, w, baseY);
      const h = obs.aiModVisualHeight ?? 0;
      if (h < 2) return;
      const tipY = px(groundY - h);
      this.drawSpikeShape(ctx, tipX, tipY, sx, w, baseY);
      return;
    }

    const h = obsH(obs);
    const tipY = px(groundY - h);
    this.drawSpikeShape(ctx, tipX, tipY, sx, w, baseY);
  }

  private drawSpikeShape(
    ctx: CanvasRenderingContext2D,
    tipX: number, tipY: number,
    sx: number, w: number, baseY: number,
  ) {
    ctx.fillStyle = P_SPIKE_DK;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(sx + w, baseY);
    ctx.lineTo(sx, baseY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = P_SPIKE;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(sx + w - 4, baseY);
    ctx.lineTo(sx + 4, baseY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(255,150,150,0.45)';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - 4, tipY + 16);
    ctx.lineTo(sx + 4, baseY);
    ctx.closePath();
    ctx.fill();
  }

  private drawSpikeModifierWarning(
    obs: Obstacle,
    sx: number, w: number, baseY: number,
  ) {
    const ctx = this.ctx;
    const state = obs.aiModState;
    const timer = obs.aiModTimer ?? 0;

    if (state === 'warning' || state === 'inactive') {
      // Pulsing red stub at base — "spike incoming"
      const pulse = 0.4 + 0.6 * Math.abs(Math.sin(timer / 120));
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#FF4D4D';
      ctx.fillRect(px(sx + w * 0.3), baseY - 5, px(w * 0.4), 5);
      ctx.restore();
    } else if (state === 'retracting') {
      // Fading warning as spike retracts
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#FF4D4D';
      ctx.fillRect(px(sx + w * 0.3), baseY - 3, px(w * 0.4), 3);
      ctx.restore();
    }
  }

  private drawDoubleSpike(obs: Obstacle, groundY: number, cameraX: number) {
    const spikeW = (obsW(obs) - DOUBLE_SPIKE_GAP) / 2;
    const baseY  = px(groundY + 2);
    const x = obsX(obs);

    // AI modifier: warning stub + animated height
    if (obs.aiModifier === 'risingSpike' || obs.aiModifier === 'pulsingSpike') {
      const sx = px(x - cameraX);
      const w = obsW(obs);
      this.drawSpikeModifierWarning(obs, sx, w, baseY);
    }
    const h = (obs.aiModifier === 'risingSpike' || obs.aiModifier === 'pulsingSpike')
      ? (obs.aiModVisualHeight ?? 0)
      : obsH(obs);
    if (h < 2 && obs.aiModifier) return;

    for (let i = 0; i < 2; i++) {
      const left = px(x - cameraX + i * (spikeW + DOUBLE_SPIKE_GAP));
      const tipX = px(left + spikeW / 2);
      const tipY = px(groundY - h);

      this.ctx.fillStyle = P_SPIKE_DK;
      this.ctx.beginPath();
      this.ctx.moveTo(tipX, tipY);
      this.ctx.lineTo(left + spikeW, baseY);
      this.ctx.lineTo(left, baseY);
      this.ctx.closePath();
      this.ctx.fill();

      this.ctx.fillStyle = P_SPIKE;
      this.ctx.beginPath();
      this.ctx.moveTo(tipX, tipY);
      this.ctx.lineTo(left + spikeW - 4, baseY);
      this.ctx.lineTo(left + 4, baseY);
      this.ctx.closePath();
      this.ctx.fill();

      this.ctx.fillStyle = 'rgba(255,150,150,0.45)';
      this.ctx.beginPath();
      this.ctx.moveTo(tipX, tipY);
      this.ctx.lineTo(tipX - 4, tipY + 16);
      this.ctx.lineTo(left + 4, baseY);
      this.ctx.closePath();
      this.ctx.fill();
    }
  }

  private drawPlatform(obs: Obstacle, groundY: number, cameraX: number) {
    const disappearState = obs.disappearState;
    if (disappearState === 'invisible') return;

    // Dropping/crumble platform: invisible during drop + invisible states
    if (obs.aiModifier === 'droppingPlatform' && (obs.aiModState === 'invisible')) return;
    if (obs.aiModifier === 'crumblePlatform' && (obs.aiModState === 'invisible')) return;

    // Temp blocker platform: invisible when active (player falls through)
    let blockerSaved = false;
    if (obs.aiModifier === 'temporaryBlocker') {
      if (obs.aiModState === 'active') return;
      const { ctx: ctxB } = this;
      if (obs.aiModState === 'warning') {
        ctxB.save();
        blockerSaved = true;
        ctxB.globalAlpha *= 0.55;
      } else if (obs.aiModState === 'retracting') {
        const fadeIn = Math.min(1, (obs.aiModTimer ?? 0) / BLOCKER_RETRACT_MS);
        ctxB.save();
        blockerSaved = true;
        ctxB.globalAlpha *= fadeIn;
      }
    }

    const { ctx } = this;
    const h = obsH(obs);
    if (h <= 0.5) return;
    if (obs.trapType === 'collapsingPlatform' && obs.trapState === 'spent') return;

    // Apply alpha for disappearing/reappearing states
    const useAlpha = disappearState === 'disappearing' || disappearState === 'reappearing';
    if (useAlpha) {
      ctx.save();
      ctx.globalAlpha *= computeDisappearAlpha(obs);
    }

    // Dropping/crumble platform: shift y by drop offset; use alpha fade during dropping/spawning
    const dropOffset = (obs.aiModifier === 'droppingPlatform' || obs.aiModifier === 'crumblePlatform')
      ? (obs.aiModDropOffset ?? 0) : 0;
    const isDroppingActive = (obs.aiModifier === 'droppingPlatform' || obs.aiModifier === 'crumblePlatform') &&
      (obs.aiModState === 'dropping' || obs.aiModState === 'spawning');
    if (isDroppingActive && !useAlpha) ctx.save();
    if (isDroppingActive) ctx.globalAlpha *= obs.aiModState === 'dropping' ? 0.7 : 0.85;

    const sx       = px(obsX(obs) - cameraX);
    const surfaceY = px(groundY - h + dropOffset);
    const w = px(obsW(obs));

    // Shake: collapsing trap warning OR dropping/crumble platform warning state
    const isDropWarning = obs.aiModifier === 'droppingPlatform' && obs.aiModState === 'warning';
    const isCrumbleWarning = obs.aiModifier === 'crumblePlatform' && obs.aiModState === 'warning';
    const shakeX = (obs.trapType === 'collapsingPlatform' && (obs.trapState === 'warning' || obs.trapState === 'triggered'))
      ? Math.sin((obs.animationProgress ?? 0) * 24) * 2
      : isDropWarning
        ? Math.sin((obs.aiModTimer ?? 0) / 40) * 3
        : isCrumbleWarning
          ? Math.sin((obs.aiModTimer ?? 0) / 20) * 4
          : 0;
    const shakeY = isDropWarning ? Math.sin((obs.aiModTimer ?? 0) / 30 + 1) * 1
      : isCrumbleWarning ? Math.sin((obs.aiModTimer ?? 0) / 22 + 1) * 2 : 0;
    const thick    = TILE; // 16px = 1 tile

    const sy = surfaceY + shakeY;

    // Brick body (below grass strip)
    this.drawBricks(px(sx + shakeX), sy + 4, w, thick - 4, obsX(obs), cameraX, P_PLAT, P_PLAT_DK, 20, 10);

    // Grass top
    ctx.fillStyle = P_GRASS;
    ctx.fillRect(px(sx + shakeX), sy, w, 4);
    ctx.fillStyle = P_GRASS_LT;
    ctx.fillRect(px(sx + shakeX), sy, w, 2);

    // Edge caps (left/right dark pixels)
    ctx.fillStyle = P_PLAT_DK;
    ctx.fillRect(px(sx + shakeX), sy + 4, 2, thick - 4);
    ctx.fillRect(px(sx + shakeX) + w - 2, sy + 4, 2, thick - 4);

    const routeAccent = routeAccentColor(obs);
    if (routeAccent) {
      ctx.fillStyle = routeAccent;
      ctx.fillRect(px(sx + shakeX), sy + 1, w, 4);
    }

    // Trap mutation: spikes can grow out of tile tops.
    const spikeExt = obs.trapType === 'platformNeedle' ? (obs.currentSpikeExt ?? 0) : 0;
    if (spikeExt > 1) {
      this.drawJumpBlockerSpikes(sx + shakeX, sy, w, obsX(obs), cameraX, spikeExt);
    }

    if (useAlpha || isDroppingActive) {
      ctx.restore();
    }
    if (blockerSaved) {
      ctx.restore();
    }

    // Orange warning strip on disappear-mode platforms when still solid
    if (obs.disappearMode && disappearState === 'visible') {
      ctx.fillStyle = 'rgba(255,140,0,0.55)';
      ctx.fillRect(px(sx), surfaceY - shakeY, w, 3);
    }
    // Pulsing orange warning strip when temp blocker is about to vanish
    if (obs.aiModifier === 'temporaryBlocker' && obs.aiModState === 'warning') {
      const pulse = 0.5 + 0.4 * Math.abs(Math.sin((obs.aiModTimer ?? 0) / 90));
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#FF8800';
      ctx.fillRect(px(sx), surfaceY, w, 3);
      ctx.restore();
    }
    // Red crack overlay on droppingPlatform during warning
    if (isDropWarning) {
      const crack = Math.min(1, (obs.aiModTimer ?? 0) / 700);
      ctx.save();
      ctx.globalAlpha = crack * 0.55;
      ctx.fillStyle = '#FF2200';
      ctx.fillRect(px(sx + shakeX) + 2, surfaceY + shakeY + 2, w - 4, 2);
      ctx.fillRect(px(sx + shakeX) + w * 0.3, surfaceY + shakeY, 2, 6);
      ctx.fillRect(px(sx + shakeX) + w * 0.6, surfaceY + shakeY, 2, 5);
      ctx.restore();
    }
    // Orange crack overlay on crumblePlatform during warning (faster, more dramatic)
    if (isCrumbleWarning) {
      const crack = Math.min(1, (obs.aiModTimer ?? 0) / CRUMBLE_WARNING_MS);
      const shx = px(sx + shakeX);
      const shy = surfaceY + shakeY;
      ctx.save();
      ctx.globalAlpha = 0.4 + crack * 0.55;
      ctx.fillStyle = '#FF6600';
      ctx.fillRect(shx + 2, shy + 1, w - 4, 2);
      ctx.fillRect(shx + px(w * 0.2), shy - 1, 3, 7);
      ctx.fillRect(shx + px(w * 0.45), shy - 1, 3, 8);
      ctx.fillRect(shx + px(w * 0.7), shy - 1, 3, 6);
      ctx.restore();
    }
  }

  private drawLowCeiling(obs: Obstacle, groundY: number, cameraX: number) {
    const { ctx } = this;

    const sx   = px(obsX(obs) - cameraX);
    const h = obsH(obs);
    const topY = px(groundY - h - CEIL_THICKNESS);
    const w = px(obsW(obs));

    // Stone block pattern
    this.drawBricks(sx, topY, w, CEIL_THICKNESS, obsX(obs), cameraX, P_CEIL, P_CEIL_DK, 20, 13);

    // Underside highlight strip
    ctx.fillStyle = P_CEIL_LT;
    ctx.fillRect(sx, topY + CEIL_THICKNESS - 3, w, 3);

    // Danger spikes on top surface — signals "can't land/jump on this"
    this.drawTopSpikes(sx, topY, w, obsX(obs), cameraX);
  }

  private drawChoiceObstacle(obs: Obstacle, groundY: number, cameraX: number) {
    const { ctx } = this;
    const sx   = px(obsX(obs) - cameraX);
    const h = obsH(obs);
    const topY = px(groundY - h - CHOICE_THICKNESS);
    const w    = px(obsW(obs));

    ctx.fillStyle = P_CHOICE_DK;
    ctx.fillRect(sx, topY, w, CHOICE_THICKNESS);
    ctx.fillStyle = P_CHOICE;
    ctx.fillRect(sx + 1, topY + 1, w - 2, CHOICE_THICKNESS - 2);

    // Top highlight
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(sx + 2, topY + 2, w - 4, 3);
    const routeAccent = routeAccentColor(obs);
    if (routeAccent) {
      ctx.fillStyle = routeAccent;
      ctx.fillRect(sx + 1, topY + CHOICE_THICKNESS - 3, w - 2, 2);
    }

    // Pixel gem dots
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    let dotX = sx + 8;
    while (dotX < sx + w - 8) {
      ctx.fillRect(px(dotX), topY + 4, 4, 4);
      dotX += 16;
    }

    const spikeExt = obs.trapType === 'adaptiveChoiceGateJump' ? (obs.currentSpikeExt ?? 0) : 0;
    if (spikeExt > 1) {
      // Tall upward spikes growing from bar top — visually blocks the jump lane.
      this.drawJumpBlockerSpikes(sx, topY, w, obsX(obs), cameraX, spikeExt);
    } else {
      this.drawTopSpikes(sx, topY, w, obsX(obs), cameraX);
    }
  }

  // Tall upward-pointing spikes from bar top; height = spikeH.
  // Centered whole spikes keep matching choice bars visually identical.
  private drawJumpBlockerSpikes(sx: number, surfaceY: number, width: number, _worldX: number, _cameraX: number, spikeH: number) {
    const { ctx } = this;
    const spikeW = 14;
    const pitch  = 20;
    const edgePad = 8;
    const spikeCount = Math.max(1, Math.floor((width - edgePad * 2 + (pitch - spikeW)) / pitch));
    const totalW = (spikeCount - 1) * pitch + spikeW;
    const startX = sx + (width - totalW) / 2;

    for (let i = 0; i < spikeCount; i++) {
      const left = px(startX + i * pitch);
      const tipX = px(startX + i * pitch + spikeW / 2);
      const tipY = surfaceY - spikeH;

      ctx.fillStyle = P_SPIKE_DK;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(left + spikeW, surfaceY);
      ctx.lineTo(left, surfaceY);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = P_SPIKE;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(left + spikeW - 4, surfaceY);
      ctx.lineTo(left + 4, surfaceY);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = 'rgba(255,150,150,0.45)';
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - 4, tipY + 18);
      ctx.lineTo(left + 4, surfaceY);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Upward-pointing pixel spikes on the top surface of a ceiling obstacle.
  // Centered whole spikes avoid clipped half-spikes at obstacle edges.
  private drawTopSpikes(sx: number, surfaceY: number, width: number, _worldX: number, _cameraX: number) {
    const { ctx } = this;
    const spikeW = 8;
    const spikeH = 8;
    const pitch  = 16; // one spike per tile
    const edgePad = 8;
    const spikeCount = Math.max(1, Math.floor((width - edgePad * 2 + (pitch - spikeW)) / pitch));
    const totalW = (spikeCount - 1) * pitch + spikeW;
    const startX = sx + (width - totalW) / 2;

    for (let i = 0; i < spikeCount; i++) {
      const left = px(startX + i * pitch);
      const tipX = px(startX + i * pitch + spikeW / 2);
      const tipY = surfaceY - spikeH;

      // Shadow (same tip as main spike)
      ctx.fillStyle = P_SPIKE_DK;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
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
    }
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

  drawPlayer(player: Player, cameraX: number, isDead: boolean, skinId: PlayerSkinId = 'classic', isInvincible = false) {
    const { ctx } = this;
    const sx = px(player.pos.x - cameraX);
    const sy = px(player.pos.y);
    const w  = player.width;   // 32
    const h  = player.height;  // 48 normal | 30 crouching

    if (isDead) ctx.globalAlpha = 0.4;

    // Flash grey every 100ms during invincibility
    const flashGrey = isInvincible && Math.floor(performance.now() / 100) % 2 === 0;
    const skin = PLAYER_SKINS[skinId] ?? PLAYER_SKINS.classic;
    const hatColor  = flashGrey ? '#aaa' : skin.hat;
    const bodyColor = flashGrey ? '#bbb' : skin.body;
    const darkColor = flashGrey ? '#888' : skin.dark;

    if (player.isCrouching) {
      // Dark outline
      ctx.fillStyle = darkColor;
      ctx.fillRect(sx, sy, w, h);
      // Body fill
      ctx.fillStyle = bodyColor;
      ctx.fillRect(sx + 2, sy + 2, w - 4, h - 4);
      // Hat (thin strip)
      ctx.fillStyle = hatColor;
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
      ctx.fillStyle = darkColor;
      ctx.fillRect(sx, sy, w, h);
      // Hat (top 8px)
      ctx.fillStyle = hatColor;
      ctx.fillRect(sx + 3, sy, w - 6, 8);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(sx + 3, sy, w - 6, 3); // hat highlight
      // Head (8–22px)
      ctx.fillStyle = bodyColor;
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
      ctx.fillStyle = darkColor;
      ctx.fillRect(sx + 2, sy + 22, w - 4, 14);
      ctx.fillStyle = bodyColor;
      ctx.fillRect(sx + 6, sy + 24, 8, 10);
      ctx.fillRect(sx + 17, sy + 24, 7, 10);
      // Belt
      ctx.fillStyle = hatColor;
      ctx.fillRect(sx + 2, sy + 35, w - 4, 2);
      // Legs (36–48px)
      ctx.fillStyle = darkColor;
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

    // Progress bar — pixel style
    const pct  = Math.min(playerX / flagX, 1);
    const bW   = px(canvasW * 0.36);
    const bX   = px((canvasW - bW) / 2);
    const bY   = 10;
    const bH   = 12;

    const fs = Math.min(10, px(canvasW / 32));
    ctx.font = `${fs}px ${PIXEL_FONT}`;

    const textY = bY + bH / 2 + fs / 2 - 1;
    const gap = 14;

    ctx.textAlign = 'right';
    ctx.fillStyle = P_PLYR_HAT;
    ctx.fillText(`LVL ${levelNum}`, bX - gap, textY);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#FF9999';
    ctx.fillText(`x${attempts}`, bX + bW + gap, textY);

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
      ctx.fillText('↑ JUMP     ↓ CROUCH', px(canvasW / 2), canvasH - 14);
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
    const boxW    = Math.min(canvas.width - 28, 500);
    const padH    = 10; // horizontal text padding inside box
    const maxLineW = boxW - padH * 2;
    const x       = px((canvas.width - boxW) / 2);
    const y       = 48;

    // Word-wrap: build lines that fit within maxLineW
    const fontSize = Math.min(12, px(canvas.width / 28));
    ctx.font = `bold ${fontSize}px monospace`;
    const words = message.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width <= maxLineW) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);

    const lineH   = fontSize + 4;
    const textAreaH = lines.length * lineH;
    const boxH    = 26 + textAreaH + 8; // 26 = label area, 8 = bottom pad

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

    // Wrapped message text
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    const textStartY = y + 26;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], px(canvas.width / 2), textStartY + i * lineH);
    }

    ctx.restore();
  }

  private drawTrapMutationOverlay(obs: Obstacle, groundY: number, cameraX: number) {
    if (obs.trapState !== 'warning' && obs.trapState !== 'triggered') return;
    const { ctx } = this;
    const progress = obs.animationProgress ?? 0;
    const pulse = 0.45 + Math.sin(progress * 18) * 0.2;
    const sx = px(obsX(obs) - cameraX);
    const w = obsW(obs);
    const h = obsH(obs);

    let y = groundY - h;
    let boxH = h;
    if (obs.kind === 'lowCeiling') {
      y = groundY - h - CEIL_THICKNESS;
      boxH = CEIL_THICKNESS;
    } else if (obs.kind === 'choiceObstacle') {
      y = groundY - h - CHOICE_THICKNESS;
      boxH = CHOICE_THICKNESS;
    } else if (obs.kind === 'platform') {
      y = groundY - h - TILE;
      boxH = TILE;
    } else if (obs.kind === 'gap') {
      y = groundY - 22;
      boxH = 16;
    }

    ctx.save();
    ctx.fillStyle = obs.trapState === 'warning'
      ? `rgba(255, 210, 60, ${pulse * 0.2})`
      : `rgba(255, 80, 40, ${pulse * 0.22})`;
    ctx.fillRect(sx - 2, y - 2, w + 4, boxH + 4);
    ctx.restore();
  }

  private drawTrapHostIndicator(
    obs: Obstacle,
    groundY: number,
    cameraX: number,
    trapState?: TrapState,
  ) {
    const { ctx } = this;
    const sx = px(obsX(obs) - cameraX);
    const w = obsW(obs);
    const hValue = obsH(obs);

    // Calculate bounds based on obstacle type
    let y: number;
    let h: number;

    if (obs.kind === 'spike' || obs.kind === 'doubleSpike') {
      y = groundY - hValue;
      h = hValue;
    } else if (obs.kind === 'lowCeiling') {
      y = groundY - hValue - CEIL_THICKNESS;
      h = CEIL_THICKNESS;
    } else if (obs.kind === 'choiceObstacle') {
      y = groundY - hValue - CHOICE_THICKNESS;
      h = CHOICE_THICKNESS;
    } else if (obs.kind === 'platform') {
      y = groundY - hValue - TILE;
      h = TILE;
    } else {
      y = groundY - 70;
      h = 70;
    }

    ctx.save();

    // Do not show "AI changed" visuals while idle.
    if (trapState === 'idle' || trapState === undefined) {
      ctx.restore();
      return;
    }

    // Pop-up spike: draw special ground glow when armed/warning (spike height is still 0).
    if (obs.trapType === 'popUpSpike' && (trapState === 'armed' || trapState === 'warning')) {
      const progress = obs.animationProgress ?? 0;
      const pulse = 0.5 + Math.sin(progress * 22) * 0.3;
      const intensity = trapState === 'warning' ? 0.7 : 0.4;
      ctx.fillStyle = `rgba(255, 40, 40, ${pulse * intensity})`;
      ctx.fillRect(sx - 6, groundY - 8, w + 12, 10);
      // Crack lines on ground
      ctx.strokeStyle = `rgba(255, 160, 40, ${pulse * intensity})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(sx + px(w / 2), groundY - 8);
      ctx.lineTo(sx + px(w / 2) - 6, groundY);
      ctx.moveTo(sx + px(w / 2), groundY - 8);
      ctx.lineTo(sx + px(w / 2) + 6, groundY);
      ctx.stroke();
      ctx.restore();
      return;
    }

    switch (trapState) {
      case 'armed':
        // Bright red border, fast pulse
        ctx.strokeStyle = 'rgba(255, 40, 40, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(sx - 3, y - 3, w + 6, h + 6);
        break;
      case 'warning':
        ctx.strokeStyle = 'rgba(255, 205, 70, 0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(sx - 3, y - 3, w + 6, h + 6);
        break;
      case 'triggered':
        // Orange flash
        ctx.strokeStyle = 'rgba(255, 140, 0, 0.9)';
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
        ctx.strokeRect(sx - 4, y - 4, w + 8, h + 8);
        break;
      case 'spent':
        // Don't draw - platform is gone
        break;
      default:
        ctx.strokeStyle = 'rgba(255, 205, 70, 0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(sx - 2, y - 2, w + 4, h + 4);
    }

    // For collapsing platforms in armed/triggered state, draw crack lines
    if (
      obs.kind === 'platform' &&
      obs.trapType === 'collapsingPlatform' &&
      (trapState === 'warning' || trapState === 'triggered')
    ) {
      ctx.strokeStyle = trapState === 'warning' ? 'rgba(100, 50, 50, 0.6)' : 'rgba(150, 80, 50, 0.8)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      // Draw zigzag crack across platform top
      const surfaceY = px(groundY - hValue);
      const crackSteps = 4;
      const stepW = w / crackSteps;
      ctx.moveTo(sx, surfaceY + 4);
      for (let i = 1; i <= crackSteps; i++) {
        const cx = sx + stepW * i;
        const cy = surfaceY + 4 + (i % 2 === 0 ? 3 : -2);
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawElectricField(obs: Obstacle, groundY: number, cameraX: number) {
    const { ctx } = this;
    const sx = px(obs.x - cameraX);
    const w = px(obs.width);
    const h = px(obs.height);
    const topY = px(groundY - h);
    const state = obs.aiModState;
    const t = obs.aiModTimer ?? 0;

    // Two posts
    const postW = 6;
    const postH = h;
    ctx.fillStyle = P_ELEC_POST;
    ctx.fillRect(sx, topY, postW, postH);
    ctx.fillRect(sx + w - postW, topY, postW, postH);
    // Post highlights
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(sx + 1, topY + 2, 2, postH - 4);
    ctx.fillRect(sx + w - postW + 1, topY + 2, 2, postH - 4);

    if (!state || state === 'inactive') {
      // Dark, dormant — just posts + faint dashed line
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = '#406080';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(sx + postW, px(groundY - h * 0.5));
      ctx.lineTo(sx + w - postW, px(groundY - h * 0.5));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    } else if (state === 'warning') {
      // Yellow sparks jumping between posts
      const sparkCount = 5;
      ctx.save();
      ctx.strokeStyle = P_ELEC_WARN;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(t / 80));
      ctx.beginPath();
      const y0 = px(groundY - h * 0.5);
      ctx.moveTo(sx + postW, y0);
      for (let i = 1; i <= sparkCount; i++) {
        const bx = sx + postW + ((w - postW * 2) * i) / sparkCount;
        const jitter = (Math.sin(t / 60 + i * 1.7) * h * 0.35);
        ctx.lineTo(px(bx), px(y0 + jitter));
      }
      ctx.lineTo(sx + w - postW, y0);
      ctx.stroke();
      ctx.restore();
      // Warn glow on floor
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = P_ELEC_WARN;
      ctx.fillRect(sx + postW, topY, w - postW * 2, h);
      ctx.restore();
    } else if (state === 'active') {
      // Bright cyan beam + floor glow
      ctx.save();
      ctx.globalAlpha = 0.85 + 0.15 * Math.abs(Math.sin(t / 50));
      // Glow (wide, low alpha)
      ctx.globalAlpha *= 0.3;
      ctx.fillStyle = P_ELEC_BEAM;
      ctx.fillRect(sx + postW, topY, w - postW * 2, h);
      ctx.globalAlpha /= 0.3;
      ctx.globalAlpha *= 0.85;
      // Main beam
      const beamY = px(groundY - h * 0.48);
      const beamH = Math.max(4, px(h * 0.12));
      ctx.fillStyle = P_ELEC_BEAM;
      ctx.fillRect(sx + postW, beamY, w - postW * 2, beamH);
      // Zigzag overlay
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const segCount = 8;
      ctx.moveTo(sx + postW, beamY + beamH / 2);
      for (let i = 1; i <= segCount; i++) {
        const bx = sx + postW + ((w - postW * 2) * i) / segCount;
        const by = beamY + (i % 2 === 0 ? 0 : beamH);
        ctx.lineTo(px(bx), by);
      }
      ctx.stroke();
      ctx.restore();
      // Danger ticks on top
      ctx.fillStyle = '#FF4040';
      for (let xi = sx + postW + 4; xi < sx + w - postW - 4; xi += 18) {
        ctx.fillRect(px(xi), topY, 2, 5);
      }
    }
  }

  private drawCrusherCeiling(obs: Obstacle, groundY: number, cameraX: number) {
    const { ctx } = this;
    const sx = px(obs.x - cameraX);
    const w = px(obs.width);
    const state = obs.aiModState;
    const t = obs.aiModTimer ?? 0;

    // Current clearance from ground (animated)
    const clearance = obs.aiModVisualHeight ?? CRUSHER_RAISED_H;
    const slabH = 20;
    const slabTop = px(groundY - clearance - slabH);
    const slabBot = slabTop + slabH;

    // Slab body
    const isActive = state === 'active' || state === 'crushing';
    ctx.fillStyle = isActive ? P_CRUSH : P_CRUSH_DK;
    ctx.fillRect(sx, slabTop, w, slabH);
    // Brick detail
    this.drawBricks(sx, slabTop + 2, w, slabH - 4, obs.x, cameraX, isActive ? '#9B2A2A' : '#5A3050', isActive ? P_CRUSH_DK : '#3A1A3A', 24, 10);
    // Bottom edge highlight
    ctx.fillStyle = isActive ? '#FF6060' : '#8A5A8A';
    ctx.fillRect(sx, slabBot - 3, w, 3);
    // Top edge dark
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(sx, slabTop, w, 3);

    // Warning stripes when approaching
    if (state === 'warning') {
      const pulse = 0.5 + 0.5 * Math.abs(Math.sin(t / 100));
      ctx.save();
      ctx.globalAlpha = pulse * 0.7;
      const stripeW = 12;
      let xi = sx;
      let alt = 0;
      while (xi < sx + w) {
        if (alt % 2 === 0) {
          ctx.fillStyle = P_CRUSH_WARN;
          ctx.fillRect(px(xi), slabTop, Math.min(stripeW, sx + w - px(xi)), slabH);
        }
        xi += stripeW;
        alt++;
      }
      ctx.restore();
    }

    // Downward danger spikes on underside when active/crushing
    if (isActive) {
      const spikeW = 10;
      const spikeH = 12;
      const pitch = 18;
      const edgePad = 6;
      const count = Math.max(1, Math.floor((w - edgePad * 2) / pitch));
      const totalW = (count - 1) * pitch + spikeW;
      const startX = sx + (w - totalW) / 2;
      ctx.fillStyle = P_SPIKE;
      for (let i = 0; i < count; i++) {
        const left = px(startX + i * pitch);
        const tipX = px(startX + i * pitch + spikeW / 2);
        const tipY = slabBot + spikeH;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(left + spikeW, slabBot);
        ctx.lineTo(left, slabBot);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Chain / cable from top
    const chainTopY = 0;
    ctx.save();
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(sx + w / 2, chainTopY);
    ctx.lineTo(sx + w / 2, slabTop);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Floor danger zone indicator (shows where danger is)
    if (state === 'active' || state === 'warning' || state === 'crushing') {
      ctx.save();
      ctx.globalAlpha = state === 'active' ? 0.22 : 0.1;
      ctx.fillStyle = P_CRUSH_WARN;
      ctx.fillRect(sx, groundY - clearance, w, clearance);
      ctx.restore();
    }
  }

  private drawWarningMarker(obs: Obstacle, groundY: number, cameraX: number) {
    const { ctx } = this;
    const sx = px(obs.x - cameraX);
    const w = px(obs.width);
    const markerY = px(groundY - 12);
    const wt = obs.warningType ?? 'moving';

    ctx.save();
    ctx.globalAlpha = 0.75;

    if (wt === 'electric') {
      // Cyan lightning bolt on floor
      ctx.fillStyle = P_ELEC_BEAM;
      const cx = sx + w / 2;
      ctx.beginPath();
      ctx.moveTo(cx - 3, markerY - 10);
      ctx.lineTo(cx + 5, markerY - 10);
      ctx.lineTo(cx,     markerY - 4);
      ctx.lineTo(cx + 4, markerY - 4);
      ctx.lineTo(cx - 5, markerY + 2);
      ctx.lineTo(cx,     markerY + 2);
      ctx.lineTo(cx - 3, markerY - 4);
      ctx.closePath();
      ctx.fill();
      // Floor ticks
      ctx.fillStyle = P_ELEC_BEAM;
      for (let xi = sx + 4; xi < sx + w - 4; xi += 16) {
        ctx.fillRect(px(xi), markerY, 2, 4);
      }
    } else if (wt === 'crusher') {
      // Orange down-arrow
      ctx.fillStyle = P_CRUSH_WARN;
      const cx = sx + w / 2;
      // Shaft
      ctx.fillRect(cx - 3, markerY - 10, 6, 8);
      // Arrow head
      ctx.beginPath();
      ctx.moveTo(cx, markerY + 2);
      ctx.lineTo(cx - 8, markerY - 6);
      ctx.lineTo(cx + 8, markerY - 6);
      ctx.closePath();
      ctx.fill();
    } else if (wt === 'crumble') {
      // Red zig-zag crack
      ctx.strokeStyle = '#FF6600';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const crackStep = Math.max(8, w / 5);
      ctx.moveTo(sx, markerY - 2);
      let xi = sx;
      let dir = 1;
      while (xi < sx + w) {
        xi = Math.min(xi + crackStep, sx + w);
        ctx.lineTo(px(xi), markerY - 2 + dir * 5);
        dir = -dir;
      }
      ctx.stroke();
    } else {
      // 'moving' — yellow double chevron arrows
      ctx.fillStyle = P_WARN_MKR;
      const arrowW = 10;
      const arrowH = 8;
      const midY = markerY - 4;
      const centerX = sx + w / 2;
      // Left-pointing arrow
      ctx.beginPath();
      ctx.moveTo(centerX - 4,           midY);
      ctx.lineTo(centerX - 4 + arrowW,  midY - arrowH / 2);
      ctx.lineTo(centerX - 4 + arrowW,  midY + arrowH / 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(centerX - 4 + arrowW + 4,           midY);
      ctx.lineTo(centerX - 4 + arrowW + 4 + arrowW,  midY - arrowH / 2);
      ctx.lineTo(centerX - 4 + arrowW + 4 + arrowW,  midY + arrowH / 2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  private drawShiftingGapMarker(obs: Obstacle, groundY: number, cameraX: number) {
    const { ctx } = this;
    const x = px(obsX(obs) - cameraX);
    const w = px(obsW(obs));
    const pulse = 0.35 + Math.sin((obs.animationProgress ?? 0) * 18) * 0.2;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 188, 70, ${pulse})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, groundY - 8);
    ctx.lineTo(x, groundY + 10);
    ctx.moveTo(x + w, groundY - 8);
    ctx.lineTo(x + w, groundY + 10);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawHitboxOverlay(
    obstacles: import('./types').Obstacle[],
    groundY: number,
    cameraX: number,
    playerX: number,
    playerY: number,
    playerW: number,
    playerH: number,
  ) {
    const { ctx } = this;
    const INSET = 4;
    const DOUBLE_SPIKE_GAP = 16;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.5;

    // Player — green
    ctx.strokeStyle = '#00ff88';
    ctx.strokeRect(
      px(playerX + INSET - cameraX),
      px(playerY),
      px(playerW - INSET * 2),
      px(playerH),
    );

    for (const o of obstacles) {
      const sx = px((o.currentX ?? o.x) - cameraX);
      const sw = px(o.currentWidth ?? o.width);
      const sh = px(o.currentHeight ?? o.height);

      if (o.kind === 'spike') {
        const tipX = sx + sw / 2;
        const tipY = px(groundY) - sh;
        ctx.strokeStyle = '#ff4444';
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(sx + sw, px(groundY));
        ctx.lineTo(sx, px(groundY));
        ctx.closePath();
        ctx.stroke();
      } else if (o.kind === 'doubleSpike') {
        const spikeW = (px(o.currentWidth ?? o.width) - px(DOUBLE_SPIKE_GAP)) / 2;
        const gapPx = px(DOUBLE_SPIKE_GAP);
        const tipY = px(groundY) - sh;
        ctx.strokeStyle = '#ff4444';
        for (let i = 0; i < 2; i++) {
          const left = sx + i * (spikeW + gapPx);
          ctx.beginPath();
          ctx.moveTo(left + spikeW / 2, tipY);
          ctx.lineTo(left + spikeW, px(groundY));
          ctx.lineTo(left, px(groundY));
          ctx.closePath();
          ctx.stroke();
        }
      } else if (o.kind === 'platform' && o.disappearState !== 'invisible') {
        ctx.strokeStyle = '#4488ff';
        ctx.strokeRect(sx, px(groundY) - sh, sw, sh);
      } else if (o.kind === 'lowCeiling') {
        ctx.strokeStyle = '#ffff00';
        ctx.strokeRect(sx, px(groundY) - sh - 16, sw, 16);
      } else if (o.kind === 'choiceObstacle') {
        ctx.strokeStyle = '#ff88ff';
        ctx.strokeRect(sx, px(groundY) - sh, sw, sh);
      } else if (o.kind === 'gap') {
        ctx.strokeStyle = '#ff8800';
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(sx, px(groundY) - 4, sw, 8);
        ctx.setLineDash([]);
      } else if (o.kind === 'electricField' && o.aiModState === 'active') {
        ctx.strokeStyle = '#00ffff';
        ctx.strokeRect(sx, px(groundY) - sh, sw, sh);
      } else if (o.kind === 'crusherCeiling') {
        const clearance = o.aiModVisualHeight ?? CRUSHER_RAISED_H;
        const slabH = 20;
        const slabTop = px(groundY) - clearance - slabH;
        const isActive = o.aiModState === 'active' || o.aiModState === 'crushing';
        ctx.strokeStyle = isActive ? '#ff4444' : '#ff880044';
        ctx.strokeRect(sx, slabTop, sw, slabH);
      }
    }

    ctx.restore();
  }
}
