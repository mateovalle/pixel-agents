/**
 * sprites.ts — Batch 1 of generated furniture sprites (10 items).
 *
 * Sprites are authored as ASCII pixel maps ('.' = transparent, one char per
 * pixel) with a per-sprite legend that maps chars to house-palette colors from
 * palette.ts. They compile to the same `string[][]` hex-grid format used by
 * webview-ui/src/office/sprites/spriteData.ts.
 *
 * Style rules (matching the existing hand-authored furniture):
 *  - 1px outline in a darker shade of the material, not pure black
 *  - light from top-left (light tone top/left, shadow bottom/right)
 *  - 2-tone shading per material, 3-6 colors per sprite
 *  - top-down-ish 3/4 perspective, legs as short dark stubs
 *
 * Render/preview: node --experimental-strip-types scripts/asset-gen/render-sheet.ts
 */

import {
  AMBER,
  BLUE,
  CLAY,
  CLAY_DARK,
  GOLD,
  GOLD_DARK,
  GOLD_LIGHT,
  GREEN,
  ICE,
  INK,
  IRON,
  IRON_DARK,
  LEAF,
  LEAF_DARK,
  LED_GREEN,
  ORANGE,
  PAPER,
  RED,
  SCREEN_BLUE,
  SCREEN_SHADOW,
  SILVER_LIGHT,
  SKY,
  STEEL,
  STEEL_DARK,
  STEEL_LIGHT,
  WOOD,
  WOOD_DARK,
  WOOD_LIGHT,
  WOOD_SURFACE,
} from './palette.ts';

export interface GeneratedSprite {
  id: string;
  name: string;
  label: string;
  widthPx: number;
  heightPx: number;
  footprintW: number;
  footprintH: number;
  sprite: string[][];
}

type Legend = Record<string, string>;

/** Compile an ASCII pixel map to a hex grid. '.' = transparent. */
function fromAscii(rows: string[], legend: Legend): string[][] {
  return rows.map((row, r) =>
    [...row].map((ch, c) => {
      if (ch === '.') return '';
      const hex = legend[ch];
      if (hex === undefined) throw new Error(`unknown legend char '${ch}' at row ${r} col ${c}`);
      return hex;
    }),
  );
}

/** Repeat a char n times (readability helper for long rows). */
function rep(ch: string, n: number): string {
  return ch.repeat(n);
}

// ════════════════════════════════════════════════════════════════
// 1. desk_l — L-shaped desk, 48x32, 3x2 tiles, isDesk
//    Horizontal arm across the top 3 tiles, vertical arm down the
//    left column. Bottom-right 2x1 area is open (chair goes there).
//    Pure top-down like DESK_SQUARE: wood edge, lit strip, surface,
//    dark leg stubs under the corners.
// ════════════════════════════════════════════════════════════════
const DESK_L = (() => {
  const e = WOOD;
  const l = WOOD_LIGHT;
  const s = WOOD_SURFACE;
  const d = WOOD_DARK;
  const rows: string[][] = [];
  const W = 48;
  const row = (fn: (c: number) => string) => Array.from({ length: W }, (_, c) => fn(c));
  const T = ''; // transparent

  // r0: breathing room
  rows.push(row(() => T));
  // r1: top edge
  rows.push(row((c) => (c >= 1 && c <= 46 ? e : T)));
  // r2: lit strip along the top (light from top-left)
  rows.push(row((c) => (c === 1 || c === 46 ? e : c >= 2 && c <= 45 ? l : T)));
  // r3-12: full-width surface, lit left edge, subtle plank line at r8
  for (let r = 3; r <= 12; r++) {
    rows.push(
      row((c) =>
        c === 1 || c === 46 ? e : c === 2 ? l : c >= 3 && c <= 45 ? (r === 8 ? l : s) : T,
      ),
    );
  }
  // r13: bottom edge of the right arm; left arm continues (inner corner at col 15)
  rows.push(row((c) => (c === 1 ? e : c >= 2 && c <= 14 ? s : c >= 15 && c <= 46 ? e : T)));
  // r14-16: leg stubs under the right arm (inner corner + right end)
  for (let r = 14; r <= 16; r++) {
    rows.push(
      row((c) => {
        if (c === 1) return e;
        if (c >= 2 && c <= 14) return s;
        if (c === 15) return e;
        if (c === 17 || c === 18 || c === 44 || c === 45) return d;
        return T;
      }),
    );
  }
  // r17-25: left arm pedestal — two drawer fronts with dark handles
  for (let r = 17; r <= 25; r++) {
    const divider = r === 17 || r === 21;
    const handle = r === 19 || r === 23;
    rows.push(
      row((c) => {
        if (c === 1 || c === 15) return e;
        if (c < 2 || c > 14) return T;
        if (divider) return e;
        if (c === 2) return l; // lit left edge (light from top-left)
        if (handle && c >= 7 && c <= 9) return d;
        return s;
      }),
    );
  }
  // r26: bottom edge of the left arm
  rows.push(row((c) => (c >= 1 && c <= 15 ? e : T)));
  // r27-29: leg stubs under the left arm
  for (let r = 27; r <= 29; r++) {
    rows.push(row((c) => (c === 1 || c === 2 || c === 13 || c === 14 ? d : T)));
  }
  // r30-31: empty
  rows.push(row(() => T));
  rows.push(row(() => T));
  return rows;
})();

