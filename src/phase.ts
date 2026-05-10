import { Obstacle, ObstacleKind } from './types';
import { CRUSHER_RAISED_H } from './levelMutator';
import { isPlayerOnPlatform } from './aiTrapDirector';
import { MOVE_SPEED } from './player';

/**
 * Max distance ahead (from player front) to search for a phase target.
 * Phase is a *short-range* bypass — far targets should not pull the player across the level.
 */
export const PHASE_MAX_SCAN = 460;
/**
 * Hard cap on how far Phase may translate the player horizontally (player.x → land.x).
 * Prevents the long-range "phases halfway across the level" feel and bounds airborne phases.
 */
export const PHASE_MAX_TELEPORT_DISTANCE = 320;
/**
 * Extra horizontal budget (px) for reaction-trap **chain** landings only. The final pose must clear a
 * second obstacle’s `minX`, which often exceeds `playerStartX + PHASE_MAX_TELEPORT_DISTANCE` by a
 * small margin (e.g. choice gate + tight ground spike) — without slack the chain fails with
 * `outOfReach` and phase returns `noLandingFound`.
 */
const PHASE_CHAIN_TELEPORT_SLACK = 80;
/** Horizontal gap left between obstacle right edge and where the player’s left edge may land. */
export const PHASE_PAST_MARGIN = 14;
/** Keep landing at least this far before the flag so level-complete does not trigger from Phase alone. */
export const PHASE_FLAG_GUARD = 44;
/** After the obstacle, step forward until we find solid ground (first guess often sits over a pit). */
const LAND_PROBE_STEP = 4;
const LAND_PROBE_MAX_OFFSET = 320;
export const PHASE_FX_DURATION = 0.26;
export const PHASE_DENY_FX_DURATION = 0.16;

export interface PhaseFxState {
  age: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  playerH: number;
  crouch: boolean;
}

export interface PhaseDenyFxState {
  age: number;
  x: number;
  y: number;
}

const SUPPORT_EDGE_INSET = 0;
/** Must match `Player.normalHeight` — used for low-ceiling phase window vs walkable-under ceilings. */
const PLAYER_STANDING_H = 48;
/** Must match `game.ts` LOW_CEILING_THICKNESS / renderer CEIL_THICKNESS. */
const LOW_CEILING_SLAB_H = 16;
/** Must match `game.ts` CHOICE_BAR_THICKNESS / renderer CHOICE_THICKNESS. */
const CHOICE_BAR_THICKNESS = 12;
/** Must match `game.ts` MIN_SUPPORT_WIDTH — same threshold as “standing in the hole”. */
const PHASE_GAP_FOOTPRINT_DENY_PX = 8;
/**
 * Auto-scroll hazard probe: if we'd enter lethal overlap within this horizon (at current scroll
 * speed), chain phase. ~0.5s matches the same order of magnitude as movementTuning reaction spacing
 * (MOVE_SPEED * 0.65–0.75s); the old 0.2s window was far too short and missed “one frame” spike gaps.
 */
const PHASE_REACTION_ESCAPE_SEC = 0.5;
/** Match `game.ts` hitSpike / hitPlatformNeedle INSET for separation vs hazard X extents. */
const PHASE_HAZARD_X_INSET = 4;
/**
 * When airborne with feet at least this far above main floor, full-corridor hazards (low ceiling,
 * gap, …) still count as phase targets so upper-route jumps can clear them horizontally without a
 * strict AABB overlap (which only matches the lower route).
 */
const AIRBORNE_FULL_LANE_MIN_CLEAR_ABOVE_FLOOR = 36;

