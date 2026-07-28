/**
 * floors.ts — 7 grayscale 16×16 floor tile patterns (batch 3).
 *
 * These replace the missing licensed floors.png. Spec (see
 * src/core/assetLoader.ts loadFloorTiles + webview-ui/src/office/floorTiles.ts):
 * floors.png is a 112×16 horizontal strip = 7 patterns of 16×16, GRAYSCALE.
 * At runtime each pattern is colorized Photoshop-style (luminance → contrast →
 * brightness → fixed HSL), so patterns are authored as pure VALUE maps:
 *  - grayscale only (r == g == b), roughly #333 → #CCC
 *  - midtones dominant (base values ~#7x-#9x) so hue/sat land well
 *  - must TILE SEAMLESSLY — every pattern is a pure function of
 *    (x mod 16, y mod 16), verified visually as 3×3 repeats on the
 *    contact sheet ([floors] section in render-sheet.ts)
 *
 * Patterns (1-based, matching the FloorColor pattern index):
 *  1. wood planks horizontal   2. large smooth tiles w/ grout
 *  3. checker                  4. carpet subtle noise
 *  5. herringbone parquet      6. small mosaic tiles
 *  7. concrete w/ subtle cracks
 *
 * Render/preview: node --experimental-strip-types scripts/asset-gen/render-sheet.ts
 */

import type { GeneratedSprite } from './sprites.ts';

const SIZE = 16;

/** Grayscale value (0x33-0xCC) → '#VVVVVV' hex. */
function g(v: number): string {
  const clamped = Math.max(0x33, Math.min(0xcc, Math.round(v)));
  const h = clamped.toString(16).padStart(2, '0').toUpperCase();
  return `#${h}${h}${h}`;
}

/** Build a 16×16 tile from a per-pixel value function. */
function tile(fn: (x: number, y: number) => number): string[][] {
  return Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => g(fn(x, y))),
  );
}

/** Deterministic per-pixel hash (period 16 in both axes → seamless). */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) >>> 0;
  h = (h ^ (h >> 13)) >>> 0;
  h = (h * 1103515245 + 12345) >>> 0;
  return h % 251;
}

// ════════════════════════════════════════════════════════════════
// 1. wood planks horizontal — 4 planks of 4px, dark seam rows,
//    lit top row per plank, sparse grain dashes, staggered joints.
// ════════════════════════════════════════════════════════════════
const FLOOR_WOOD = tile((x, y) => {
  const SEAM = 0x5c;
  const LIGHT = 0x9c;
  const BASE = 0x86;
  const GRAIN = 0x76;
  if (y % 4 === 0) return SEAM; // horizontal plank seam
  const plank = Math.floor(y / 4); // 0..3
  const joints = [3, 11, 7, 14]; // staggered vertical joints
  if (x === joints[plank]) return SEAM;
  if (y % 4 === 1) return LIGHT; // lit top edge of each plank
  // sparse grain dashes on the plank face
  if (y % 4 === 2 && (x + plank * 5) % 9 < 2) return GRAIN;
  if (y % 4 === 3 && (x + plank * 3 + 4) % 11 < 2) return GRAIN;
  return BASE;
});

// ════════════════════════════════════════════════════════════════
// 2. large smooth tiles w/ grout — one 16×16 tile per repeat:
//    grout on row 0 / col 0, lit top-left face, shaded bottom-right.
// ════════════════════════════════════════════════════════════════
const FLOOR_TILES_LARGE = tile((x, y) => {
  const GROUT = 0x58;
  const HIGH = 0x9e;
  const BASE = 0x8e;
  const SHADE = 0x80;
  if (x === 0 || y === 0) return GROUT;
  if (x === 1 || y === 1) return HIGH; // lit top-left inner edge
  if (x === 15 || y === 15) return SHADE; // shaded edge next to grout
  // faint polish specks
  if (hash(x, y, 2) < 12) return BASE + 6;
  return BASE;
});