// ════════════════════════════════════════════════════════════════
// 2. chair_gamer — high-back gamer chair, front-facing, 16x32, 1x1
//    Tall backrest with red racing stripes, wide bucket seat,
//    star base with wheels. Dark fabric like the character shoes/PC.
// ════════════════════════════════════════════════════════════════
const CHAIR_GAMER = fromAscii(
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....oooooooo....',
    '...orBBooBBro...',
    '..orBBBooBBBro..',
    '..orBKKKKKKBro..',
    '..orBKKKKKKBro..',
    '..orBKKKKKKBro..',
    '..orBKKKKKKBro..',
    '..orBrrrrrrBro..',
    '..orBKKKKKKBro..',
    '..orBBBBBBBBro..',
    '..oBBBBBBBBBBo..',
    '...oBBBBBBBBo...',
    '...oooooooooo...',
    '.oBBBBBBBBBBBBo.',
    '.oBBBBBBBBBBBBo.',
    '.orrBBBBBBBBrro.',
    '.oBBBBBBBBBBBBo.',
    '..ooBBBBBBBBoo..',
    '...oooooooooo...',
    '.......gK.......',
    '.......gK.......',
    '......ogKo......',
    '....KKKKKKKK....',
    '..KKK..KK..KKK..',
    '..oo...oo...oo..',
    '................',
    '................',
  ],
  { o: INK, B: IRON, K: IRON_DARK, r: RED, g: STEEL },
);

// ════════════════════════════════════════════════════════════════
// 3. monitor_dual — two monitors on stands, 32x16, on-surface
//    Same visual language as PC_SPRITE: steel frame, dark bezel,
//    lit blue screens with a bright top scanline.
// ════════════════════════════════════════════════════════════════
const MONITOR_DUAL = (() => {
  const mFrame = rep('f', 14);
  const mBezel = 'f' + rep('z', 12) + 'f';
  const mGlow = 'fz' + rep('l', 10) + 'zf';
  const mScreen = 'fzl' + rep('c', 9) + 'zf';
  const mScreen2 = 'fzll' + rep('c', 8) + 'zf'; // diagonal shine step
  const pair = (m: string) => '.' + m + '..' + m + '.';
  const rows = [
    rep('.', 32),
    pair(mFrame),
    pair(mBezel),
    pair(mGlow),
    pair(mScreen2),
    pair(mScreen),
    pair(mScreen),
    pair(mScreen),
    pair(mScreen),
    pair(mBezel),
    pair(mFrame),
    rep('.', 7) + rep('d', 18) + rep('.', 7), // dual-arm bar
    rep('.', 15) + 'dd' + rep('.', 15), // center post
    rep('.', 11) + rep('d', 10) + rep('.', 11), // base
    rep('.', 32),
    rep('.', 32),
  ];
  return fromAscii(rows, { f: STEEL_DARK, z: SCREEN_SHADOW, c: SCREEN_BLUE, l: SKY, d: IRON });
})();