/** World-space vertical span [topY, bottomY] for phase overlap tests (down-positive Y). */
export function phaseObstacleVerticalSpan(obs: Obstacle, groundY: number): [number, number] | null {
  switch (obs.kind) {
    case 'warningMarker':
      return null;
    case 'choiceObstacle': {
      // Match hitChoiceObstacle geometry: bar at [spikeBaseY, barBottom], jump-counter spikes
      // grow upward from spikeBaseY by spikeExt. Phase span covers the full visible obstacle.
      const ch = obs.currentHeight ?? obs.height;
      const barBottom = groundY - ch;
      const spikeBaseY = barBottom - CHOICE_BAR_THICKNESS;
      const spikeExt =
        obs.trapType === 'adaptiveChoiceGateJump' ? (obs.currentSpikeExt ?? 0) : 0;
      const barTop = spikeBaseY - spikeExt;
      return [barTop, barBottom];
    }
    case 'gap': {
      // Only the floor-line strip: phase past a pit only if the player’s body (feet band) is at walk height.
      // Avoids matching airborne players or treating the whole void below as part of the window.
      return [groundY - 3, groundY + 3];
    }
    case 'platform': {
      const h = obs.currentHeight ?? obs.height;
      const dropOffset =
        obs.aiModifier === 'droppingPlatform' || obs.aiModifier === 'crumblePlatform'
          ? (obs.aiModDropOffset ?? 0)
          : 0;
      const surfaceY = groundY - h + dropOffset;
      return [surfaceY, surfaceY + 16];
    }
    case 'crusherCeiling': {
      const clearance = obs.aiModVisualHeight ?? obs.height ?? CRUSHER_RAISED_H;
      const slabH = 20;
      const slabTop = groundY - clearance - slabH;
      const slabBottom = groundY - clearance;
      return [slabTop, slabBottom];
    }
    case 'lowCeiling': {
      const ch = obs.currentHeight ?? obs.height;
      const slabTop = groundY - ch - LOW_CEILING_SLAB_H;
      const slabBottom = groundY - ch;
      // Collision is only the slab (see hitLowCeiling). Phase must still match when the player is
      // crouch-walking the underpass (body entirely below slabBottom) or flush in the tunnel.
      if (ch < PLAYER_STANDING_H) {
        return [slabTop, groundY + 3];
      }
      return [slabTop, slabBottom];
    }
    case 'electricField': {
      const fieldTop = groundY - obs.height;
      return [fieldTop, groundY];
    }
    default: {
      if (obs.kind !== 'spike' && obs.kind !== 'doubleSpike') return null;
      const usesAnimatedHeight = obs.aiModifier === 'risingSpike' || obs.aiModifier === 'pulsingSpike';
      const sh = usesAnimatedHeight ? (obs.aiModVisualHeight ?? 0) : (obs.currentHeight ?? obs.height);
      const baseY = obs.elevationH !== undefined ? groundY - obs.elevationH : groundY;
      return [baseY - sh, baseY];
    }
  }
}

function phaseKindAllowed(kind: ObstacleKind): boolean {
  return (
    kind === 'spike' ||
    kind === 'doubleSpike' ||
    kind === 'gap' ||
    kind === 'lowCeiling' ||
    kind === 'platform' ||
    kind === 'electricField' ||
    kind === 'crusherCeiling' ||
    kind === 'choiceObstacle'
  );
}

function effectiveSpikeHeight(obs: Obstacle): number {
  const usesAnimatedHeight = obs.aiModifier === 'risingSpike' || obs.aiModifier === 'pulsingSpike';
  return usesAnimatedHeight ? (obs.aiModVisualHeight ?? 0) : (obs.currentHeight ?? obs.height);
}

function obstacleIsPhaseRelevant(obs: Obstacle): boolean {
  if (obs.fireballDestroyed || !phaseKindAllowed(obs.kind)) return false;

  if (obs.kind === 'spike' || obs.kind === 'doubleSpike') {
    return effectiveSpikeHeight(obs) >= 4;
  }

  if (obs.kind === 'electricField') {
    const st = obs.aiModState;
    return st === 'warning' || st === 'active';
  }

  if (obs.kind === 'crusherCeiling') {
    const st = obs.aiModState;
    return st === 'warning' || st === 'crushing' || st === 'active';
  }

  if (obs.kind === 'platform') {
    if (obs.disappearState === 'invisible') return false;
    if (obs.trapType === 'collapsingPlatform' && obs.trapState === 'spent') return false;
    if (obs.aiModifier === 'droppingPlatform' && (obs.aiModState === 'dropping' || obs.aiModState === 'invisible')) {
      return false;
    }
    if (obs.aiModifier === 'crumblePlatform' && (obs.aiModState === 'dropping' || obs.aiModState === 'invisible')) {
      return false;
    }
    if (obs.aiModifier === 'temporaryBlocker' && obs.aiModState === 'active') return false;
    return true;
  }

  return true;
}

