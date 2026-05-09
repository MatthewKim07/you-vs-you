import { Game } from './game';
import './style.css';

// Prevent pinch-zoom and double-tap zoom on mobile.
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

let lastTap = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTap < 300) e.preventDefault();
  lastTap = now;
}, { passive: false });

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
(window as { __game?: Game }).__game = game;
game.start();