// ════════════════════════════════════════════════════════════════
// 3. checker — 8×8 quads, two midtone values, faint speckle so the
//    flats aren't dead.
// ════════════════════════════════════════════════════════════════
const FLOOR_CHECKER = tile((x, y) => {
  const light = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
  const base = light ? 0x9a : 0x6e;
  if (hash(x, y, 3) < 16) return base + (light ? -4 : 4);
  return base;
});

// ════════════════════════════════════════════════════════════════
// 4. carpet subtle noise — midtone base, weave parity, hash speckle.
// ════════════════════════════════════════════════════════════════
const FLOOR_CARPET = tile((x, y) => {
  const BASE = 0x86;
  const h = hash(x, y, 4);
  let v = BASE;
  if (h < 40) v = 0x7c;
  else if (h > 210) v = 0x90;
  // faint diagonal weave
  if ((x + y) % 2 === 0) v += 2;
  return v;
});

// ════════════════════════════════════════════════════════════════
// 5. herringbone parquet — classic domino herringbone with 4×8
//    planks. Cell (i,j) = 4px cell; s=(i+j)%4 selects which half of
//    a horizontal (s∈{0,1}) or vertical (s∈{2,3}) plank the cell is.
//    Period = 4 cells = 16px → seamless. Lit top/left plank edge,
//    dark seam on bottom/right.
// ════════════════════════════════════════════════════════════════
const FLOOR_HERRINGBONE = tile((x, y) => {
  const SEAM = 0x5e;
  const LIGHT = 0x9a;
  const BASE = 0x88;
  const GRAIN = 0x7c;
  const i = Math.floor(x / 4);
  const j = Math.floor(y / 4);
  const s = (i + j) % 4;
  // plank origin cell + orientation
  let ox = i;
  let oy = j;
  let horizontal = true;
  if (s === 1) ox = i - 1;
  else if (s === 2) horizontal = false;
  else if (s === 3) {
    horizontal = false;
    oy = j - 1;
  }
  const lx = x - ox * 4; // 0..7 (H) or 0..3 (V)
  const ly = y - oy * 4; // 0..3 (H) or 0..7 (V)
  const w = horizontal ? 8 : 4;
  const h = horizontal ? 4 : 8;
  if (lx === w - 1 || ly === h - 1) return SEAM; // bottom/right seam
  if (lx === 0 || ly === 0) return LIGHT; // lit top/left edge
  if (hash(ox + 40, oy + (horizontal ? 60 : 90), 5) % 3 === 0 && (lx + ly) % 3 === 1) return GRAIN;
  return BASE;
});

// ════════════════════════════════════════════════════════════════
// 6. small mosaic tiles — 4×4 grid of 4px tiles, 1px grout, varied
//    values per tile, lit top-left pixel.
// ════════════════════════════════════════════════════════════════
const FLOOR_MOSAIC = tile((x, y) => {
  const GROUT = 0x5a;
  if (x % 4 === 0 || y % 4 === 0) return GROUT;
  const tx = Math.floor(x / 4);
  const ty = Math.floor(y / 4);
  // hand-picked midtone values, no two identical neighbors
  const shades = [
    0x94, 0x7e, 0x8c, 0x76, 0x86, 0x98, 0x78, 0x90, 0x7c, 0x8e, 0x96, 0x82, 0x92, 0x76, 0x88, 0x9c,
  ];
  const v = shades[ty * 4 + tx];
  if (x % 4 === 1 && y % 4 === 1) return v + 10; // lit top-left pixel
  return v;
});