// ════════════════════════════════════════════════════════════════
// 4. server_rack — tall rack with status LEDs, 16x48, 1x1
//    3/4 lit top, dark cabinet, 7 rack units with vent slits and
//    green/amber/red LED pairs, plinth and feet at the bottom.
// ════════════════════════════════════════════════════════════════
const SERVER_RACK = (() => {
  const rows: string[] = [];
  const wrap = (inner: string) => '.o' + inner + 'o.';
  rows.push('.oooooooooooooo.');
  rows.push(wrap(rep('s', 12)));
  rows.push(wrap(rep('g', 12)));
  rows.push('.oooooooooooooo.');
  // 7 rack units, 5 rows each: separator, face, vents, LEDs, face
  const leds: [string, string][] = [
    ['G', 'G'],
    ['G', 'A'],
    ['G', 'G'],
    ['A', 'G'],
    ['G', 'R'],
    ['G', 'G'],
    ['A', 'A'],
  ];
  for (const [l1, l2] of leds) {
    rows.push(wrap(rep('k', 12)));
    rows.push(wrap('k' + rep('d', 10) + 'k')); // inset unit face
    rows.push(wrap('k' + rep('gd', 4) + 'g' + 'dk')); // vent slit dashes
    rows.push(wrap('k' + rep('d', 7) + l1 + l2 + 'dk'));
    rows.push(wrap('k' + rep('d', 10) + 'k'));
  }
  rows.push(wrap(rep('k', 12))); // final separator
  rows.push('.oooooooooooooo.'); // bottom edge
  rows.push(wrap(rep('k', 12))); // plinth
  rows.push(wrap(rep('k', 12)));
  rows.push('.oooooooooooooo.');
  rows.push('..oo........oo..'); // feet
  rows.push('..oo........oo..');
  rows.push(rep('.', 16));
  rows.push(rep('.', 16));
  return fromAscii(rows, {
    o: INK,
    k: IRON_DARK,
    d: IRON,
    g: STEEL_DARK,
    s: STEEL,
    G: LED_GREEN,
    A: AMBER,
    R: RED,
  });
})();

// ════════════════════════════════════════════════════════════════
// 5. plant_monstera — big leafy plant in pot, 16x32, 1x1
//    Three large lobed leaves with slits (transparent cuts), dark
//    vein accents, wood stems, terracotta pot like PLANT_SPRITE.
// ════════════════════════════════════════════════════════════════
const PLANT_MONSTERA = fromAscii(
  [
    '..GLGG....GLGG..',
    '.GLLGGG..GLLGGG.',
    '.GLGDGGG.GGDGGG.',
    'G.GGDGGG.GGDGG.G',
    'GGGGDGG..GGDGGGG',
    'G.GGDGGG..GDGGG.',
    '.GGGDGG..GGDGGG.',
    '..GGDGG...GDGG..',
    '...GGG....GG....',
    '....t.GLGG.t....',
    '....GLLGGGGG....',
    '...GLGDGGDGGG...',
    '...GGGDGGDGGG...',
    '....GGDGGDGG....',
    '.....GDGGDG.....',
    '......GGGG......',
    '.......tt.......',
    '.......tt.......',
    '.......tt.......',
    '.......tt.......',
    '.......tt.......',
    '...qqqqqqqqqq...',
    '..qppppppppppq..',
    '..qpppppppppqq..',
    '..qqqqqqqqqqqq..',
    '...qppppppppq...',
    '...qpppppppqq...',
    '...qpppppppqq...',
    '...qpppppppqq...',
    '....qpppppqq....',
    '....qqqqqqqq....',
    '................',
  ],
  { G: LEAF, D: LEAF_DARK, L: GREEN, t: WOOD_DARK, p: CLAY, q: CLAY_DARK },
);

// ════════════════════════════════════════════════════════════════
// 6. coffee_machine — espresso machine, 16x16, on-surface
//    Lit steel top, body with red power button and green LED,
//    dark brew group with spout, white cup, wide drip-tray base.
// ════════════════════════════════════════════════════════════════
const COFFEE_MACHINE = fromAscii(
  [
    '................',
    '...oooooooooo...',
    '...ohhhhhhhho...',
    '...orrrrrrrqo...',
    '...orGrrrwrqo...',
    '...orrrrrrrqo...',
    '...oskkkkkkso...',
    '...oskkookkso...',
    '...oskkwwkkso...',
    '...oskkwwkkso...',
    '...ohhhhhhhho...',
    '..oddddddddddo..',
    '..oddddddddddo..',
    '..oooooooooooo..',
    '................',
    '................',
  ],
  {
    o: INK,
    h: STEEL_LIGHT,
    s: STEEL,
    k: IRON_DARK,
    r: RED,
    q: CLAY_DARK,
    G: LED_GREEN,
    w: PAPER,
    d: IRON,
  },
);

