import { Game } from './game';
import './style.css';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
(window as { __game?: Game }).__game = game;
game.start();