/**
 * True iff obstacle vertical span intersects the player’s body at activation.
 * Uses the strict AABB [playerTop, playerBottom] only (head..feet). No margin below feet or above head.
 */
function obstacleIntersectsPlayerHeight(
  playerTop: number,
  playerBottom: number,
  bandTop: number,
  bandBottom: number,
): boolean {
  const e = 1; // boundary contact (flush head/feet vs band edge)
  return playerBottom > bandTop - e && playerTop < bandBottom + e;
}

/** Full-corridor barriers (low ceiling, gap, etc.) — distinguished from spike/platform lanes for airborne reach. */
function phaseSkipsNarrowLaneGate(o: Obstacle): boolean {
  return (
    o.kind === 'lowCeiling' ||
    o.kind === 'gap' ||
    o.kind === 'electricField' ||
    o.kind === 'crusherCeiling'
  );
}

/**
 * Obstacle is overlapping the player or strictly ahead within PHASE_MAX_SCAN.
 * The vertical filter (phaseObstacleVerticalSpan) is what prevents adjacent-lane targeting; the
 * older "lateral gap ≤ 120" rule was conflating "ahead" with "off lane" and silently rejected
 * spikes/platforms that were clearly in the player's forward path. Combined with
 * PHASE_MAX_TELEPORT_DISTANCE, this still cannot pull the player across the level.
 */
function obstacleInPlayerHorizontalLane(o: Obstacle, playerX: number, playerW: number, _scanX: number): boolean {
  const pL = playerX;
  const pR = playerX + playerW;
  const oL = obsLeft(o);
  const oR = obsRight(o);

  if (pR > oL && pL < oR) return true;

  const forwardWindow = pR + PHASE_MAX_SCAN;
  return oR > pL && oL < forwardWindow;
}

/** Effective upward spike extent for platformNeedle (matches runtime once armed). */
function platformNeedlePhaseExtent(o: Obstacle): number {
  if (o.trapType !== 'platformNeedle') return 0;
  const cur = o.currentSpikeExt ?? 0;
  const tgt = o.targetSpikeExt ?? 34;
  // Floor so cold-start / lerp-from-zero still gets a LOS band; explicit 0/0 would leave only 16px slab.
  return Math.max(cur, tgt, 28);
}

function platformVerticallyPhaseAligned(
  o: Obstacle,
  groundY: number,
  playerTop: number,
  playerBottom: number,
): boolean {
  const oh = o.currentHeight ?? o.height;
  const dropOffset =
    o.aiModifier === 'droppingPlatform' || o.aiModifier === 'crumblePlatform'
      ? (o.aiModDropOffset ?? 0)
      : 0;
  const platformTop = groundY - oh + dropOffset;
  const platformBottom = platformTop + 16;

  // Deck spikes: collision uses [spikeTop, platformTop] (see hitPlatformNeedle). The 16px slab alone
  // can sit above the body while triangles still block the lane — include the needle column.
  if (o.trapType === 'platformNeedle') {
    const ext = platformNeedlePhaseExtent(o);
    const spikeTop = platformTop - ext;
    if (obstacleIntersectsPlayerHeight(playerTop, playerBottom, spikeTop, platformBottom)) {
      return true;
    }
  }

  return obstacleIntersectsPlayerHeight(playerTop, playerBottom, platformTop, platformBottom);
}