// ════════════════════════════════════════════════════════════════
// 7. fish_tank — aquarium on a wood stand, 32x32, 2x1
//    Steel-framed tank: light water line, glass shine, two orange
//    fish, plants, clay gravel. Wood cabinet stand with two doors.
// ════════════════════════════════════════════════════════════════
const FISH_TANK = (() => {
  const rows: string[] = [];
  const tank = (inner: string) => '.f' + inner + 'f.';
  const wood = (inner: string) => '.W' + inner + 'W.';
  rows.push('.' + rep('f', 30) + '.');
  rows.push(tank(rep('l', 28)));
  rows.push(tank('il' + rep('w', 26)));
  rows.push(tank('il' + rep('w', 17) + 'i' + rep('w', 8)));
  rows.push(tank('i' + rep('w', 14) + 'i' + rep('w', 12)));
  rows.push(tank(rep('w', 9) + 'FFF' + rep('w', 12) + 'i' + rep('w', 3)));
  rows.push(tank(rep('w', 8) + 'FFFF' + rep('w', 4) + 'i' + rep('w', 11)));
  rows.push(tank(rep('w', 24) + 'i' + rep('w', 3)));
  rows.push(tank(rep('w', 23) + 'g' + rep('w', 4)));
  rows.push(tank(rep('w', 16) + 'FFF' + rep('w', 3) + 'gDg' + rep('w', 3)));
  rows.push(tank(rep('w', 15) + 'FFFF' + rep('w', 3) + 'gDg' + rep('w', 3)));
  rows.push(tank(rep('w', 5) + 'g' + rep('w', 14) + 'gg' + 'Dg' + rep('w', 4)));
  rows.push(tank(rep('w', 4) + 'gDg' + rep('w', 14) + 'gDgg' + rep('w', 3)));
  rows.push(
    tank(
      rep('S', 3) + 'q' + rep('S', 4) + 'q' + rep('S', 5) + 'q' + rep('S', 6) + 'q' + rep('S', 6),
    ),
  );
  rows.push(tank(rep('q', 28)));
  rows.push('.' + rep('f', 30) + '.');
  // wood stand
  rows.push('.' + rep('W', 30) + '.');
  rows.push(wood(rep('L', 28)));
  for (let r = 0; r < 10; r++) {
    const knobRow = r === 4;
    const door = (mirror: boolean) => {
      const cells = rep(r === 0 ? 'L' : 'W', 12).split(''); // lit door tops
      if (knobRow) cells[mirror ? 1 : 10] = 'e';
      return cells.join('');
    };
    rows.push(wood('e' + door(false) + 'ee' + door(true) + 'e'));
  }
  rows.push(wood(rep('e', 28)));
  rows.push('.' + rep('W', 30) + '.');
  rows.push('..ee' + rep('.', 24) + 'ee..');
  rows.push(rep('.', 32));
  return fromAscii(rows, {
    f: STEEL_DARK,
    w: BLUE,
    l: SKY,
    i: ICE,
    F: ORANGE,
    g: LEAF,
    D: LEAF_DARK,
    S: CLAY,
    q: CLAY_DARK,
    W: WOOD,
    e: WOOD_DARK,
    L: WOOD_LIGHT,
  });
})();

// ════════════════════════════════════════════════════════════════
// 8. rug_large — patterned rug, 48x32, 3x2, walkable decor
//    Flat top-down: clay border, gold inner line, red field with a
//    gold diamond medallion + cream center and corner dots.
// ════════════════════════════════════════════════════════════════
const RUG_LARGE = (() => {
  const rows: string[] = [];
  const W = 48;
  const H = 32;
  for (let r = 0; r < H; r++) {
    let row = '';
    for (let c = 0; c < W; c++) {
      // rounded corners
      const edgeR = Math.min(r, H - 1 - r);
      const edgeC = Math.min(c, W - 1 - c);
      if (edgeR === 0 && edgeC === 0) {
        row += '.';
        continue;
      }
      // outer border (2px) then gold line
      if (edgeR < 2 || edgeC < 2) {
        row += 'b';
        continue;
      }
      if (edgeR === 2 || edgeC === 2) {
        row += 'y';
        continue;
      }
      // central diamond medallion (cream core, inner + outer gold rings)
      const d = Math.abs(c - 23.5) / 1.5 + Math.abs(r - 15.5);
      if (d < 2.5) {
        row += 'c';
        continue;
      }
      if (d >= 3.5 && d < 4.5) {
        row += 'y';
        continue;
      }
      if (d >= 6 && d < 7.5) {
        row += 'y';
        continue;
      }
      // corner dots in the field (gold with cream center)
      const dotR = Math.min(Math.abs(r - 8), Math.abs(r - 23));
      const dotC = Math.min(Math.abs(c - 9), Math.abs(c - 38));
      if (dotR === 0 && dotC === 0) {
        row += 'c';
        continue;
      }
      if (dotR <= 1 && dotC <= 1) {
        row += 'y';
        continue;
      }
      row += 'f';
    }
    rows.push(row);
  }
  return fromAscii(rows, { b: CLAY_DARK, y: GOLD_DARK, f: RED, c: PAPER });
})();

