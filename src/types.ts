export interface Vec2 {
  x: number;
  y: number;
}

export type ObstacleKind = 'spike' | 'gap';

export interface Obstacle {
  kind: ObstacleKind;
  x: number;       // world-space left edge
  width: number;
  height: number;  // spikes: visual/collision height; gaps: ignored
}

export type GameState = 'playing' | 'dead' | 'levelComplete' | 'allComplete';
