export class InputHandler {
  private jumpPressed = false;
  private jumpReleased = false;
  private crouchHeld = false;
  private abilityPressed = false;

  constructor(_canvas: HTMLCanvasElement) {
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
      } else if (e.code === 'KeyE') {
        e.preventDefault();
        if (!e.repeat) {
          this.abilityPressed = true;
        }
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
      this.abilityPressed = false;
    });
  }

  pressJump(): void {
    this.jumpPressed = true;
  }

  releaseJump(): void {
    this.jumpReleased = true;
  }

  pressCrouch(): void {
    this.crouchHeld = true;
  }

  releaseCrouch(): void {
    this.crouchHeld = false;
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

  pressAbility(): void {
    this.abilityPressed = true;
  }

  consumeAbility(): boolean {
    if (this.abilityPressed) {
      this.abilityPressed = false;
      return true;
    }
    return false;
  }
}

function isTypingTarget(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
