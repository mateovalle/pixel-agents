/**
 * render-sheet.ts — Render all generated sprites into one contact-sheet PNG.
 *
 * Run from the repo root:
 *   node --experimental-strip-types scripts/asset-gen/render-sheet.ts
 *
 * Type-check (strict):
 *   npx tsc --noEmit --strict --target es2022 --module es2022 --moduleResolution bundler \
 *     --allowImportingTsExtensions --esModuleInterop --skipLibCheck scripts/asset-gen/render-sheet.ts
 *
 * Output: scripts/asset-gen/contact-sheet.png (6x scale, dark checker bg,
 * sprites laid out in rows with 8px gaps). An index legend is printed to
 * stdout (sprites are labeled implicitly by position).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import pngjs from 'pngjs';

import type { GeneratedSprite } from './sprites.ts';
import { SPRITES } from './sprites.ts';

const { PNG } = pngjs;

const SCALE = 6;
const GAP = 8; // px gap between sprites (sheet pixels)
const MARGIN = 16;
const PER_ROW = 5;
const CHECKER = 12; // checker cell size (sheet pixels)
const CHECKER_A: [number, number, number] = [0x24, 0x24, 0x2c];
const CHECKER_B: [number, number, number] = [0x2c, 0x2c, 0x36];

interface Placed {
  sprite: GeneratedSprite;
  x: number;
  y: number;
}

function layout(sprites: GeneratedSprite[]): { placed: Placed[]; width: number; height: number } {
  const placed: Placed[] = [];
  let y = MARGIN;
  let sheetW = 0;
  for (let i = 0; i < sprites.length; i += PER_ROW) {
    const rowSprites = sprites.slice(i, i + PER_ROW);
    const rowH = Math.max(...rowSprites.map((s) => s.heightPx * SCALE));
    let x = MARGIN;
    for (const s of rowSprites) {
      // bottom-align within the row so "floor" lines match
      placed.push({ sprite: s, x, y: y + rowH - s.heightPx * SCALE });
      x += s.widthPx * SCALE + GAP;
    }
    sheetW = Math.max(sheetW, x - GAP + MARGIN);
    y += rowH + GAP * 2;
  }
  return { placed, width: sheetW, height: y - GAP * 2 + MARGIN };
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function main(): void {
  const { placed, width, height } = layout(SPRITES);
  const png = new PNG({ width, height });

  // dark checker background
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const even = (Math.floor(x / CHECKER) + Math.floor(y / CHECKER)) % 2 === 0;
      const [r, g, b] = even ? CHECKER_A : CHECKER_B;
      const idx = (width * y + x) << 2;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }

  // sprites at SCALE
  for (const { sprite, x: ox, y: oy } of placed) {
    sprite.sprite.forEach((row, sy) => {
      row.forEach((hex, sx) => {
        if (!hex) return;
        const [r, g, b] = hexToRgb(hex);
        for (let dy = 0; dy < SCALE; dy++) {
          for (let dx = 0; dx < SCALE; dx++) {
            const px = ox + sx * SCALE + dx;
            const py = oy + sy * SCALE + dy;
            const idx = (width * py + px) << 2;
            png.data[idx] = r;
            png.data[idx + 1] = g;
            png.data[idx + 2] = b;
            png.data[idx + 3] = 255;
          }
        }
      });
    });
  }

  const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'contact-sheet.png');
  fs.writeFileSync(outPath, PNG.sync.write(png));

  console.log(`contact sheet: ${outPath} (${width}x${height})`);
  console.log('index legend (row-major, bottom-aligned rows):');
  placed.forEach(({ sprite, x, y }, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. ${sprite.id.padEnd(15)} ${String(sprite.widthPx)}x${String(sprite.heightPx)}px  at (${String(x)}, ${String(y)})`,
    );
  });
}

main();
