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
  onGround = false;
  isCrouching = false;

  get height() {
    return this.currentHeight;
  }

  constructor(x: number, y: number) {
    this.pos = { x, y };
    this.vel = { x: MOVE_SPEED, y: 0 };
  }

  jump() {
    if (this.onGround) {
      if (this.isCrouching) {
        this.setCrouch(false);
      }
      this.vel.y = JUMP_FORCE;
      this.onGround = false;
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
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    if (onSolidGround) {
      const floorLine = groundY - this.height;
      if (this.pos.y >= floorLine) {
        this.pos.y = floorLine;
        this.vel.y = 0;
        this.onGround = true;
      } else {
        this.onGround = false;
      }
    } else {
      this.onGround = false;
    }
  }

  reset(x: number, y: number) {
    this.pos = { x, y };
    this.vel = { x: MOVE_SPEED, y: 0 };
    this.onGround = false;
    this.isCrouching = false;
    this.currentHeight = this.normalHeight;
  }
}
