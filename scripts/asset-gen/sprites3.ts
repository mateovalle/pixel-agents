/**
 * sprites3.ts — Batch 3 of generated furniture sprites (13 items).
 *
 * Same authoring approach as sprites.ts / sprites2.ts: ASCII pixel maps
 * ('.' = transparent) compiled to the `string[][]` hex-grid format used by
 * webview-ui/src/office/sprites/spriteData.ts, colors restricted to the
 * house palette in palette.ts.
 *
 * Style rules (matching the existing hand-authored furniture):
 *  - 1px outline in a darker shade of the material, not pure black
 *  - light from top-left (light tone top/left, shadow bottom/right)
 *  - 2-tone shading per material, 3-6 colors per sprite
 *  - top-down-ish 3/4 perspective, legs as short dark stubs
 *
 * Palette additions in this batch (see palette.ts): PURPLE / PURPLE_DARK
 * (first purple in the house palette), GREEN_LIGHT (lit green surface),
 * LAMP_WARM (warm bulb/vending-glow yellow).
 *
 * Render/preview: node --experimental-strip-types scripts/asset-gen/render-sheet.ts
 */

import {
  ALL_COLORS,
  AMBER,
  BLUE,
  CLAY,
  CLAY_DARK,
  GOLD,
  GOLD_DARK,
  GOLD_LIGHT,
  GREEN,
  GREEN_LIGHT,
  ICE,
  INK,
  IRON,
  IRON_DARK,
  LAMP_WARM,
  LEAF,
  LEAF_DARK,
  LED_GREEN,
  ORANGE,
  PAPER,
  PURPLE,
  RED,
  SCREEN_BLUE,
  SCREEN_SHADOW,
  SILVER,
  SILVER_LIGHT,
  SKY,
  STEEL,
  STEEL_DARK,
  STEEL_LIGHT,
  WOOD,
  WOOD_DARK,
  WOOD_LIGHT,
} from './palette.ts';
import type { GeneratedSprite } from './sprites.ts';
import { validateSprites } from './sprites.ts';

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
// 1. window — wall window with sky view, 32x32, wall item
//    Silver frame (lit top-left ring), 4 panes split by muntins,
//    sky with ice clouds and green hills at the bottom, sill.
// ════════════════════════════════════════════════════════════════
const WINDOW = (() => {
  const W = 32;
  const grid: string[][] = Array.from({ length: 32 }, () => new Array<string>(W).fill('.'));
  // frame rows 1-26, cols 1-30
  for (let r = 1; r <= 26; r++) {
    for (let c = 1; c <= 30; c++) {
      if (r === 1 || r === 26 || c === 1 || c === 30) grid[r][c] = 'a';
      else if (r === 2 || c === 2)
        grid[r][c] = 'A'; // lit inner ring top/left
      else if (r === 25 || c === 29) grid[r][c] = 'a';
      else grid[r][c] = 'S'; // sky
    }
  }
  // clouds (ice)
  const cloud = (r0: number, c0: number, len: number) => {
    for (let c = c0; c < c0 + len; c++) grid[r0][c] = 'I';
    for (let c = c0 + 1; c < c0 + len - 1; c++) grid[r0 - 1][c] = 'I';
  };
  cloud(7, 6, 6);
  cloud(6, 20, 5);
  cloud(11, 12, 4);
  // green hills along the bottom of the glass (rows 20-24)
  const hillTop = (c: number) => {
    // two soft bumps
    const a = Math.abs(c - 9);
    const b = Math.abs(c - 23);
    return Math.min(21 + Math.floor(a / 3), 20 + Math.floor(b / 2), 24);
  };
  for (let c = 3; c <= 28; c++) {
    const top = hillTop(c);
    for (let r = top; r <= 24; r++) {
      if (grid[r][c] === 'S') grid[r][c] = r === top ? 'D' : 'G';
    }
  }
  // muntin cross (drawn over the view)
  for (let c = 3; c <= 28; c++) {
    grid[13][c] = 'a';
    grid[14][c] = 'a';
  }
  for (let r = 3; r <= 24; r++) {
    grid[r][15] = 'a';
    grid[r][16] = 'a';
  }
  // sill (wider than the frame, lit top)
  for (let c = 0; c <= 31; c++) {
    grid[27][c] = 'A';
    grid[28][c] = 'a';
  }
  return fromAscii(
    grid.map((r) => r.join('')),
    { a: SILVER, A: SILVER_LIGHT, S: SKY, I: ICE, G: LEAF, D: LEAF_DARK },
  );
})();

