export interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Level {
  worldWidth: number;
  groundY: number; // top of ground, set at runtime based on canvas height
  flagX: number;
  obstacles: Obstacle[];
}

export function createLevel(canvasHeight: number): Level {
  return {
    worldWidth: 4000,
    groundY: canvasHeight - 80,
    flagX: 3600,
    // AI HOOK (Milestone 2+): obstacles populated by adaptive generator using past run data
    obstacles: [],
  };
}
