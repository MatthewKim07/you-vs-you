// AI HOOK (Milestone 2+): record jump events into RunRecord for adaptive level generation
import { Vec2 } from './types';

const GRAVITY = 1400;    // px/s²
const JUMP_FORCE = -620; // px/s (negative = up)
const MOVE_SPEED = 230;  // px/s, constant rightward movement

export class Player {
  pos: Vec2;
  vel: Vec2;
  readonly width = 32;
  readonly height = 48;
  onGround = false;

  constructor(x: number, y: number) {
    this.pos = { x, y };
    this.vel = { x: MOVE_SPEED, y: 0 };
  }

  jump() {
    if (this.onGround) {
      this.vel.y = JUMP_FORCE;
      this.onGround = false;
    }
  }

  update(dt: number, groundY: number) {
    this.vel.y += GRAVITY * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // Ground collision
    const floorLine = groundY - this.height;
    if (this.pos.y >= floorLine) {
      this.pos.y = floorLine;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
  }

  reset(x: number, y: number) {
    this.pos = { x, y };
    this.vel = { x: MOVE_SPEED, y: 0 };
    this.onGround = false;
  }
}
