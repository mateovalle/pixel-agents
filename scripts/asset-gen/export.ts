/**
 * export.ts — Export the generated sprite library into the app's asset folder.
 *
 * Run from the repo root:
 *   node --experimental-strip-types scripts/asset-gen/export.ts
 *
 * Outputs (all under webview-ui/public/assets/):
 *  - floors.png                          112×16 strip of the 7 grayscale floor patterns
 *  - furniture/<id>.png                  one PNG per generated furniture sprite (native size)
 *  - furniture/furniture-catalog.json    { assets: [...] } consumed by src/core/assetLoader.ts
 *
 * Catalog metadata (category, isDesk, canPlaceOnWalls, canPlaceOnSurfaces,
 * backgroundTiles) is assigned per sprite in CATALOG_META below.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import pngjs from 'pngjs';

import { FLOORS } from './floors.ts';
import type { GeneratedSprite } from './sprites.ts';
import { SPRITES } from './sprites.ts';
import { SPRITES2 } from './sprites2.ts';
import { SPRITES3 } from './sprites3.ts';

const { PNG } = pngjs;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS_DIR = path.join(REPO_ROOT, 'webview-ui', 'public', 'assets');
const FURNITURE_DIR = path.join(ASSETS_DIR, 'furniture');

const FLOOR_TILE_SIZE = 16;

// ── Catalog metadata per sprite id ──────────────────────────────

interface CatalogMeta {
  category: 'desks' | 'chairs' | 'storage' | 'electronics' | 'decor' | 'wall' | 'misc';
  isDesk?: boolean;
  canPlaceOnWalls?: boolean;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
}

const CATALOG_META: Record<string, CatalogMeta> = {
  // ── desks ──
  desk_l: { category: 'desks', isDesk: true },
  desk_standing: { category: 'desks', isDesk: true },
  desk_double: { category: 'desks', isDesk: true },
  // ── chairs ──
  chair_gamer: { category: 'chairs' },
  chair_office: { category: 'chairs' },
  stool: { category: 'chairs' },
  couch: { category: 'chairs' },
  // ── storage ──
  bookshelf_tall: { category: 'storage' },
  filing_cabinet: { category: 'storage' },
  // isDesk so surface items (coffee machine, microwave) can sit on the counter
  kitchen_counter: { category: 'storage', isDesk: true },
  mini_fridge: { category: 'storage' },
  vending_machine: { category: 'storage' },
  // ── electronics ──
  monitor_dual: { category: 'electronics', canPlaceOnSurfaces: true },
  server_rack: { category: 'electronics' },
  printer: { category: 'electronics', canPlaceOnSurfaces: true },
  microwave: { category: 'electronics', canPlaceOnSurfaces: true },
  desk_lamp: { category: 'electronics', canPlaceOnSurfaces: true },
  coffee_machine: { category: 'electronics', canPlaceOnSurfaces: true },
  arcade_machine: { category: 'electronics' },
  // ── wall (canPlaceOnWalls) ──
  window: { category: 'wall', canPlaceOnWalls: true },
  whiteboard: { category: 'wall', canPlaceOnWalls: true },
  corkboard: { category: 'wall', canPlaceOnWalls: true },
  wall_clock: { category: 'wall', canPlaceOnWalls: true },
  medals_wall: { category: 'wall', canPlaceOnWalls: true },
  poster_code: { category: 'wall', canPlaceOnWalls: true },
  tv_dashboard: { category: 'wall', canPlaceOnWalls: true },
  // ── decor ──
  plant_monstera: { category: 'decor' },
  plant_cactus: { category: 'decor', canPlaceOnSurfaces: true },
  lamp_floor: { category: 'decor' },
  water_dispenser: { category: 'decor' },
  trash_bin: { category: 'decor' },
  coffee_table: { category: 'decor' },
  pingpong_table: { category: 'decor' },
  fish_tank: { category: 'decor' },
  // 3×2 rug: backgroundTiles = full footprint height → fully walkable/stackable
  rug_large: { category: 'decor', backgroundTiles: 2 },
  // 1×1 cat: walkable/stackable tile
  cat_sleeping: { category: 'decor', backgroundTiles: 1 },
  rubber_duck: { category: 'decor', canPlaceOnSurfaces: true },
  trophy_gold: { category: 'decor', canPlaceOnSurfaces: true },
};

// ── Catalog entry shape (matches FurnitureAsset in shared/protocol.ts) ──

interface CatalogAsset {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
}

// ── PNG helpers ─────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Render a hex-grid sprite ('' = transparent) into an RGBA PNG buffer. */
function spriteToPng(sprite: string[][], width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      const hex = sprite[y]?.[x] ?? '';
      if (hex === '') {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
      } else {
        const [r, g, b] = hexToRgb(hex);
        png.data[idx] = r;
        png.data[idx + 1] = g;
        png.data[idx + 2] = b;
        png.data[idx + 3] = 255;
      }
    }
  }
  return PNG.sync.write(png);
}

