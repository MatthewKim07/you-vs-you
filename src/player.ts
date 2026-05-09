import { Vec2 } from './types';

export const GRAVITY = 1400;    // px/s²
export const JUMP_FORCE = -620; // px/s (negative = up)
export const MOVE_SPEED = 230;  // px/s, constant rightward movement

export class Player {
  pos: Vec2;
  vel: Vec2;
  readonly width = 32;
  readonly normalHeight = 48;
  readonly crouchHeight = 30;
  private currentHeight = this.normalHeight;
  private speedMultiplier = 1;
  onGround = false;
  isCrouching = false;
  hasDoubleJump = false;
  private doubleJumpUsed = false;

  get height() {
    return this.currentHeight;
  }

  constructor(x: number, y: number) {
    this.pos = { x, y };
    this.vel = { x: MOVE_SPEED * this.speedMultiplier, y: 0 };
  }

  jump(): boolean {
    if (this.onGround) {
      if (this.isCrouching) {
        this.setCrouch(false);
      }
      this.vel.y = JUMP_FORCE;
      this.onGround = false;
      this.doubleJumpUsed = false;
      return true;
    }
    if (this.hasDoubleJump && !this.doubleJumpUsed) {
      this.vel.y = JUMP_FORCE;
      this.doubleJumpUsed = true;
      return true;
    }
    return false;
  }

  cutJump(factor: number) {
    if (this.onGround || this.vel.y >= 0) return;
    const cutVelocity = JUMP_FORCE * factor; // JUMP_FORCE is negative
    if (this.vel.y < cutVelocity) {
      this.vel.y = cutVelocity;
    }
  }

  setCrouch(crouch: boolean) {
    if (crouch) {
      if (!this.onGround || this.isCrouching) return;
      const delta = this.normalHeight - this.crouchHeight;
      this.currentHeight = this.crouchHeight;
      this.pos.y += delta;
      this.isCrouching = true;
      return;
    }

    if (!this.isCrouching) return;
    const delta = this.normalHeight - this.crouchHeight;
    this.currentHeight = this.normalHeight;
    if (this.onGround) {
      this.pos.y -= delta;
    }
    this.isCrouching = false;
  }

  // onSolidGround: false when player is over a gap — skip floor collision
  update(dt: number, groundY: number, onSolidGround: boolean) {
    this.vel.y += GRAVITY * dt;
    this.vel.x = MOVE_SPEED * this.speedMultiplier;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    if (onSolidGround) {
      const floorLine = groundY - this.height;
      if (this.pos.y >= floorLine) {
        this.pos.y = floorLine;
        this.vel.y = 0;
        this.onGround = true;
        this.doubleJumpUsed = false;
      } else {
        this.onGround = false;
      }
    } else {
      this.onGround = false;
    }
  }

  reset(x: number, y: number) {
    this.pos = { x, y };
    this.vel = { x: MOVE_SPEED * this.speedMultiplier, y: 0 };
    this.onGround = false;
    this.isCrouching = false;
    this.currentHeight = this.normalHeight;
    this.doubleJumpUsed = false;
  }

  setSpeedMultiplier(multiplier: number) {
    this.speedMultiplier = Math.max(0.7, Math.min(1.5, multiplier));
    this.vel.x = MOVE_SPEED * this.speedMultiplier;
  }
}
