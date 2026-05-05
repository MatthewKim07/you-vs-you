export class InputHandler {
  private jumpPressed = false;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        this.jumpPressed = true;
      }
    });

    // Single handler for both touch and mouse
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.jumpPressed = true;
    });
  }

  consumeJump(): boolean {
    if (this.jumpPressed) {
      this.jumpPressed = false;
      return true;
    }
    return false;
  }
}