// ════════════════════════════════════════════════════════════════
// 2. tv_dashboard — wall TV with graph dashboard, 32x16, wall item
//    Monitor language from batch 1: steel frame, dark bezel, blue
//    screen. Content: dark header bar, green line chart on the
//    left, colored bar chart on the right.
// ════════════════════════════════════════════════════════════════
const TV_DASHBOARD = (() => {
  const W = 32;
  const grid: string[][] = Array.from({ length: 16 }, () => new Array<string>(W).fill('.'));
  for (let r = 1; r <= 13; r++) {
    for (let c = 1; c <= 30; c++) {
      if (r === 1 || r === 13 || c === 1 || c === 30) grid[r][c] = 'f';
      else if (r === 2 || r === 12 || c === 2 || c === 29) grid[r][c] = 'z';
      else grid[r][c] = 'c';
    }
  }
  // header bar with title dashes + live dot
  for (let c = 3; c <= 28; c++) grid[3][c] = 'z';
  for (const c of [4, 5, 6, 8, 9]) grid[3][c] = 'w';
  grid[3][27] = 'G';
  // left: line chart, axis + rising green line
  for (let r = 5; r <= 10; r++) grid[r][4] = 'w';
  for (let c = 4; c <= 15; c++) grid[10][c] = 'w';
  const line: [number, number][] = [
    [9, 5],
    [9, 6],
    [8, 7],
    [8, 8],
    [7, 9],
    [7, 10],
    [8, 11],
    [6, 12],
    [6, 13],
    [5, 14],
    [5, 15],
  ];
  for (const [r, c] of line) grid[r][c] = 'G';
  // right: bar chart on baseline row 10
  const bars: [number, number, string][] = [
    [18, 3, 'A'],
    [21, 5, 'G'],
    [24, 2, 'R'],
    [27, 6, 'S'],
  ];
  for (const [c0, h, ch] of bars) {
    for (let r = 10; r > 10 - h; r--) {
      grid[r][c0] = ch;
      grid[r][c0 + 1] = ch;
    }
  }
  return fromAscii(
    grid.map((r) => r.join('')),
    {
      f: STEEL_DARK,
      z: SCREEN_SHADOW,
      c: SCREEN_BLUE,
      w: PAPER,
      G: LED_GREEN,
      A: AMBER,
      R: RED,
      S: SKY,
    },
  );
})();

// ════════════════════════════════════════════════════════════════
// 3. desk_lamp — small articulated lamp, 16x16, on-surface
//    Gold shade at top-left, warm glowing opening + light spill,
//    steel arm with elbow, dark round base bottom-center.
// ════════════════════════════════════════════════════════════════
const DESK_LAMP = fromAscii(
  [
    '................',
    '..yyyyy.........',
    '.yGGGGGyy.......',
    '.yGGGGGGGyy.....',
    '..WWWWWWWgg.....',
    '..LLLLLL..gg....',
    '...LL......gg...',
    '...........gg...',
    '..........gg....',
    '.........gg.....',
    '........gg......',
    '.......gg.......',
    '....kkkkkkkk....',
    '...kkkkkkkkkk...',
    '................',
    '................',
  ],
  { y: GOLD_DARK, G: GOLD, W: LAMP_WARM, L: GOLD_LIGHT, g: STEEL, k: IRON_DARK },
);

// ════════════════════════════════════════════════════════════════
// 4. printer — office printer with paper, 16x16, on-surface
//    Paper feeding out the top slot, lit steel top, body with
//    green power LED + amber button, paper in the front tray.
// ════════════════════════════════════════════════════════════════
const PRINTER = fromAscii(
  [
    '................',
    '....wwwwwww.....',
    '....wwwwwww.....',
    '..oooooooooooo..',
    '..ohhnnnnnnnho..',
    '..ohhhhhhhhhho..',
    '..obbbbbbbGabo..',
    '..obbbbbbbbbbo..',
    '..owwwwwwwwbbo..',
    '..obbbbbbbbbbo..',
    '..okkkkkkkkkko..',
    '..oooooooooooo..',
    '..oo........oo..',
    '................',
    '................',
    '................',
  ],
  {
    w: PAPER,
    o: IRON_DARK,
    h: STEEL_LIGHT,
    n: INK,
    b: STEEL,
    G: LED_GREEN,
    a: AMBER,
    k: IRON,
  },
);

