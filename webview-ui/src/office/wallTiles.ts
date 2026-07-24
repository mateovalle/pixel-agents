/**
 * Wall tile auto-tiling: sprite storage and bitmask-based piece selection.
 *
 * Stores 16 wall sprites (one per 4-bit bitmask) loaded from walls.png.
 * At render time, each wall tile's 4 cardinal neighbors are checked to build
 * a bitmask, and the corresponding sprite is drawn directly.
 * No changes to the layout model — auto-tiling is purely visual.
 *
 * Bitmask convention: N=1, E=2, S=4, W=8. Out-of-bounds = NOT wall.
 */

import { getColorizedSprite, hslToHex } from './colorize.js';
import type {
  FloorColor,
  FurnitureInstance,
  SpriteData,
  TileType as TileTypeVal,
} from './types.js';
import { TILE_SIZE, TileType } from './types.js';

/** 16 wall sprites indexed by bitmask (0-15) */
let wallSprites: SpriteData[] | null = null;

/** Set wall sprites (called once when extension sends wallTilesLoaded) */
export function setWallSprites(sprites: SpriteData[]): void {
  wallSprites = sprites;
  wallInstanceCache = null;
}

/** Check if wall sprites have been loaded */
export function hasWallSprites(): boolean {
  return wallSprites !== null;
}

/** Build the 4-bit neighbor bitmask for a wall tile (N=1, E=2, S=4, W=8) */
function computeWallMask(col: number, row: number, tileMap: TileTypeVal[][]): number {
  const tmRows = tileMap.length;
  const tmCols = tmRows > 0 ? tileMap[0].length : 0;

  let mask = 0;
  if (row > 0 && tileMap[row - 1][col] === TileType.WALL) mask |= 1; // N
  if (col < tmCols - 1 && tileMap[row][col + 1] === TileType.WALL) mask |= 2; // E
  if (row < tmRows - 1 && tileMap[row + 1][col] === TileType.WALL) mask |= 4; // S
  if (col > 0 && tileMap[row][col - 1] === TileType.WALL) mask |= 8; // W
  return mask;
}

/**
 * Get the wall sprite for a tile based on its cardinal neighbors.
 * Returns the sprite + Y offset, or null to fall back to solid WALL_COLOR.
 */
export function getWallSprite(
  col: number,
  row: number,
  tileMap: TileTypeVal[][],
): { sprite: SpriteData; offsetY: number } | null {
  if (!wallSprites) return null;

  const mask = computeWallMask(col, row, tileMap);
  const sprite = wallSprites[mask];
  if (!sprite) return null;

  // Anchor sprite at bottom of tile — tall sprites extend upward
  return { sprite, offsetY: TILE_SIZE - sprite.length };
}

/**
 * Get a colorized wall sprite for a tile based on its cardinal neighbors.
 * Uses Colorize mode (grayscale → HSL) like floor tiles.
 * Returns the colorized sprite + Y offset, or null if no wall sprites loaded.
 */
export function getColorizedWallSprite(
  col: number,
  row: number,
  tileMap: TileTypeVal[][],
  color: FloorColor,
): { sprite: SpriteData; offsetY: number } | null {
  if (!wallSprites) return null;

  const mask = computeWallMask(col, row, tileMap);
  const sprite = wallSprites[mask];
  if (!sprite) return null;

  const cacheKey = `wall-${mask}-${color.h}-${color.s}-${color.b}-${color.c}`;
  const colorized = getColorizedSprite(cacheKey, sprite, { ...color, colorize: true });

  return { sprite: colorized, offsetY: TILE_SIZE - sprite.length };
}

/** Memoized wall instances — rebuilt only when the layout-derived inputs change.
 *  Keyed by reference: rebuildFromLayout creates fresh tileMap/tileColors arrays. */
let wallInstanceCache: {
  tileMap: TileTypeVal[][];
  tileColors: Array<FloorColor | null> | undefined;
  cols: number | undefined;
  instances: FurnitureInstance[];
} | null = null;

/**
 * Build FurnitureInstance-like objects for all wall tiles so they can participate
 * in z-sorting with furniture and characters.
 */
export function getWallInstances(
  tileMap: TileTypeVal[][],
  tileColors?: Array<FloorColor | null>,
  cols?: number,
): FurnitureInstance[] {
  if (!wallSprites) return [];
  if (
    wallInstanceCache &&
    wallInstanceCache.tileMap === tileMap &&
    wallInstanceCache.tileColors === tileColors &&
    wallInstanceCache.cols === cols
  ) {
    return wallInstanceCache.instances;
  }
  const tmRows = tileMap.length;
  const tmCols = tmRows > 0 ? tileMap[0].length : 0;
  const layoutCols = cols ?? tmCols;
  const instances: FurnitureInstance[] = [];
  for (let r = 0; r < tmRows; r++) {
    for (let c = 0; c < tmCols; c++) {
      if (tileMap[r][c] !== TileType.WALL) continue;
      const colorIdx = r * layoutCols + c;
      const wallColor = tileColors?.[colorIdx];
      const wallInfo = wallColor
        ? getColorizedWallSprite(c, r, tileMap, wallColor)
        : getWallSprite(c, r, tileMap);
      if (!wallInfo) continue;
      instances.push({
        sprite: wallInfo.sprite,
        x: c * TILE_SIZE,
        y: r * TILE_SIZE + wallInfo.offsetY,
        zY: (r + 1) * TILE_SIZE,
      });
    }
  }
  wallInstanceCache = { tileMap, tileColors, cols, instances };
  return instances;
}

/**
 * Compute the flat fill hex color for a wall tile with a given FloorColor.
 * Uses same Colorize algorithm as floor tiles: 50% gray → HSL.
 */
export function wallColorToHex(color: FloorColor): string {
  const { h, s, b, c } = color;
  // Start with 50% gray (wall base)
  let lightness = 0.5;

  // Apply contrast
  if (c !== 0) {
    const factor = (100 + c) / 100;
    lightness = 0.5 + (lightness - 0.5) * factor;
  }

  // Apply brightness
  if (b !== 0) {
    lightness = lightness + b / 200;
  }

  lightness = Math.max(0, Math.min(1, lightness));

  return hslToHex(h, s / 100, lightness);
}
