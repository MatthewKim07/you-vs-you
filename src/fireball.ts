import { Obstacle, ObstacleKind } from './types';
import { CRUSHER_RAISED_H } from './levelMutator';

export const FIREBALL_SPEED     = 620;  // px/s
export const FIREBALL_MAX_RANGE = 480;  // 15 × player width (5 × 32px × 3)
// Hitbox matches player crouching size: 32px wide, 30px tall.
// When standing the fireball is the same size but centred at torso — same as if crouching.
export const FIREBALL_HALF_W    = 16;   // half of player width       (32 / 2)
export const FIREBALL_HALF_H    = 15;   // half of player crouch height (30 / 2)
export const HIT_EFFECT_DURATION = 0.38; // seconds

// Obstacles the fireball can destroy. Gap and warningMarker are indestructible.
const DESTRUCTIBLE_KINDS = new Set<ObstacleKind>([
  'spike',
  'doubleSpike',
  'electricField',
  'crusherCeiling',
  'lowCeiling',
  'choiceObstacle',
  'platform',
]);

export function isDestructible(obs: Obstacle): boolean {
  return DESTRUCTIBLE_KINDS.has(obs.kind);
}

/** Compute [top, bottom] screen-Y bounds for an obstacle given groundY. */
function obstacleVerticalBounds(obs: Obstacle, groundY: number): [number, number] {
  switch (obs.kind) {
    case 'platform': {
      // Platform is 16px thick. Account for drop offset so hitbox tracks the falling tile.
      const h = obs.currentHeight ?? obs.height;
      const dropOffset = (obs.aiModifier === 'droppingPlatform' || obs.aiModifier === 'crumblePlatform')
        ? (obs.aiModDropOffset ?? 0) : 0;
      const surfaceY = groundY - h + dropOffset;
      return [surfaceY, surfaceY + 16];
    }
    case 'crusherCeiling': {
      // aiModVisualHeight tracks current clearance (animated), so hitbox moves with the slab.
      const clearance = obs.aiModVisualHeight ?? obs.height ?? CRUSHER_RAISED_H;
      const slabH = 20;
      const slabTop    = groundY - clearance - slabH;
      const slabBottom = groundY - clearance;
      return [slabTop, slabBottom];
    }
    case 'lowCeiling': {
      // Low ceiling is a 16px slab. Its bottom edge is at groundY - height.
      // Only the slab itself is hittable, not the empty space above it.
      const slabBottom = groundY - obs.height;
      return [slabBottom - 16, slabBottom];
    }
    case 'choiceObstacle': {
      const effectiveH = obs.currentHeight ?? obs.height;
      return [groundY - effectiveH, groundY];
    }
    default: {
      // Ground-based hazards (spike, doubleSpike, electricField, platform-elevated spikes).
      const effectiveH = obs.aiModVisualHeight ?? obs.height;
      const baseY = obs.elevationH !== undefined ? groundY - obs.elevationH : groundY;
      return [baseY - effectiveH, baseY];
    }
  }
}

export interface FireballHitEffect {
  x: number;
  y: number;
  age: number; // 0..HIT_EFFECT_DURATION
}

export class Fireball {
  x: number;
  y: number;
  age = 0;
  distTraveled = 0;
  alive = true;
  hitEffect: FireballHitEffect | null = null;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  update(dt: number, obstacles: Obstacle[], groundY: number): void {
    if (!this.alive) {
      if (this.hitEffect) {
        this.hitEffect.age += dt;
        if (this.hitEffect.age >= HIT_EFFECT_DURATION) this.hitEffect = null;
      }
      return;
    }

    const dx = FIREBALL_SPEED * dt;
    this.x += dx;
    this.age += dt;
    this.distTraveled += dx;

    if (this.distTraveled >= FIREBALL_MAX_RANGE) {
      this.alive = false;
      return;
    }

    // Collision — character-sized AABB: 32px wide × 48px tall
    const fbLeft   = this.x - FIREBALL_HALF_W;
    const fbRight  = this.x + FIREBALL_HALF_W;
    const fbTop    = this.y - FIREBALL_HALF_H;
    const fbBottom = this.y + FIREBALL_HALF_H;

    for (const obs of obstacles) {
      if (!isDestructible(obs) || obs.fireballDestroyed) continue;
      const ox    = obs.currentX ?? obs.x;
      const ow    = obs.currentWidth ?? obs.width;
      const oLeft = ox;
      const oRight = ox + ow;

      // Horizontal overlap
      if (fbRight <= oLeft || fbLeft >= oRight) continue;

      // Vertical overlap
      const [obsTop, obsBottom] = obstacleVerticalBounds(obs, groundY);
      if (fbBottom <= obsTop || fbTop >= obsBottom) continue;

      // Hit — mark destroyed (caller clears this on respawn, not permanent)
      this.hitEffect = { x: ox + ow / 2, y: this.y, age: 0 };
      this.alive = false;
      obs.fireballDestroyed = true;
      return;
    }
  }

  get isRenderable(): boolean {
    return this.alive || this.hitEffect !== null;
  }
}