// ════════════════════════════════════════════════════════════════
// 5. trash_bin — small metal bin, 16x16, 1x1
//    Lit silver rim, tapered steel body with dark vertical ridges,
//    crumpled paper peeking over the top.
// ════════════════════════════════════════════════════════════════
const TRASH_BIN = fromAscii(
  [
    '................',
    '....ww..........',
    '...SwwSSSSSSS...',
    '..SssssssssssS..',
    '..obbdbbdbbdbo..',
    '..obbdbbdbbdbo..',
    '..obbdbbdbbdbo..',
    '..obbdbbdbbdbo..',
    '...obdbbdbbdo...',
    '...obdbbdbbdo...',
    '...obdbbdbbdo...',
    '...oddddddddo...',
    '...oooooooooo...',
    '................',
    '................',
    '................',
  ],
  { S: SILVER_LIGHT, s: SILVER, o: IRON_DARK, b: STEEL, d: STEEL_DARK, w: PAPER },
);

// ════════════════════════════════════════════════════════════════
// 6. vending_machine — snack vending machine, 16x48, 1x1
//    Red cabinet, warm lit sign, glass window with 4 snack
//    shelves (gold/purple/orange/red/sky/green items), side panel
//    with display + keypad + coin slot, dispensing flap, feet.
// ════════════════════════════════════════════════════════════════
const VENDING_MACHINE = (() => {
  const rows: string[] = [];
  const side = (inner: string) => 'oR' + inner + 'Ro'; // inner = 12 chars
  // window column (inner cols 0-7) + panel column (inner cols 8-11)
  const win = (glass: string, panel: string) => side(glass + panel); // 8 + 4
  rows.push('.' + rep('o', 14) + '.'); // r0 top edge
  rows.push('o' + rep('W', 14) + 'o'); // r1 lit sign
  rows.push('o' + 'WRRWRWRWWRRWRW' + 'o'); // r2 sign letters
  rows.push(rep('o', 16)); // r3
  // window top frame + lit interior strip
  rows.push(win(rep('k', 8), 'RRRR')); // r4
  rows.push(win('k' + rep('W', 6) + 'k', 'RRRR')); // r5 lamp strip
  // shelves: item rows x2, then shelf line; panel content alongside
  // (6-char inner glass strips: two snacks with a gap)
  const shelfItems = ['YYzzPP', 'RRzzGG', 'NNzzYY', 'BBzzRR'];
  const panelRows: Record<number, string> = {
    6: 'RGGR', // display
    7: 'RGGR',
    10: 'RkkR', // keypad
    12: 'RkkR',
    14: 'RkkR',
    17: 'RRnR', // coin slot
    18: 'RRnR',
    19: 'RRnR',
    22: 'RkkR', // change button
  };
  const panel = (row: number) => panelRows[row] ?? 'RRRR';
  let r = 6;
  for (const items of shelfItems) {
    rows.push(win('k' + rep('z', 6) + 'k', panel(r))); // gap above items
    r++;
    rows.push(win('k' + items + 'k', panel(r)));
    r++;
    rows.push(win('k' + items + 'k', panel(r)));
    r++;
    rows.push(win('k' + rep('d', 6) + 'k', panel(r))); // shelf line
    r++;
  }
  rows.push(win('k' + rep('z', 6) + 'k', panel(r))); // r22 dark row
  rows.push(win(rep('k', 8), panel(23))); // r23 window bottom frame
  // r24-29: red body
  for (let i = 0; i < 6; i++) rows.push(side(rep('R', 12)));
  // r30-33: dispensing flap
  rows.push(side('R' + rep('k', 9) + 'RR'));
  rows.push(side('R' + 'k' + rep('n', 7) + 'k' + 'RR'));
  rows.push(side('R' + 'k' + rep('n', 7) + 'k' + 'RR'));
  rows.push(side('R' + rep('k', 9) + 'RR'));
  // r34-37: red body
  for (let i = 0; i < 4; i++) rows.push(side(rep('R', 12)));
  // r38-42: kick plate
  for (let i = 0; i < 5; i++) rows.push(side(rep('d', 12)));
  rows.push('.' + rep('o', 14) + '.'); // r43 bottom edge
  rows.push('..oo........oo..'); // r44 feet
  rows.push('..oo........oo..'); // r45
  rows.push(rep('.', 16)); // r46
  rows.push(rep('.', 16)); // r47
  return fromAscii(rows, {
    o: INK,
    R: RED,
    W: LAMP_WARM,
    k: IRON_DARK,
    d: IRON,
    z: SCREEN_SHADOW,
    n: INK,
    Y: GOLD,
    P: PURPLE,
    N: ORANGE,
    B: SKY,
    G: LED_GREEN,
  });
})();