function obsLeft(obs: Obstacle): number {
  return obs.currentX ?? obs.x;
}

function obsRight(obs: Obstacle): number {
  return obsLeft(obs) + (obs.currentWidth ?? obs.width);
}

/**
 * All phase targets ahead, nearest first — same filters as legacy single-target pick.
 */
export function findPhaseObstacleCandidates(
  obstacles: Obstacle[],
  groundY: number,
  playerX: number,
  playerY: number,
  playerW: number,
  playerH: number,
  scanX: number,
  airborne = false,
): Obstacle[] {
  const playerTop = playerY;
  const playerBottom = playerY + playerH;
  const maxAhead = scanX + PHASE_MAX_SCAN;
  const fullLaneAirborne =
    airborne &&
    playerBottom <= groundY - AIRBORNE_FULL_LANE_MIN_CLEAR_ABOVE_FLOOR;

  const candidates: Obstacle[] = [];
  for (const o of obstacles) {
    if (!obstacleIsPhaseRelevant(o)) continue;

    if (o.kind === 'platform') {
      if (!platformVerticallyPhaseAligned(o, groundY, playerTop, playerBottom)) continue;
    } else {
      const span = phaseObstacleVerticalSpan(o, groundY);
      if (!span) continue;
      const [bandTop, bandBottom] = span;
      const bodyHits = obstacleIntersectsPlayerHeight(playerTop, playerBottom, bandTop, bandBottom);
      const countFullLaneAir =
        fullLaneAirborne && phaseSkipsNarrowLaneGate(o);
      if (!bodyHits && !countFullLaneAir) continue;
    }

    if (!obstacleInPlayerHorizontalLane(o, playerX, playerW, scanX)) continue;

    const left = obsLeft(o);
    const right = obsRight(o);
    if (right <= scanX) continue;
    if (left > maxAhead) continue;

    // Standing on a normal platform means "already past" its solid — skip. Platform-needle decks
    // are different: feet are on the same obstacle you phase past (spikes ahead on the deck).
    if (
      o.kind === 'platform' &&
      o.trapType !== 'platformNeedle' &&
      isPlayerOnPlatform(o, playerX, playerY, playerW, playerH, groundY)
    ) {
      continue;
    }

    candidates.push(o);
  }

  candidates.sort((a, b) => obsLeft(a) - obsLeft(b));
  return candidates;
}

/**
 * Nearest phase target ahead (compat); prefer resolvePhaseRelocation’s multi-candidate loop for gameplay.
 */
export function findPhaseObstacle(
  obstacles: Obstacle[],
  groundY: number,
  playerX: number,
  playerY: number,
  playerW: number,
  playerH: number,
  scanX: number,
  airborne = false,
): Obstacle | null {
  const c = findPhaseObstacleCandidates(
    obstacles,
    groundY,
    playerX,
    playerY,
    playerW,
    playerH,
    scanX,
    airborne,
  );
  return c[0] ?? null;
}

/**
 * Find (x, y) just past the obstacle with solid floor and no immediate death.
 * A single x at obstacleRight+margin often lies entirely over a gap → getEffectiveFloor null → deny.
 */