// ════════════════════════════════════════════════════════════════
// 9. whiteboard — big whiteboard with scribbles, 32x32, wall item
//    Silver frame, paper surface, diagram scribbles (blue boxes,
//    arrow, red underlines, green chart), marker tray with markers.
// ════════════════════════════════════════════════════════════════
const WHITEBOARD_BIG = (() => {
  const W = 32;
  const grid: string[][] = Array.from({ length: 32 }, () => new Array<string>(W).fill('.'));
  // frame rows 1-25, surface 2-24
  for (let c = 1; c <= 30; c++) {
    grid[1][c] = 'a';
    grid[25][c] = 'a';
  }
  for (let r = 2; r <= 24; r++) {
    grid[r][1] = 'a';
    grid[r][30] = 'a';
    for (let c = 2; c <= 29; c++) grid[r][c] = 'w';
  }
  const put = (r: number, c: number, ch: string) => {
    grid[r][c] = ch;
  };
  // blue box (rows 5-9, cols 4-11)
  for (let c = 4; c <= 11; c++) {
    put(5, c, 'u');
    put(9, c, 'u');
  }
  for (let r = 6; r <= 8; r++) {
    put(r, 4, 'u');
    put(r, 11, 'u');
  }
  // arrow from box to red circle-ish blob
  put(7, 13, 'u');
  put(7, 14, 'u');
  put(7, 15, 'u');
  put(6, 15, 'u');
  put(8, 15, 'u');
  // red blob (rows 5-9, cols 18-26)
  for (let c = 19; c <= 25; c++) {
    put(5, c, 'r');
    put(9, c, 'r');
  }
  put(6, 18, 'r');
  put(7, 18, 'r');
  put(8, 18, 'r');
  put(6, 26, 'r');
  put(7, 26, 'r');
  put(8, 26, 'r');
  // red underline scribbles
  for (let c = 4; c <= 10; c++) put(12, c, 'r');
  for (let c = 4; c <= 8; c++) put(14, c, 'r');
  // green rising chart line (rows 21 down to 16)
  const chart: [number, number][] = [
    [21, 16],
    [21, 17],
    [20, 18],
    [20, 19],
    [19, 20],
    [18, 21],
    [18, 22],
    [17, 23],
    [16, 24],
    [16, 25],
  ];
  for (const [r, c] of chart) put(r, c, 'g');
  // chart axis (blue)
  for (let r = 16; r <= 22; r++) put(r, 15, 'u');
  for (let c = 15; c <= 26; c++) put(22, c, 'u');
  // blue bullet list bottom-left, with green ticks
  for (const r of [17, 19, 21]) {
    put(r, 4, 'u');
    for (let c = 6; c <= 10 + (r % 3); c++) put(r, c, 'u');
  }
  put(17, 13, 'g');
  put(19, 13, 'g');
  // marker tray (rows 26-27) with markers
  for (let c = 5; c <= 26; c++) {
    grid[26][c] = 'h';
    grid[27][c] = 'h';
  }
  for (const [c, ch] of [
    [8, 'r'],
    [9, 'r'],
    [13, 'u'],
    [14, 'u'],
    [18, 'g'],
    [19, 'g'],
  ] as [number, string][]) {
    grid[26][c] = ch;
  }
  // eraser block on the tray
  for (const c of [22, 23, 24]) grid[26][c] = 'k';
  return fromAscii(
    grid.map((r) => r.join('')),
    { a: SILVER_LIGHT, h: STEEL_LIGHT, w: PAPER, r: RED, u: BLUE, g: GREEN, k: IRON_DARK },
  );
})();