// ── Export steps ────────────────────────────────────────────────

function exportFloors(): void {
  const width = FLOORS.length * FLOOR_TILE_SIZE; // 112
  const height = FLOOR_TILE_SIZE;
  const strip: string[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const pattern = Math.floor(x / FLOOR_TILE_SIZE);
      return FLOORS[pattern].tile[y][x % FLOOR_TILE_SIZE];
    }),
  );
  const outPath = path.join(ASSETS_DIR, 'floors.png');
  fs.writeFileSync(outPath, spriteToPng(strip, width, height));
  console.log(`✓ floors.png (${width}×${height}, ${FLOORS.length} patterns) → ${outPath}`);
}

function exportFurniture(): void {
  fs.mkdirSync(FURNITURE_DIR, { recursive: true });

  const all: GeneratedSprite[] = [...SPRITES, ...SPRITES2, ...SPRITES3];

  // Sanity: every sprite has metadata, every metadata entry has a sprite.
  const spriteIds = new Set(all.map((s) => s.id));
  for (const s of all) {
    if (!CATALOG_META[s.id]) throw new Error(`No catalog metadata for sprite '${s.id}'`);
  }
  for (const id of Object.keys(CATALOG_META)) {
    if (!spriteIds.has(id)) throw new Error(`Catalog metadata for unknown sprite '${id}'`);
  }

  const assets: CatalogAsset[] = [];
  for (const s of all) {
    // Validate sprite grid matches declared dimensions.
    if (s.sprite.length !== s.heightPx) {
      throw new Error(`${s.id}: sprite height ${s.sprite.length} !== heightPx ${s.heightPx}`);
    }
    s.sprite.forEach((row, y) => {
      if (row.length !== s.widthPx) {
        throw new Error(`${s.id}: row ${y} width ${row.length} !== widthPx ${s.widthPx}`);
      }
    });

    const meta = CATALOG_META[s.id];
    fs.writeFileSync(
      path.join(FURNITURE_DIR, `${s.id}.png`),
      spriteToPng(s.sprite, s.widthPx, s.heightPx),
    );

    const entry: CatalogAsset = {
      id: s.id,
      name: s.name,
      label: s.label,
      category: meta.category,
      file: `furniture/${s.id}.png`,
      width: s.widthPx,
      height: s.heightPx,
      footprintW: s.footprintW,
      footprintH: s.footprintH,
      isDesk: meta.isDesk ?? false,
      canPlaceOnWalls: meta.canPlaceOnWalls ?? false,
    };
    if (meta.canPlaceOnSurfaces) entry.canPlaceOnSurfaces = true;
    if (meta.backgroundTiles !== undefined) entry.backgroundTiles = meta.backgroundTiles;
    assets.push(entry);
  }

  const catalogPath = path.join(FURNITURE_DIR, 'furniture-catalog.json');
  fs.writeFileSync(catalogPath, JSON.stringify({ assets }, null, 2) + '\n');
  console.log(`✓ ${assets.length} furniture PNGs → ${FURNITURE_DIR}/`);
  console.log(`✓ furniture-catalog.json (${assets.length} assets) → ${catalogPath}`);

  // Category summary
  const byCat = new Map<string, string[]>();
  for (const a of assets) {
    const list = byCat.get(a.category) ?? [];
    list.push(a.id);
    byCat.set(a.category, list);
  }
  for (const [cat, ids] of byCat) {
    console.log(`  ${cat.padEnd(12)} (${ids.length}): ${ids.join(', ')}`);
  }
}

function main(): void {
  exportFloors();
  exportFurniture();
}

main();