function tryLandBeyondObstacle(
  target: Obstacle,
  playerStartX: number,
  playerW: number,
  playerH: number,
  playerBottom: number,
  currentFloor: number | null,
  flagX: number,
  worldWidth: number,
  getEffectiveFloor: PhaseFloorQuery,
  hazardsWouldKill: (px: number, pyTop: number) => boolean,
  bodyOverlapsSolid: PhaseBodySolidQuery,
  teleportExtraPx = 0,
  attemptOut?: { note: string },
): { x: number; y: number } | null {
  const oRight = obsRight(target);
  const minX = oRight + PHASE_PAST_MARGIN;
  if (minX + playerW < oRight + 8) {
    if (attemptOut) attemptOut.note = 'tooSmallProbe';
    return null;
  }

  const flagCap = flagX - playerW - PHASE_FLAG_GUARD;
  const teleportMax = PHASE_MAX_TELEPORT_DISTANCE + teleportExtraPx;
  const teleportCap = playerStartX + teleportMax;
  const maxXCap = Math.min(worldWidth - playerW - 6, flagCap, teleportCap);
  const maxX = Math.min(maxXCap, minX + LAND_PROBE_MAX_OFFSET);
  if (minX > maxXCap) {
    if (attemptOut) {
      attemptOut.note =
        teleportCap < flagCap && teleportCap < worldWidth - playerW - 6
          ? `outOfReach(>${teleportMax}px)`
          : minX > flagCap
            ? 'flagGuardBlocks'
            : 'worldEdge';
    }
    return null;
  }

  let probeFails: { floorNull: number; tierMismatch: number; hazard: number; embed: number } = {
    floorNull: 0,
    tierMismatch: 0,
    hazard: 0,
    embed: 0,
  };

  for (let x = minX; x <= maxX; x += LAND_PROBE_STEP) {
    if (x + playerW >= flagX - 4) break;

    const footL = x + SUPPORT_EDGE_INSET;
    const footR = x + playerW - SUPPORT_EDGE_INSET;
    const floorAtDest = getEffectiveFloor(footL, footR, playerBottom, 0);
    if (floorAtDest === null) {
      probeFails.floorNull++;
      continue;
    }

    if (
      currentFloor !== null &&
      Math.abs(floorAtDest - currentFloor) > PHASE_SAME_TIER_EPS
    ) {
      probeFails.tierMismatch++;
      continue;
    }

    const landY = floorAtDest - playerH;
    if (bodyOverlapsSolid(x, landY, playerW, playerH)) {
      probeFails.embed++;
      continue;
    }
    if (hazardsWouldKill(x, landY)) {
      probeFails.hazard++;
      continue;
    }

    return { x, y: landY };
  }

  if (attemptOut) {
    attemptOut.note = `noProbeFit(floor:${probeFails.floorNull} tier:${probeFails.tierMismatch} hazard:${probeFails.hazard} embed:${probeFails.embed})`;
  }
  return null;
}

/** Airborne: same world Y, only X advances — avoids getEffectiveFloor snapping to ground mid-jump. */
function tryPhaseBeyondObstacleAirborne(
  target: Obstacle,
  playerStartX: number,
  playerY: number,
  playerW: number,
  playerH: number,
  flagX: number,
  worldWidth: number,
  hazardsWouldKill: (px: number, pyTop: number) => boolean,
  bodyOverlapsSolid: (px: number, pyTop: number, w: number, h: number) => boolean,
  teleportExtraPx = 0,
  attemptOut?: { note: string },
): { x: number; y: number } | null {
  const oRight = obsRight(target);
  const minX = oRight + PHASE_PAST_MARGIN;
  if (minX + playerW < oRight + 8) {
    if (attemptOut) attemptOut.note = 'tooSmallProbe';
    return null;
  }

  const flagCap = flagX - playerW - PHASE_FLAG_GUARD;
  const teleportMax = PHASE_MAX_TELEPORT_DISTANCE + teleportExtraPx;
  const teleportCap = playerStartX + teleportMax;
  const maxXCap = Math.min(worldWidth - playerW - 6, flagCap, teleportCap);
  const maxX = Math.min(maxXCap, minX + LAND_PROBE_MAX_OFFSET);
  if (minX > maxXCap) {
    if (attemptOut) {
      attemptOut.note =
        teleportCap < flagCap && teleportCap < worldWidth - playerW - 6
          ? `outOfReach(>${teleportMax}px)`
          : 'edgeBlocks';
    }
    return null;
  }

  let solidFails = 0;
  let hazardFails = 0;

  for (let x = minX; x <= maxX; x += LAND_PROBE_STEP) {
    if (x + playerW >= flagX - 4) break;

    if (bodyOverlapsSolid(x, playerY, playerW, playerH)) {
      solidFails++;
      continue;
    }
    if (hazardsWouldKill(x, playerY)) {
      hazardFails++;
      continue;
    }

    return { x, y: playerY };
  }

  if (attemptOut) {
    attemptOut.note = `noProbeFit(solid:${solidFails} hazard:${hazardFails})`;
  }
  return null;
}