// ════════════════════════════════════════════════════════════════
// 10. trophy_gold — golden trophy, 16x16, on-surface
//     Gold cup with highlight, side handles, stem, dark plinth
//     with a gold plaque dot.
// ════════════════════════════════════════════════════════════════
const TROPHY_GOLD = fromAscii(
  [
    '................',
    '....yhGGGGGy....',
    '..y.yhhGGGGy.y..',
    '.y..yhhGGGGy..y.',
    '.y..yhGGGGGy..y.',
    '..y.yhGGGGGy.y..',
    '...yyGGGGGGyy...',
    '.....yGGGGy.....',
    '......yGGy......',
    '.......Gy.......',
    '.......Gy.......',
    '.....yGGGGy.....',
    '....okkkkkko....',
    '...okkkyykkko...',
    '...oooooooooo...',
    '................',
  ],
  { y: GOLD_DARK, G: GOLD, h: GOLD_LIGHT, o: INK, k: IRON_DARK },
);

// ════════════════════════════════════════════════════════════════
// Export + validation
// ════════════════════════════════════════════════════════════════

export const SPRITES: GeneratedSprite[] = [
  {
    id: 'desk_l',
    name: 'DESK_L',
    label: 'L-Desk',
    widthPx: 48,
    heightPx: 32,
    footprintW: 3,
    footprintH: 2,
    sprite: DESK_L,
  },
  {
    id: 'chair_gamer',
    name: 'CHAIR_GAMER',
    label: 'Gamer Chair',
    widthPx: 16,
    heightPx: 32,
    footprintW: 1,
    footprintH: 1,
    sprite: CHAIR_GAMER,
  },
  {
    id: 'monitor_dual',
    name: 'MONITOR_DUAL',
    label: 'Dual Monitors',
    widthPx: 32,
    heightPx: 16,
    footprintW: 2,
    footprintH: 1,
    sprite: MONITOR_DUAL,
  },
  {
    id: 'server_rack',
    name: 'SERVER_RACK',
    label: 'Server Rack',
    widthPx: 16,
    heightPx: 48,
    footprintW: 1,
    footprintH: 1,
    sprite: SERVER_RACK,
  },
  {
    id: 'plant_monstera',
    name: 'PLANT_MONSTERA',
    label: 'Monstera',
    widthPx: 16,
    heightPx: 32,
    footprintW: 1,
    footprintH: 1,
    sprite: PLANT_MONSTERA,
  },
  {
    id: 'coffee_machine',
    name: 'COFFEE_MACHINE',
    label: 'Coffee Machine',
    widthPx: 16,
    heightPx: 16,
    footprintW: 1,
    footprintH: 1,
    sprite: COFFEE_MACHINE,
  },
  {
    id: 'fish_tank',
    name: 'FISH_TANK',
    label: 'Fish Tank',
    widthPx: 32,
    heightPx: 32,
    footprintW: 2,
    footprintH: 1,
    sprite: FISH_TANK,
  },
  {
    id: 'rug_large',
    name: 'RUG_LARGE',
    label: 'Large Rug',
    widthPx: 48,
    heightPx: 32,
    footprintW: 3,
    footprintH: 2,
    sprite: RUG_LARGE,
  },
  {
    id: 'whiteboard',
    name: 'WHITEBOARD_BIG',
    label: 'Whiteboard',
    widthPx: 32,
    heightPx: 32,
    footprintW: 2,
    footprintH: 1,
    sprite: WHITEBOARD_BIG,
  },
  {
    id: 'trophy_gold',
    name: 'TROPHY_GOLD',
    label: 'Gold Trophy',
    widthPx: 16,
    heightPx: 16,
    footprintW: 1,
    footprintH: 1,
    sprite: TROPHY_GOLD,
  },
];

/** Validate declared dimensions against actual grids. Throws on mismatch. */
export function validateSprites(sprites: GeneratedSprite[]): void {
  for (const s of sprites) {
    if (s.sprite.length !== s.heightPx) {
      throw new Error(`${s.id}: height ${s.sprite.length} !== declared ${s.heightPx}`);
    }
    s.sprite.forEach((row, r) => {
      if (row.length !== s.widthPx) {
        throw new Error(`${s.id}: row ${r} width ${row.length} !== declared ${s.widthPx}`);
      }
    });
  }
}

validateSprites(SPRITES);