// ════════════════════════════════════════════════════════════════
// 7. concrete w/ subtle cracks — midtone mottle + internal hairline
//    cracks (cracks never touch the tile edge, so the repeat stays
//    seamless) + a couple of pit dots.
// ════════════════════════════════════════════════════════════════
const CRACK_MAIN: [number, number][] = [
  [3, 4],
  [4, 5],
  [5, 5],
  [6, 6],
];
const CRACK_SECOND: [number, number][] = [
  [9, 11],
  [10, 12],
  [11, 12],
  [12, 13],
];
const CRACK_SMALL: [number, number][] = [
  [12, 3],
  [13, 4],
];
const PITS: [number, number][] = [
  [2, 12],
  [13, 8],
  [7, 2],
];
const FLOOR_CONCRETE = tile((x, y) => {
  if (CRACK_MAIN.some(([cx, cy]) => cx === x && cy === y)) return 0x74;
  if (CRACK_SECOND.some(([cx, cy]) => cx === x && cy === y)) return 0x76;
  if (CRACK_SMALL.some(([cx, cy]) => cx === x && cy === y)) return 0x7a;
  if (PITS.some(([cx, cy]) => cx === x && cy === y)) return 0x7e;
  const BASE = 0x8b;
  const h = hash(x, y, 7);
  if (h < 30) return 0x85;
  if (h > 220) return 0x91;
  return BASE;
});

// ════════════════════════════════════════════════════════════════
// Export + validation
// ════════════════════════════════════════════════════════════════

export interface FloorPattern {
  id: string;
  label: string;
  /** 16×16 grayscale hex grid (no transparency). */
  tile: string[][];
}

export const FLOORS: FloorPattern[] = [
  { id: 'floor_wood', label: 'Wood Planks', tile: FLOOR_WOOD },
  { id: 'floor_tiles_large', label: 'Large Tiles', tile: FLOOR_TILES_LARGE },
  { id: 'floor_checker', label: 'Checker', tile: FLOOR_CHECKER },
  { id: 'floor_carpet', label: 'Carpet', tile: FLOOR_CARPET },
  { id: 'floor_herringbone', label: 'Herringbone', tile: FLOOR_HERRINGBONE },
  { id: 'floor_mosaic', label: 'Mosaic', tile: FLOOR_MOSAIC },
  { id: 'floor_concrete', label: 'Concrete', tile: FLOOR_CONCRETE },
];

/** Validate: 16×16, fully opaque, grayscale-only, values in ~#333-#CCC. */
export function validateFloors(floors: FloorPattern[]): void {
  for (const f of floors) {
    if (f.tile.length !== SIZE) throw new Error(`${f.id}: height ${f.tile.length} !== 16`);
    f.tile.forEach((row, y) => {
      if (row.length !== SIZE) throw new Error(`${f.id}: row ${y} width ${row.length} !== 16`);
      row.forEach((hex, x) => {
        if (!/^#[0-9A-F]{6}$/.test(hex)) {
          throw new Error(`${f.id}: bad pixel '${hex}' at (${x},${y})`);
        }
        const r = hex.slice(1, 3);
        const gg = hex.slice(3, 5);
        const b = hex.slice(5, 7);
        if (r !== gg || gg !== b) {
          throw new Error(`${f.id}: non-grayscale pixel ${hex} at (${x},${y})`);
        }
        const v = parseInt(r, 16);
        if (v < 0x33 || v > 0xcc) {
          throw new Error(`${f.id}: value ${hex} out of #333-#CCC range at (${x},${y})`);
        }
      });
    });
  }
}

validateFloors(FLOORS);

/** Each floor as a 3×3 tiled 48×48 block, for seamlessness review on the contact sheet. */
export const FLOOR_SHEET: GeneratedSprite[] = FLOORS.map((f) => {
  const tiled: string[][] = Array.from({ length: SIZE * 3 }, (_, y) =>
    Array.from({ length: SIZE * 3 }, (_, x) => f.tile[y % SIZE][x % SIZE]),
  );
  return {
    id: `${f.id}_3x3`,
    name: f.id.toUpperCase(),
    label: f.label,
    widthPx: SIZE * 3,
    heightPx: SIZE * 3,
    footprintW: 3,
    footprintH: 3,
    sprite: tiled,
  };
});