export type PhaseFloorQuery = (
  playerLeft: number,
  playerRight: number,
  playerBottom: number,
  verticalVelocity: number,
) => number | null;

export type PhaseBodySolidQuery = (px: number, pyTop: number, w: number, h: number) => boolean;

export type PhaseDenyReason =
  | 'inPit'
  | 'noCandidates'
  | 'allCandidatesUnreachable'
  | 'noLandingFound'
  | 'success';

export interface PhaseDebugInfo {
  reason: PhaseDenyReason;
  candidateCount: number;
  candidateKinds: string[];
  /** Per-candidate failure note (one line per candidate tried). */
  candidateAttempts: Array<{
    kind: string;
    x: number;
    width: number;
    note: string;
  }>;
  airborne: boolean;
  playerX: number;
  playerY: number;
  playerOnGround: boolean;
}

/**
 * Resolves a safe relocation for Phase, or returns null (no activation / no target).
 */
/** Max |Δfloor| when already on a support tier — keeps phase strictly horizontal between platforms. */
const PHASE_SAME_TIER_EPS = 12;

/** Horizontal overlap between footprint and all gap obstacles (same stacking idea as getEffectiveFloor). */
function horizontalSeparation1D(aL: number, aR: number, bL: number, bR: number): number {
  if (aR <= bL) return bL - aR;
  if (bR <= aL) return aL - bR;
  return 0;
}

/**
 * True if the next forward spike / deck-needle (same vertical band as the player) is closer than
 * `minSeparationPx` between hazard X extent and the player's standing AABB — catches cases where the
 * discrete scroll probe and triangle hitboxes disagree slightly.
 *
 * Obstacles entirely to the left of the landing pose are ignored (e.g. the platformNeedle deck you
 * just cleared reads as a tiny separation and must not count as a “forward” tight gap).
 */
function tooTightHorizontalClearance(
  landX: number,
  landY: number,
  playerW: number,
  playerH: number,
  groundY: number,
  obstacles: Obstacle[],
  minSeparationPx: number,
): boolean {
  const playerTop = landY;
  const playerBottom = landY + playerH;
  const pl = landX + PHASE_HAZARD_X_INSET;
  const pr = landX + playerW - PHASE_HAZARD_X_INSET;

  for (const o of obstacles) {
    if (!obstacleIsPhaseRelevant(o)) continue;
    if (obsRight(o) <= pl) continue;

    if (o.kind === 'platform' && o.trapType === 'platformNeedle') {
      if (!platformVerticallyPhaseAligned(o, groundY, playerTop, playerBottom)) continue;
      const ox = obsLeft(o);
      const ow = o.currentWidth ?? o.width;
      if (horizontalSeparation1D(pl, pr, ox, ox + ow) < minSeparationPx) return true;
      continue;
    }

    if (o.kind !== 'spike' && o.kind !== 'doubleSpike') continue;

    const span = phaseObstacleVerticalSpan(o, groundY);
    if (!span) continue;
    const [bandTop, bandBottom] = span;
    if (!obstacleIntersectsPlayerHeight(playerTop, playerBottom, bandTop, bandBottom)) continue;

    const sx = obsLeft(o);
    const sw = o.currentWidth ?? o.width;
    if (horizontalSeparation1D(pl, pr, sx, sx + sw) < minSeparationPx) return true;
  }

  return false;
}

/**
 * After landing, constant rightward motion would push the AABB forward; if we'd hit a lethal hazard
 * within the reaction horizon (same vertical pose), or the next spike is within that same distance,
 * the landing is treated as inescapable and phase may chain.
 */