// ════════════════════════════════════════════════════════════════
// 7. microwave — countertop microwave, 16x16, on-surface
//    Lit steel top, dark door window with glass shine, handle
//    strip, control column with green display + buttons, feet.
// ════════════════════════════════════════════════════════════════
const MICROWAVE = fromAscii(
  [
    '................',
    '................',
    '..oooooooooooo..',
    '..ohhhhhhhhhho..',
    '..obwiiiibdGGo..',
    '..obiiiiibdbbo..',
    '..obiiiiibddbo..',
    '..obiiiiibdbdo..',
    '..obbbbbbbddbo..',
    '..oooooooooooo..',
    '..oo........oo..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  { o: IRON_DARK, h: STEEL_LIGHT, b: STEEL, i: INK, w: ICE, d: IRON, G: LED_GREEN },
);

// ════════════════════════════════════════════════════════════════
// 8. kitchen_counter — counter with sink, 32x32, 2x1
//    Stone countertop (silver edge, lit paper strip, ice surface),
//    inset steel sink with faucet, wood cabinet front with two
//    doors like the fish-tank stand.
// ════════════════════════════════════════════════════════════════
const KITCHEN_COUNTER = (() => {
  const grid: string[][] = Array.from({ length: 32 }, () => new Array<string>(32).fill('.'));
  const set = (r: number, c: number, ch: string) => {
    grid[r][c] = ch;
  };
  // countertop rows 1-12
  for (let c = 1; c <= 30; c++) {
    set(1, c, 's');
    set(12, c, 's');
  }
  for (let r = 2; r <= 11; r++) {
    set(r, 1, 's');
    set(r, 30, 's');
    for (let c = 2; c <= 29; c++) set(r, c, r === 2 || c === 2 ? 'P' : 'I');
  }
  // sink: rim ring rows 3-10, cols 17-27
  for (let c = 17; c <= 27; c++) {
    set(3, c, 's');
    set(10, c, 's');
  }
  for (let r = 4; r <= 9; r++) {
    set(r, 17, 's');
    set(r, 27, 's');
    for (let c = 18; c <= 26; c++) {
      // recessed basin: shadow top/left, steel base, lit bottom/right
      if (r === 4 || c === 18) set(r, c, 'k');
      else if (r === 9 || c === 26) set(r, c, 'h');
      else set(r, c, 'b');
    }
  }
  set(7, 22, 'n'); // drain
  set(7, 23, 'n');
  // faucet over the back rim (steel so it reads on the light counter)
  set(2, 19, 'b');
  set(3, 19, 'b');
  set(2, 20, 'b');
  set(2, 21, 'b');
  set(3, 21, 'k');
  // cabinet rows 13-26
  for (let c = 1; c <= 30; c++) {
    set(13, c, 'W');
    set(26, c, 'W');
  }
  for (let r = 14; r <= 25; r++) {
    set(r, 1, 'W');
    set(r, 30, 'W');
    for (let c = 2; c <= 29; c++) {
      const isEdge = c === 2 || c === 15 || c === 16 || c === 29 || r === 25;
      if (isEdge) set(r, c, 'e');
      else if (r === 14)
        set(r, c, 'L'); // lit door tops
      else set(r, c, 'W');
    }
  }
  set(19, 13, 'e'); // knobs
  set(19, 18, 'e');
  // feet
  for (const c of [2, 3, 28, 29]) {
    set(27, c, 'e');
    set(28, c, 'e');
  }
  return fromAscii(
    grid.map((r) => r.join('')),
    {
      s: SILVER,
      P: PAPER,
      I: ICE,
      k: IRON_DARK,
      b: STEEL,
      h: STEEL_LIGHT,
      n: INK,
      W: WOOD,
      L: WOOD_LIGHT,
      e: WOOD_DARK,
    },
  );
})();

// ════════════════════════════════════════════════════════════════
// 9. pingpong_table — green table with net + paddles, 48x32, 3x2
//    Top-down green surface (lit top/left like the desks), white
//    boundary + center lines, ice net across the middle with dark
//    posts, red + blue paddles, ball, dark leg stubs.
// ════════════════════════════════════════════════════════════════
const PINGPONG_TABLE = (() => {
  const grid: string[][] = Array.from({ length: 32 }, () => new Array<string>(48).fill('.'));
  const set = (r: number, c: number, ch: string) => {
    grid[r][c] = ch;
  };
  // table top rows 1-25
  for (let c = 1; c <= 46; c++) {
    set(1, c, 'D');
    set(25, c, 'D');
  }
  for (let r = 2; r <= 24; r++) {
    set(r, 1, 'D');
    set(r, 46, 'D');
    for (let c = 2; c <= 45; c++) set(r, c, r === 2 || c === 2 ? 'L' : 'G');
  }
  // white boundary lines
  for (let c = 5; c <= 42; c++) {
    set(4, c, 'w');
    set(22, c, 'w');
  }
  for (let r = 4; r <= 22; r++) {
    set(r, 5, 'w');
    set(r, 42, 'w');
  }
  // center line (lengthwise)
  for (let c = 6; c <= 41; c++) set(13, c, 'w');
  // paddles: red (left half, handle down) + blue (right half, handle up)
  const paddle = (r0: number, c0: number, ch: string, handleDown: boolean) => {
    for (let r = r0; r < r0 + 3; r++) {
      for (let c = c0; c < c0 + 3; c++) set(r, c, ch);
    }
    if (handleDown) {
      set(r0 + 3, c0 + 1, 'e');
      set(r0 + 4, c0 + 1, 'e');
    } else {
      set(r0 - 1, c0 + 1, 'e');
      set(r0 - 2, c0 + 1, 'e');
    }
  };
  paddle(7, 12, 'R', true);
  paddle(17, 33, 'B', false);
  set(9, 29, 'w'); // ball
  // net across the middle (drawn over everything on the top)
  for (let r = 2; r <= 24; r++) {
    set(r, 23, 'i');
    set(r, 24, 'i');
  }
  for (const r of [1, 25]) {
    set(r, 23, 'k');
    set(r, 24, 'k');
  }
  // leg stubs rows 26-29
  for (let r = 26; r <= 29; r++) {
    for (const c of [3, 4, 43, 44]) set(r, c, 'k');
  }
  return fromAscii(
    grid.map((r) => r.join('')),
    {
      D: LEAF_DARK,
      G: LEAF,
      L: GREEN_LIGHT,
      w: PAPER,
      i: ICE,
      k: IRON_DARK,
      R: RED,
      B: BLUE,
      e: WOOD_DARK,
    },
  );
})();

// ════════════════════════════════════════════════════════════════
// 10. medals_wall — framed medals, 16x16, wall item
//     Wood frame with dark inner shadow, paper matte, three
//     ribbons (red / blue / purple) with gold medals, plaque.
// ════════════════════════════════════════════════════════════════
const MEDALS_WALL = fromAscii(
  [
    '................',
    '.ffffffffffffff.',
    '.fddddddddddddf.',
    '.fdwwwwwwwwwwwf.',
    '.fdwwrrwwwuuwwf.',
    '.fdwwrrwwwuuwwf.',
    '.fdwrrrrwuuuuwf.',
    '.fdwwyywwwyywwf.',
    '.fdwyLGywyLGywf.',
    '.fdwyGGywyGGywf.',
    '.fdwwyywwwyywwf.',
    '.fdwwwwwwwwwwwf.',
    '.fdwwwwwwwwwwwf.',
    '.fwwwwwwwwwwwwf.',
    '.ffffffffffffff.',
    '................',
  ],
  {
    f: WOOD,
    d: WOOD_DARK,
    w: PAPER,
    r: RED,
    u: BLUE,
    G: GOLD,
    L: GOLD_LIGHT,
    y: GOLD_DARK,
  },
);

// ════════════════════════════════════════════════════════════════
// 11. poster_code — motivational code poster, 16x32, wall item
//     Iron frame, dark blue poster, purple title band, big "</>"
//     glyph, syntax-colored code lines, gold underline.
// ════════════════════════════════════════════════════════════════
const POSTER_CODE = (() => {
  const rows: string[] = [];
  const inner = (s: string) => '.F' + s + 'F.'; // s = 12 chars
  rows.push(rep('.', 16)); // r0
  rows.push('.' + rep('F', 14) + '.'); // r1 frame top
  rows.push(inner(rep('z', 12))); // r2
  rows.push(inner(rep('p', 12))); // r3 title band
  rows.push(inner('ppwwwpwwwwpp')); // r4 title text
  rows.push(inner(rep('p', 12))); // r5
  rows.push(inner(rep('z', 12))); // r6
  rows.push(inner('zzzwzzzswzzz')); // r7  </>
  rows.push(inner('zzwzzzszzwzz')); // r8
  rows.push(inner('zwzzzzszzzwz')); // r9
  rows.push(inner('zzwzzszzzwzz')); // r10
  rows.push(inner('zzzwszzzwzzz')); // r11
  rows.push(inner(rep('z', 12))); // r12
  rows.push(inner(rep('z', 12))); // r13
  rows.push(inner(rep('z', 12))); // r14
  rows.push(inner('ppzssszyyzzz')); // r15 code lines
  rows.push(inner(rep('z', 12))); // r16
  rows.push(inner('zzbbzsssszzz')); // r17
  rows.push(inner(rep('z', 12))); // r18
  rows.push(inner('zzyyyzbbzzzz')); // r19
  rows.push(inner(rep('z', 12))); // r20
  rows.push(inner('zzzpppzsszzz')); // r21
  rows.push(inner(rep('z', 12))); // r22
  rows.push(inner('bbzyyzsssszz')); // r23
  rows.push(inner(rep('z', 12))); // r24
  rows.push(inner('zppppzzzzzzz')); // r25
  rows.push(inner(rep('z', 12))); // r26
  rows.push(inner('zyyyyyyyyyyz')); // r27 gold underline
  rows.push(inner(rep('z', 12))); // r28
  rows.push('.' + rep('F', 14) + '.'); // r29 frame bottom
  rows.push(rep('.', 16)); // r30
  rows.push(rep('.', 16)); // r31
  return fromAscii(rows, {
    F: IRON,
    z: SCREEN_SHADOW,
    p: PURPLE,
    w: PAPER,
    s: LED_GREEN,
    b: SKY,
    y: GOLD_DARK,
  });
})();

// ════════════════════════════════════════════════════════════════
// 12. cat_sleeping — orange cat curled up, 16x16, walkable decor
//     Curled oval body, head at the left with two ears, closed
//     eye, clay shading + stripes, tail wrapped along the front.
// ════════════════════════════════════════════════════════════════
const CAT_SLEEPING = fromAscii(
  [
    '................',
    '................',
    '................',
    '................',
    '...q..q.........',
    '..qOqqOqqq......',
    '.qOOOOOOOOqq....',
    '.qOkOOOOOOOOq...',
    '.qOOOOOCCOOOOq..',
    '..qOOOCOOOCCOq..',
    '..qCOOOOCOOOOq..',
    '...qCCCCCCCCq...',
    '....qqqqqqqq....',
    '................',
    '................',
    '................',
  ],
  { q: CLAY_DARK, O: ORANGE, C: CLAY, k: INK },
);

// ════════════════════════════════════════════════════════════════
// 13. rubber_duck — tiny yellow duck, 16x16, on-surface
//     Gold body with light highlight, orange beak, ink eye,
//     wing mark, tail flick. Dev mascot.
// ════════════════════════════════════════════════════════════════
const RUBBER_DUCK = fromAscii(
  [
    '................',
    '................',
    '................',
    '................',
    '.....yyy........',
    '....yGLGy.......',
    '...yGkGGy.......',
    '.OOyGGGGy.......',
    '..OyGGGGy.......',
    '...yGGGyyyy.....',
    '...yGGGGGGGyy...',
    '..yGLGGGGGGGGy..',
    '..yGGGGyyGGGGy..',
    '...yGGGGGGGGy...',
    '....yyyyyyyy....',
    '................',
  ],
  { y: GOLD_DARK, G: GOLD, L: GOLD_LIGHT, O: ORANGE, k: INK },
);

// ════════════════════════════════════════════════════════════════
// Export + validation
// ════════════════════════════════════════════════════════════════

export const SPRITES3: GeneratedSprite[] = [
  {
    id: 'window',
    name: 'WINDOW',
    label: 'Window',
    widthPx: 32,
    heightPx: 32,
    footprintW: 2,
    footprintH: 1,
    sprite: WINDOW,
  },
  {
    id: 'tv_dashboard',
    name: 'TV_DASHBOARD',
    label: 'Dashboard TV',
    widthPx: 32,
    heightPx: 16,
    footprintW: 2,
    footprintH: 1,
    sprite: TV_DASHBOARD,
  },
  {
    id: 'desk_lamp',
    name: 'DESK_LAMP',
    label: 'Desk Lamp',
    widthPx: 16,
    heightPx: 16,
    footprintW: 1,
    footprintH: 1,
    sprite: DESK_LAMP,
  },
  {
    id: 'printer',
    name: 'PRINTER',
    label: 'Printer',
    widthPx: 16,
    heightPx: 16,
    footprintW: 1,
    footprintH: 1,
    sprite: PRINTER,
  },
  {
    id: 'trash_bin',
    name: 'TRASH_BIN',
    label: 'Trash Bin',
    widthPx: 16,
    heightPx: 16,
    footprintW: 1,
    footprintH: 1,
    sprite: TRASH_BIN,
  },
  {
    id: 'vending_machine',
    name: 'VENDING_MACHINE',
    label: 'Vending Machine',
    widthPx: 16,
    heightPx: 48,
    footprintW: 1,
    footprintH: 1,
    sprite: VENDING_MACHINE,
  },
  {
    id: 'microwave',
    name: 'MICROWAVE',
    label: 'Microwave',
    widthPx: 16,
    heightPx: 16,
    footprintW: 1,
    footprintH: 1,
    sprite: MICROWAVE,
  },
  {
    id: 'kitchen_counter',
    name: 'KITCHEN_COUNTER',
    label: 'Kitchen Counter',
    widthPx: 32,
    heightPx: 32,
    footprintW: 2,
    footprintH: 1,
    sprite: KITCHEN_COUNTER,
  },
  {
    id: 'pingpong_table',
    name: 'PINGPONG_TABLE',
    label: 'Ping-Pong Table',
    widthPx: 48,
    heightPx: 32,
    footprintW: 3,
    footprintH: 2,
    sprite: PINGPONG_TABLE,
  },
  {
    id: 'medals_wall',
    name: 'MEDALS_WALL',
    label: 'Medal Frame',
    widthPx: 16,
    heightPx: 16,
    footprintW: 1,
    footprintH: 1,
    sprite: MEDALS_WALL,
  },
  {
    id: 'poster_code',
    name: 'POSTER_CODE',
    label: 'Code Poster',
    widthPx: 16,
    heightPx: 32,
    footprintW: 1,
    footprintH: 1,
    sprite: POSTER_CODE,
  },
  {
    id: 'cat_sleeping',
    name: 'CAT_SLEEPING',
    label: 'Sleeping Cat',
    widthPx: 16,
    heightPx: 16,
    footprintW: 1,
    footprintH: 1,
    sprite: CAT_SLEEPING,
  },
  {
    id: 'rubber_duck',
    name: 'RUBBER_DUCK',
    label: 'Rubber Duck',
    widthPx: 16,
    heightPx: 16,
    footprintW: 1,
    footprintH: 1,
    sprite: RUBBER_DUCK,
  },
];

validateSprites(SPRITES3);

// palette-only check: every opaque pixel must use a house-palette color
const allowed = new Set(ALL_COLORS);
for (const s of SPRITES3) {
  s.sprite.forEach((row, r) => {
    row.forEach((hex, c) => {
      if (hex && !allowed.has(hex)) {
        throw new Error(`${s.id}: non-palette color ${hex} at row ${r} col ${c}`);
      }
    });
  });
}
