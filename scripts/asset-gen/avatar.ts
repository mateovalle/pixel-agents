/**
 * avatar.ts — "The maker" portrait avatar for the landing page (docs/index.html).
 *
 * 28x32 front-facing BUST (cropped at the chest) in the same visual language
 * as the game characters (char_0..5): big fluffy hair, dot eyes with white
 * highlights, 1px darker-shade outlines (never pure black), light from
 * top-left, 2-tone shading per material. Displays at 4x = 112x128 in the
 * landing page's 112x160 avatar slot.
 *
 * Look: dark-brown hair (char_4 hair tones), rectangular glasses, purple
 * hoodie (house PURPLE) with drawstrings, chunky headphones with green LEDs,
 * and a rubber duck perched on the shoulder as the single signature detail.
 *
 * Colors: house palette (palette.ts) + the skin/hair tones extracted from
 * webview-ui/public/assets/characters/char_0.png / char_4.png.
 *
 * Render:
 *   node --experimental-strip-types scripts/asset-gen/avatar.ts
 * Outputs:
 *   scripts/asset-gen/avatar-preview.png  (8x, transparent bg, for review)
 *   docs/assets/avatar.png                (native 28x32)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import pngjs from 'pngjs';

import {
  GOLD,
  GOLD_DARK,
  ICE,
  INK,
  IRON_DARK,
  LED_GREEN,
  ORANGE,
  PAPER,
  PURPLE,
  PURPLE_DARK,
  STEEL_DARK,
} from './palette.ts';

const { PNG } = pngjs;

// ── Skin/hair tones extracted from char_*.png (allowed alongside palette) ──
const HAIR_DARK = '#2f160f'; // char_4 hair outline/shadow
const HAIR = '#432415'; // char_4 hair base
const HAIR_LIGHT = '#57351a'; // char_4 lit hair
const SKIN = '#e9a384'; // char_0/char_4 skin base
const SKIN_SHADOW = '#c5896e'; // char_0/char_4 skin shadow
const SKIN_LIGHT = '#fbbf97'; // char_0 skin highlight
const EYE_WHITE = '#ffffff'; // char eye highlight

const LEGEND: Record<string, string> = {
  d: HAIR_DARK,
  H: HAIR,
  h: HAIR_LIGHT,
  S: SKIN,
  s: SKIN_SHADOW,
  f: SKIN_LIGHT,
  M: '#84523a', // mouth (dark skin tone from char_0)
  E: INK, // eyes
  w: EYE_WHITE,
  i: ICE, // glasses lens glint
  P: PURPLE, // hoodie base
  p: PURPLE_DARK, // hoodie shade/outline
  D: PAPER, // hoodie drawstrings
  K: INK, // headphone cup dark inner edge
  k: IRON_DARK, // headphone cup base
  B: STEEL_DARK, // headphone band + light cup rim
  g: LED_GREEN, // headphone LED
  G: GOLD, // rubber duck body
  o: GOLD_DARK, // rubber duck shade/outline
  O: ORANGE, // rubber duck beak
};

// 28 wide x 32 tall bust. '.' = transparent.
const GRID: string[] = [
  '...........BBBBBB...........', // 0  headphone band arc
  '.........BBddddddBB.........', // 1
  '........BdHhhHHHHHdB........', // 2
  '.......BdHhhhHHHHHHdB.......', // 3
  '......BdHhhhhHHHHHHHdB......', // 4
  '.....BdHHhhhHHHHHHHHHdB.....', // 5
  '....BdHHhhHHHHhHHHHHHHdB....', // 6
  '...BdHHhhHHHHHhHHHHHHHHdB...', // 7
  '...BdHhhHHHHHHHHhHHHHHHdB...', // 8
  '...BdHHhHHHHHHHHHHhHHHHdB...', // 9
  '..BBdHHdHHHdHHHHdHHHdHHdBB..', // 10 bangs bottom, band meets cups
  'BkkKdHHSHSSSHSSSSHSSSHHdKkkB', // 11 face opens, chunky cups start
  'BkkKdHHffSSSSSSSSSSSsHHdKkkB', // 12 forehead highlight
  'gkkKdHHfSSSSSSSSSSSSsHHdKkkg', // 13 LED row
  'gkkKdHHSkkkkkkkkkkkksHHdKkkg', // 14 LED row + glasses browline bar
  'BkkKdHHSkwEikSSkwEiksHHdKkkB', // 15 lenses: eyes + glint, open bridge
  'BkkKdHHSkEEikSSkEEiksHHdKkkB', // 16 lenses: eyes + glint
  '....dHHSkkkkkSSkkkkksHHd....', // 17 glasses bottom bars
  '.....dHsSSSSSsSSSSSSsHdoo...', // 18 cheeks + nose, duck head top
  '......dsSSSSSSSMSSSSsdoEGo..', // 19 smirk end up, duck head + eye
  '........dsSSMMMSSSsdOOGGGo..', // 20 smirk, duck beak
  '.........dssSSSSssd..oGGGGo.', // 21 chin, duck body
  '...........sSSSss....oGGGGo.', // 22 neck, duck body
  '........pPPpsSSspPPp..oooo..', // 23 collar, duck bottom
  '....ppPPPPPDPPPPDPPPPPpoo...', // 24 shoulders, duck feet break outline
  '..pPPPPPPPPDPPPPDPPPPPPPPp..', // 25 chest + drawstrings
  '..pPPPPPPPPDPPPPDPPPPPPPPp..', // 26
  '..pPPPPPPPPDPPPPDPPPPPPPPp..', // 27 string aglets
  '..pPPPPPPPPPPPPPPPPPPPPPPp..', // 28 chest (cropped bust)
  '..pPPPPPPPPPPPPPPPPPPPPPPp..', // 29
  '..pPPPPPPPPPPPPPPPPPPPPPPp..', // 30
  '..pPPPPPPPPPPPPPPPPPPPPPPp..', // 31
];

function compile(rows: string[], legend: Record<string, string>): string[][] {
  return rows.map((row, r) => {
    if (row.length !== rows[0].length) {
      throw new Error(`row ${r} has length ${row.length}, expected ${rows[0].length}`);
    }
    return [...row].map((ch, c) => {
      if (ch === '.') return '';
      const hex = legend[ch];
      if (hex === undefined) throw new Error(`unknown legend char '${ch}' at row ${r} col ${c}`);
      return hex;
    });
  });
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function writePng(grid: string[][], scale: number, outPath: string): void {
  const h = grid.length;
  const w = grid[0].length;
  const png = new PNG({ width: w * scale, height: h * scale });
  // fully transparent by default (PNG buffers zero-init)
  grid.forEach((row, sy) => {
    row.forEach((hex, sx) => {
      if (!hex) return;
      const [r, g, b] = hexToRgb(hex);
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const idx = (png.width * (sy * scale + dy) + sx * scale + dx) << 2;
          png.data[idx] = r;
          png.data[idx + 1] = g;
          png.data[idx + 2] = b;
          png.data[idx + 3] = 255;
        }
      }
    });
  });
  fs.writeFileSync(outPath, PNG.sync.write(png));
  console.log(`wrote ${outPath} (${png.width}x${png.height})`);
}

function main(): void {
  const grid = compile(GRID, LEGEND);
  const here = path.dirname(fileURLToPath(import.meta.url));
  writePng(grid, 8, path.join(here, 'avatar-preview.png'));
  writePng(grid, 1, path.join(here, '..', '..', 'docs', 'assets', 'avatar.png'));
}

main();