function landingIsReactionTrap(
  landX: number,
  landY: number,
  playerW: number,
  playerH: number,
  groundY: number,
  obstacles: Obstacle[],
  hazardsWouldKill: (px: number, pyTop: number) => boolean,
  reactionSpeedPxPerSec: number,
): boolean {
  const reactionPx = reactionSpeedPxPerSec * PHASE_REACTION_ESCAPE_SEC;
  const step = 2;
  for (let d = step; d <= reactionPx; d += step) {
    if (hazardsWouldKill(landX + d, landY)) return true;
  }
  return tooTightHorizontalClearance(
    landX,
    landY,
    playerW,
    playerH,
    groundY,
    obstacles,
    reactionPx,
  );
}

function footprintGapOverlapPx(
  playerLeft: number,
  playerRight: number,
  obstacles: Obstacle[],
): number {
  const footprintWidth = Math.max(0, playerRight - playerLeft);
  let total = 0;
  for (const o of obstacles) {
    if (o.kind !== 'gap') continue;
    const gx = o.currentX ?? o.x;
    const gw = o.currentWidth ?? o.width;
    const left = Math.max(playerLeft, gx);
    const right = Math.min(playerRight, gx + gw);
    total += Math.max(0, right - left);
  }
  return Math.min(total, footprintWidth);
}

