export class InputHandler {
  private jumpPressed = false;
  private jumpReleased = false;
  private crouchHeld = false;

  private pointerDown = false;
  private holdActivated = false;
  private holdTimer: number | null = null;
  private readonly holdMs = 180;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (isTypingTarget(document.activeElement)) return;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        if (!e.repeat) {
          this.jumpPressed = true;
        }
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        this.crouchHeld = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      if (isTypingTarget(document.activeElement)) return;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        this.jumpReleased = true;
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        this.crouchHeld = false;
      }
    });

    window.addEventListener('blur', () => {
      this.jumpPressed = false;
      this.jumpReleased = false;
      this.crouchHeld = false;
      this.pointerDown = false;
      this.holdActivated = false;
      this.clearHoldTimer();
    });

    // Mobile + mouse pointer control:
    // quick tap => jump, hold => crouch while held.
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.pointerDown) return;
      this.pointerDown = true;
      this.holdActivated = false;
      this.clearHoldTimer();
      this.holdTimer = window.setTimeout(() => {
        if (this.pointerDown) {
          this.holdActivated = true;
          this.crouchHeld = true;
        }
      }, this.holdMs);
    });

    const finishPointer = () => {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      this.clearHoldTimer();

      if (this.holdActivated) {
        this.crouchHeld = false;
        this.holdActivated = false;
      } else {
        this.jumpPressed = true;
      }
    };

    canvas.addEventListener('pointerup', finishPointer);
    canvas.addEventListener('pointercancel', finishPointer);
    canvas.addEventListener('pointerleave', finishPointer);
  }

  consumeJump(): boolean {
    if (this.jumpPressed) {
      this.jumpPressed = false;
      return true;
    }
    return false;
  }

  isCrouchHeld(): boolean {
    return this.crouchHeld;
  }

  consumeJumpRelease(): boolean {
    if (this.jumpReleased) {
      this.jumpReleased = false;
      return true;
    }
    return false;
  }

  private clearHoldTimer() {
    if (this.holdTimer !== null) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }
}

function isTypingTarget(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