export function resolvePhaseRelocation(
  obstacles: Obstacle[],
  groundY: number,
  flagX: number,
  worldWidth: number,
  playerX: number,
  playerY: number,
  playerW: number,
  playerH: number,
  scanX: number,
  airborne: boolean,
  getEffectiveFloor: PhaseFloorQuery,
  hazardsWouldKill: (px: number, pyTop: number) => boolean,
  bodyOverlapsSolid: PhaseBodySolidQuery,
  reactionSpeedPxPerSec: number = MOVE_SPEED,
  debugOut?: PhaseDebugInfo,
): { x: number; y: number } | null {
  const footL0 = playerX + SUPPORT_EDGE_INSET;
  const footR0 = playerX + playerW - SUPPORT_EDGE_INSET;
  const playerBottom = playerY + playerH;
  const currentFloor = getEffectiveFloor(footL0, footR0, playerBottom, 0);

  // No phasing once the feet are actually over the pit opening (in the hole). Falling/jumping above
  // solid ground can still use phase even if currentFloor is momentarily null — only gap overlap matters.
  const gapOverlap = footprintGapOverlapPx(footL0, footR0, obstacles);
  if (gapOverlap >= PHASE_GAP_FOOTPRINT_DENY_PX) {
    if (debugOut) {
      debugOut.reason = 'inPit';
      debugOut.candidateCount = 0;
      debugOut.candidateKinds = [];
      debugOut.candidateAttempts = [];
      debugOut.airborne = airborne;
      debugOut.playerX = playerX;
      debugOut.playerY = playerY;
      debugOut.playerOnGround = !airborne;
    }
    return null;
  }

  const targets = findPhaseObstacleCandidates(
    obstacles,
    groundY,
    playerX,
    playerY,
    playerW,
    playerH,
    scanX,
    airborne,
  );

  if (debugOut) {
    debugOut.candidateCount = targets.length;
    debugOut.candidateKinds = targets.map((t) =>
      t.trapType ? `${t.kind}/${t.trapType}` : t.kind,
    );
    debugOut.candidateAttempts = [];
    debugOut.airborne = airborne;
    debugOut.playerX = playerX;
    debugOut.playerY = playerY;
    debugOut.playerOnGround = !airborne;
  }

  if (targets.length === 0) {
    if (debugOut) debugOut.reason = 'noCandidates';
    return null;
  }

  for (let ti = 0; ti < targets.length; ti++) {
    const target = targets[ti];
    const attempt: { note: string } = { note: '' };
    let result: { x: number; y: number } | null = null;
    if (airborne) {
      result = tryPhaseBeyondObstacleAirborne(
        target,
        playerX,
        playerY,
        playerW,
        playerH,
        flagX,
        worldWidth,
        hazardsWouldKill,
        bodyOverlapsSolid,
        0,
        attempt,
      );
    } else {
      result = tryLandBeyondObstacle(
        target,
        playerX,
        playerW,
        playerH,
        playerBottom,
        currentFloor,
        flagX,
        worldWidth,
        getEffectiveFloor,
        hazardsWouldKill,
        bodyOverlapsSolid,
        0,
        attempt,
      );
    }

    if (debugOut) {
      debugOut.candidateAttempts.push({
        kind: target.trapType ? `${target.kind}/${target.trapType}` : target.kind,
        x: obsLeft(target),
        width: obsRight(target) - obsLeft(target),
        note: result ? 'OK' : attempt.note || 'failed',
      });
    }

    if (!result) {
      continue;
    }

    const primaryAttemptIdx = debugOut ? debugOut.candidateAttempts.length - 1 : -1;

    if (
      !landingIsReactionTrap(
        result.x,
        result.y,
        playerW,
        playerH,
        groundY,
        obstacles,
        hazardsWouldKill,
        reactionSpeedPxPerSec,
      )
    ) {
      if (debugOut) debugOut.reason = 'success';
      return result;
    }

    if (debugOut && primaryAttemptIdx >= 0) {
      debugOut.candidateAttempts[primaryAttemptIdx].note = 'OK(reactionTrap)';
    }

    // Reaction trap: try landing past the next candidate(s) as well.
    let chained: { x: number; y: number } | null = null;
    for (let tj = ti + 1; tj < targets.length; tj++) {
      const t2 = targets[tj];
      const att2: { note: string } = { note: '' };
      const r2 = airborne
        ? tryPhaseBeyondObstacleAirborne(
            t2,
            playerX,
            playerY,
            playerW,
            playerH,
            flagX,
            worldWidth,
            hazardsWouldKill,
            bodyOverlapsSolid,
            PHASE_CHAIN_TELEPORT_SLACK,
            att2,
          )
        : tryLandBeyondObstacle(
            t2,
            playerX,
            playerW,
            playerH,
            playerBottom,
            currentFloor,
            flagX,
            worldWidth,
            getEffectiveFloor,
            hazardsWouldKill,
            bodyOverlapsSolid,
            PHASE_CHAIN_TELEPORT_SLACK,
            att2,
          );

      if (debugOut) {
        debugOut.candidateAttempts.push({
          kind: t2.trapType ? `${t2.kind}/${t2.trapType}` : t2.kind,
          x: obsLeft(t2),
          width: obsRight(t2) - obsLeft(t2),
          note: r2
            ? `chain(after#${ti + 1})`
            : att2.note || 'failed',
        });
      }

      if (!r2) {
        continue;
      }

      if (
        !landingIsReactionTrap(
          r2.x,
          r2.y,
          playerW,
          playerH,
          groundY,
          obstacles,
          hazardsWouldKill,
          reactionSpeedPxPerSec,
        )
      ) {
        if (debugOut) debugOut.reason = 'success';
        return r2;
      }
      chained = r2;
    }

    // Do not return a chained landing that still fails the reaction window — try the next primary.
    if (chained) {
      if (debugOut && primaryAttemptIdx >= 0) {
        debugOut.candidateAttempts[primaryAttemptIdx].note = 'OK(reactionTrap→stillTight)';
        const lastA = debugOut.candidateAttempts[debugOut.candidateAttempts.length - 1];
        if (lastA?.note.startsWith('chain')) {
          lastA.note = `${lastA.note}(stillTight)`;
        }
      }
      continue;
    }

    if (debugOut && primaryAttemptIdx >= 0) {
      debugOut.candidateAttempts[primaryAttemptIdx].note = 'OK(reactionTrap→noChain)';
    }
  }

  if (debugOut) {
    const allOutOfReach = debugOut.candidateAttempts.every((a) => a.note.startsWith('outOfReach'));
    debugOut.reason = allOutOfReach ? 'allCandidatesUnreachable' : 'noLandingFound';
  }
  return null;
}
