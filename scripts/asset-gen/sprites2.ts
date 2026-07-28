/**
 * sprites2.ts — Batch 2 of generated furniture sprites (15 items).
 *
 * Same authoring approach as sprites.ts (batch 1): ASCII pixel maps
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
 * Render/preview: node --experimental-strip-types scripts/asset-gen/render-sheet.ts
 */

import {
  ALL_COLORS,
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
  SILVER,
  SKY,
  STEEL,
  STEEL_DARK,
  STEEL_LIGHT,
  WOOD,
  WOOD_DARK,
  WOOD_LIGHT,
  WOOD_SURFACE,
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
// 1. desk_standing — standing desk, 32x32, 2x1, isDesk
//    Wood top like DESK_SQUARE (edge, lit strip, surface) but
//    elevated: tall steel legs with a crossbar and dark feet.
// ════════════════════════════════════════════════════════════════
const DESK_STANDING = (() => {
  const rows: string[] = [];
  // r0: breathing room
  rows.push(rep('.', 32));
  // r1: top edge
  rows.push('.' + rep('e', 30) + '.');
  // r2: lit strip (light from top-left)
  rows.push('.e' + rep('l', 28) + 'e.');
  // r3-11: surface, lit left column, plank line at r7
  for (let r = 3; r <= 11; r++) {
    rows.push('.el' + rep(r === 7 ? 'l' : 's', 27) + 'e.');
  }
  // r12: bottom edge
  rows.push('.' + rep('e', 30) + '.');
  // r13: dark underside lip
  rows.push('..' + rep('d', 28) + '..');
  // r14-25: tall steel legs
  for (let r = 14; r <= 25; r++) {
    if (r === 21) {
      // crossbar
      rows.push(rep('.', 4) + rep('m', 24) + rep('.', 4));
    } else {
      rows.push(rep('.', 4) + 'mm' + rep('.', 20) + 'mm' + rep('.', 4));
    }
  }
  // r26-27: T-feet
  rows.push('..' + rep('k', 6) + rep('.', 16) + rep('k', 6) + '..');
  rows.push('..' + rep('k', 6) + rep('.', 16) + rep('k', 6) + '..');
  // r28-31: empty
  for (let r = 0; r < 4; r++) rows.push(rep('.', 32));
  return fromAscii(rows, {
    e: WOOD,
    l: WOOD_LIGHT,
    s: WOOD_SURFACE,
    d: WOOD_DARK,
    m: STEEL_DARK,
    k: IRON_DARK,
  });
})();

// ════════════════════════════════════════════════════════════════
// 2. desk_double — long desk for two, 48x32, 3x2, isDesk
//    Pure top-down like DESK_SQUARE, widened: two work halves
//    divided by a lit center line, corner + middle leg stubs.
// ════════════════════════════════════════════════════════════════
const DESK_DOUBLE = (() => {
  const rows: string[] = [];
  // lit left column (light from top-left), like DESK_L
  const surf = (fill: string) =>
    fill === 's' ? '.el' + rep('s', 43) + 'e.' : '.e' + rep(fill, 44) + 'e.';
  // r0: empty
  rows.push(rep('.', 48));
  // r1: top edge
  rows.push('.' + rep('e', 46) + '.');
  // r2: lit strip
  rows.push(surf('l'));
  // r3-5: top surface
  for (let r = 3; r <= 5; r++) rows.push(surf('s'));
  // r6: divider (this side's work strip boundary)
  rows.push('.d' + rep('e', 44) + 'd.');
  // r7-12: upper work surface
  for (let r = 7; r <= 12; r++) rows.push(surf('s'));
  // r13: lit center line splitting the two facing work halves
  // (same treatment as DESK_SQUARE's center line)
  rows.push(surf('l'));
  // r14-19: lower work surface
  for (let r = 14; r <= 19; r++) rows.push(surf('s'));
  // r20: divider
  rows.push('.d' + rep('e', 44) + 'd.');
  // r21-24: bottom surface, last row lit
  for (let r = 21; r <= 24; r++) rows.push(surf(r === 24 ? 'l' : 's'));
  // r25: bottom edge
  rows.push('.' + rep('e', 46) + '.');
  // r26-29: leg stubs at corners + middle
  for (let r = 26; r <= 29; r++) {
    rows.push('.dd' + rep('.', 20) + 'dd' + rep('.', 20) + 'dd.');
  }
  // r30-31: empty
  rows.push(rep('.', 48));
  rows.push(rep('.', 48));
  return fromAscii(rows, { e: WOOD, l: WOOD_LIGHT, s: WOOD_SURFACE, d: WOOD_DARK });
})();

// ════════════════════════════════════════════════════════════════
// 3. chair_office — wheeled office chair, front-facing, 16x32, 1x1
//    Blue fabric back + seat (dark blue outline, lit top), steel
//    gas-lift stem, star base with wheels like CHAIR_GAMER.
// ════════════════════════════════════════════════════════════════
const CHAIR_OFFICE = fromAscii(
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '....dddddddd....',
    '...dLLLLLLLLd...',
    '..dLBBBBBBBBLd..',
    '..dBBBBBBBBBBd..',
    '..dBBBBBBBBBBd..',
    '..dBBBBBBBBBBd..',
    '..dBBBBBBBBBBd..',
    '..dBBBBBBBBBBd..',
    '..dBBBBBBBBBBd..',
    '...dBBBBBBBBd...',
    '...dddddddddd...',
    '.ddBBBBBBBBBBdd.',
    '.dLLBBBBBBBBLLd.',
    '.dBBBBBBBBBBBBd.',
    '.dBBBBBBBBBBBBd.',
    '..ddBBBBBBBBdd..',
    '...dddddddddd...',
    '.......gk.......',
    '.......gk.......',
    '......ogko......',
    '....kkkkkkkk....',
    '..kkk..kk..kkk..',
    '..oo...oo...oo..',
    '................',
    '................',
  ],
  { d: SCREEN_SHADOW, B: BLUE, L: SCREEN_BLUE, g: STEEL, k: IRON_DARK, o: INK },
);

// ════════════════════════════════════════════════════════════════
// 4. stool — simple round wooden stool, 16x16, 1x1
//    Round seat (lit top-left), splayed dark legs.
// ════════════════════════════════════════════════════════════════
const STOOL = fromAscii(
  [
    '................',
    '....eeeeeeee....',
    '..eeLLLLLLLLee..',
    '.eLLSSSSSSSSLLe.',
    '.eLSSSSSSSSSSLe.',
    '.eSSSSSSSSSSSSe.',
    '..eeSSSSSSSSee..',
    '....eeeeeeee....',
    '...dd......dd...',
    '...dd......dd...',
    '...dd......dd...',
    '..dd........dd..',
    '..dd........dd..',
    '................',
    '................',
    '................',
  ],
  { e: WOOD, L: WOOD_LIGHT, S: WOOD_SURFACE, d: WOOD_DARK },
);

// ════════════════════════════════════════════════════════════════
// 5. couch — two-seat sofa, green fabric, 32x32, 2x1
//    Front-facing: lit backrest top, armrests, two seat cushions,
//    shadowed front skirt, wood feet.
// ════════════════════════════════════════════════════════════════
const COUCH = (() => {
  const rows: string[] = [];
  // r0-7: empty
  for (let r = 0; r < 8; r++) rows.push(rep('.', 32));
  // r8: top outline
  rows.push('.' + rep('o', 30) + '.');
  // r9: lit backrest top
  rows.push('o' + rep('h', 30) + 'o');
  // r10-14: backrest with center cushion split
  for (let r = 10; r <= 14; r++) {
    rows.push('o' + rep('G', 14) + 'gg' + rep('G', 14) + 'o');
  }
  // r15: armrest tops appear (lit), seat shadow under the backrest
  rows.push('o' + rep('h', 4) + 'o' + rep('g', 20) + 'o' + rep('h', 4) + 'o');
  // r16: cushion tops (lit)
  rows.push('o' + 'hGGG' + 'o' + rep('h', 20) + 'o' + rep('G', 4) + 'o');
  // r17-22: seat cushions with split; left armrest keeps a lit column
  for (let r = 17; r <= 22; r++) {
    rows.push('o' + 'hGGG' + 'o' + rep('G', 9) + 'gg' + rep('G', 9) + 'o' + rep('G', 4) + 'o');
  }
  // r23: cushion front shadow
  rows.push('o' + 'hGGG' + 'o' + rep('g', 20) + 'o' + rep('G', 4) + 'o');
  // r24-26: front skirt (shadowed)
  for (let r = 24; r <= 26; r++) rows.push('o' + rep('g', 30) + 'o');
  // r27: bottom outline
  rows.push('.' + rep('o', 30) + '.');
  // r28-29: wood feet
  rows.push('..ee' + rep('.', 24) + 'ee..');
  rows.push('..ee' + rep('.', 24) + 'ee..');
  // r30-31: empty
  rows.push(rep('.', 32));
  rows.push(rep('.', 32));
  return fromAscii(rows, { o: LEAF_DARK, G: GREEN, g: LEAF, h: LED_GREEN, e: WOOD_DARK });
})();

// ════════════════════════════════════════════════════════════════
// 6. coffee_table — low wooden table, 32x16, 2x1
//    Top-down wood surface like the desks, short leg stubs.
// ════════════════════════════════════════════════════════════════
const COFFEE_TABLE = (() => {
  const rows: string[] = [];
  // r0: empty
  rows.push(rep('.', 32));
  // r1: top edge
  rows.push('.' + rep('e', 30) + '.');
  // r2: lit strip
  rows.push('.e' + rep('l', 28) + 'e.');
  // r3-8: surface, lit left column, grain line at r5
  for (let r = 3; r <= 8; r++) {
    rows.push('.el' + rep(r === 5 ? 'l' : 's', 27) + 'e.');
  }
  // r9: bottom edge
  rows.push('.' + rep('e', 30) + '.');
  // r10-12: short leg stubs
  for (let r = 10; r <= 12; r++) {
    rows.push('.dd' + rep('.', 26) + 'dd.');
  }
  // r13-15: empty
  for (let r = 13; r <= 15; r++) rows.push(rep('.', 32));
  return fromAscii(rows, { e: WOOD, l: WOOD_LIGHT, s: WOOD_SURFACE, d: WOOD_DARK });
})();

// ════════════════════════════════════════════════════════════════
// 7. bookshelf_tall — tall shelf with colorful books, 16x48, 1x1
//    Same language as BOOKSHELF_SPRITE: wood frame, dark interior,
//    4 shelves of paired book spines (no purple in the house
//    palette, so spines use red/blue/green/gold/orange/sky).
// ════════════════════════════════════════════════════════════════
const BOOKSHELF_TALL = (() => {
  const rows: string[] = [];
  const shelf = (books: string) => {
    rows.push('W' + rep('D', 14) + 'W'); // shelf interior shadow
    for (let i = 0; i < 8; i++) rows.push('WD' + books + 'DW');
  };
  rows.push('.' + rep('W', 14) + '.'); // top
  shelf('RRBBGGYYOORR');
  rows.push(rep('W', 16));
  shelf('BBYYKKRRGGBB');
  rows.push(rep('W', 16));
  shelf('GGRROOBBYYDD'); // gap at the end of this shelf
  rows.push(rep('W', 16));
  shelf('YYGGBBRRKKOO');
  rows.push(rep('W', 16));
  // base: 4 dark rows + bottom edge
  for (let i = 0; i < 4; i++) rows.push('W' + rep('D', 14) + 'W');
  rows.push('.' + rep('W', 14) + '.');
  rows.push(rep('.', 16));
  rows.push(rep('.', 16));
  return fromAscii(rows, {
    W: WOOD,
    D: WOOD_DARK,
    R: RED,
    B: BLUE,
    G: GREEN,
    Y: GOLD_DARK,
    O: ORANGE,
    K: SKY,
  });
})();

// ════════════════════════════════════════════════════════════════
// 8. filing_cabinet — metal 3-drawer cabinet, 16x32, 1x1
//    Steel body, lit top, three drawers with dark handles,
//    plinth + feet.
// ════════════════════════════════════════════════════════════════
const FILING_CABINET = (() => {
  const rows: string[] = [];
  // r0-4: empty
  for (let r = 0; r < 5; r++) rows.push(rep('.', 16));
  // top
  rows.push('..oooooooooooo..');
  rows.push('..ohhhhhhhhhho..');
  // 3 drawers x 5 rows: divider, face, handle, face, shadow
  for (let d = 0; d < 3; d++) {
    rows.push('..oooooooooooo..');
    rows.push('..obbbbbbbbbbo..');
    rows.push('..obbbnnnnbbbo..');
    rows.push('..obbbbbbbbbbo..');
    rows.push('..okbbbbbbbbko..');
  }
  // bottom edge + plinth
  rows.push('..oooooooooooo..');
  rows.push('..okkkkkkkkkko..');
  rows.push('..oooooooooooo..');
  // feet
  rows.push('..oo........oo..');
  rows.push('..oo........oo..');
  // r27-31 handled above; pad to 32
  while (rows.length < 32) rows.push(rep('.', 16));
  return fromAscii(rows, { o: IRON_DARK, h: STEEL_LIGHT, b: STEEL, n: INK, k: IRON });
})();

// ════════════════════════════════════════════════════════════════
// 9. water_dispenser — blue bottle on white base, 16x32, 1x1
//    Taller cousin of COOLER_SPRITE: sky bottle with ice shine,
//    white body with red/blue taps, steel cabinet below.
// ════════════════════════════════════════════════════════════════
const WATER_DISPENSER = fromAscii(
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '....ssssssss....',
    '...sILLLLLLLs...',
    '...sILLLLLLLs...',
    '...sLLLLLLLLs...',
    '...sLLLLLLLLs...',
    '....sLLLLLLs....',
    '.....sLLLLs.....',
    '..ssssssssssss..',
    '..sWWWWWWWWWWs..',
    '..sWWWWWWWWWWs..',
    '..sWrrWWWWbbWs..',
    '..sWrWWWWWWbWs..',
    '..sWWWWWWWWWWs..',
    '..sWWWggggWWWs..',
    '..sWWWggggWWWs..',
    '..ssssssssssss..',
    '..sggggggggggs..',
    '..sggggggggggs..',
    '..sggkkkkkkggs..',
    '..sggggggggggs..',
    '..sggggggggggs..',
    '..ssssssssssss..',
    '..ss........ss..',
    '..ss........ss..',
    '................',
    '................',
  ],
  { s: SILVER, I: ICE, L: SKY, W: PAPER, r: RED, b: BLUE, g: STEEL, k: IRON },
);

// ════════════════════════════════════════════════════════════════
// 10. mini_fridge — small fridge with handle, 16x32, 1x1
//     Ice-white body, lit paper top + left edge, dark side handle,
//     vent grill at the bottom, dark feet.
// ════════════════════════════════════════════════════════════════
const MINI_FRIDGE = fromAscii(
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '..ssssssssssss..',
    '..sPPPPPPPPPPs..',
    '..sPIIIIIIIIks..',
    '..sPIIIIIIIIks..',
    '..sPIIIIIIIIks..',
    '..sPIIIIIIIIks..',
    '..sPIIIIIIIIIs..',
    '..sPIIIIIIIIIs..',
    '..sPIIIIIIIIIs..',
    '..sPIIbIIIIIIs..',
    '..sPIIIIIIIIIs..',
    '..sPIIIIIIIIIs..',
    '..sPIIIIIIIIIs..',
    '..sPIIIIIIIIIs..',
    '..sIIIIIIIIIIs..',
    '..sggggggggggs..',
    '..ssssssssssss..',
    '..kk........kk..',
    '..kk........kk..',
    '................',
    '................',
  ],
  { s: SILVER, P: PAPER, I: ICE, k: STEEL_DARK, b: BLUE, g: STEEL },
);

// ════════════════════════════════════════════════════════════════
// 11. lamp_floor — floor lamp with warm glow head, 16x48, 1x1
//     Gold shade with glowing bottom rim + light spill, steel
//     pole (lit left), round dark base.
// ════════════════════════════════════════════════════════════════
const LAMP_FLOOR = (() => {
  const rows: string[] = [];
  rows.push(rep('.', 16));
  rows.push(rep('.', 16));
  rows.push(rep('.', 16));
  rows.push('......yyyy......');
  rows.push('.....yGGGGy.....');
  rows.push('....yGGGGGGy....');
  rows.push('...yGGGGGGGGy...');
  rows.push('..yGGGGGGGGGGy..');
  rows.push('..yLLLLLLLLLLy..');
  rows.push('...LLLLLLLLLL...');
  // pole r10-42
  for (let r = 10; r <= 42; r++) rows.push('.......pk.......');
  // base
  rows.push('......kkkk......');
  rows.push('....kkkkkkkk....');
  rows.push('...oooooooooo...');
  rows.push(rep('.', 16));
  rows.push(rep('.', 16));
  return fromAscii(rows, {
    y: GOLD_DARK,
    G: GOLD,
    L: GOLD_LIGHT,
    p: STEEL_LIGHT,
    k: STEEL,
    o: IRON_DARK,
  });
})();

// ════════════════════════════════════════════════════════════════
// 12. plant_cactus — small potted cactus, 16x16, on-surface
//     Leaf-green body with dark ridge, one arm, red flower on top,
//     terracotta pot like PLANT_SPRITE.
// ════════════════════════════════════════════════════════════════
const PLANT_CACTUS = fromAscii(
  [
    '.......r........',
    '......GGGG......',
    '......GDGG......',
    '..GG..GDGG......',
    '..GG..GDGG......',
    '..GGGGGDGG.GG...',
    '......GDGG.GG...',
    '......GDGGGGG...',
    '......GDGG......',
    '......GGGG......',
    '....qqqqqqqq....',
    '...qppppppppq...',
    '...qppppppppq...',
    '....qppppppq....',
    '....qqqqqqqq....',
    '................',
  ],
  { G: LEAF, D: LEAF_DARK, r: RED, q: CLAY_DARK, p: CLAY },
);

// ════════════════════════════════════════════════════════════════
// 13. corkboard — cork board with colorful post-its, 32x32, wall
//     Wood frame, speckled cork surface, pinned post-it notes with
//     tiny scribbles (paper / gold / sky / green).
// ════════════════════════════════════════════════════════════════
const CORKBOARD = (() => {
  const W = 32;
  const grid: string[][] = Array.from({ length: 32 }, () => new Array<string>(W).fill('.'));
  // frame rows 1-26
  for (let c = 1; c <= 30; c++) {
    grid[1][c] = 'f';
    grid[26][c] = 'f';
  }
  for (let r = 2; r <= 25; r++) {
    grid[r][1] = 'f';
    grid[r][30] = 'f';
    // cork with deterministic speckle
    for (let c = 2; c <= 29; c++) {
      grid[r][c] = (r * 13 + c * 7) % 11 < 2 ? 'l' : 'k';
    }
  }
  // dark inner frame shadow (top + left, light from top-left means
  // the recessed cork is shadowed under the top frame edge)
  for (let c = 2; c <= 29; c++) grid[2][c] = 'd';
  for (let r = 2; r <= 25; r++) grid[r][2] = 'd';
  // post-it helper: color block + red pin at top-center
  const note = (r0: number, c0: number, size: number, ch: string) => {
    for (let r = r0; r < r0 + size; r++) {
      for (let c = c0; c < c0 + size; c++) grid[r][c] = ch;
    }
    grid[r0][c0 + (size >> 1)] = 'r';
  };
  note(5, 5, 5, 'w');
  note(6, 13, 5, 'y');
  note(4, 21, 5, 's');
  note(14, 7, 5, 'g');
  note(15, 16, 5, 'w');
  note(13, 24, 4, 'y');
  // tiny ink scribbles on some notes
  for (const c of [6, 7, 8]) grid[7][c] = 'n';
  for (const c of [6, 7]) grid[8][c] = 'n';
  for (const c of [14, 15, 16]) grid[8][c] = 'n';
  for (const c of [22, 23, 24]) grid[6][c] = 'n';
  for (const c of [17, 18, 19]) grid[17][c] = 'n';
  return fromAscii(
    grid.map((r) => r.join('')),
    {
      f: WOOD,
      d: WOOD_DARK,
      k: WOOD_SURFACE,
      l: WOOD_LIGHT,
      w: PAPER,
      y: GOLD_LIGHT,
      s: SKY,
      g: GREEN,
      r: RED,
      n: IRON_DARK,
    },
  );
})();

// ════════════════════════════════════════════════════════════════
// 14. wall_clock — round wall clock, 16x16, wall item
//     Iron ring, paper face, ink ticks + hands, red second hand.
// ════════════════════════════════════════════════════════════════
const WALL_CLOCK = fromAscii(
  [
    '................',
    '.....oooooo.....',
    '...oowwwwwwoo...',
    '..owwwwkkwwwwo..',
    '.owwwwwwwwwwwwo.',
    '.owwwwwkwwwwwwo.',
    '.owwwwwkwwwwwwo.',
    '.okwwwwkkkwwwko.',
    '.owwwwwrwwwwwwo.',
    '.owwwwrwwwwwwwo.',
    '..owwwwwwwwwwo..',
    '..owwwwkkwwwwo..',
    '...oowwwwwwoo...',
    '.....oooooo.....',
    '................',
    '................',
  ],
  { o: IRON, w: PAPER, k: INK, r: RED },
);

// ════════════════════════════════════════════════════════════════
// 15. arcade_machine — retro arcade cabinet, 16x48, 1x1
//     Gold marquee with red lettering, red side panels, blue
//     screen with invader rows, control deck with joystick +
//     buttons, coin door, dark kick plate and feet.
// ════════════════════════════════════════════════════════════════
const ARCADE_MACHINE = (() => {
  const rows: string[] = [];
  const side = (inner: string) => 'oR' + inner + 'Ro';
  // top edge
  rows.push('.' + rep('o', 14) + '.');
  // marquee
  rows.push('o' + rep('Y', 14) + 'o');
  rows.push('o' + 'YRRYYRYYRYYRRY' + 'o');
  rows.push('o' + rep('Y', 14) + 'o');
  rows.push(rep('o', 16));
  // screen block r5-15
  rows.push(side(rep('z', 12)));
  rows.push(side('zWWccccccccz')); // score digits top-left
  rows.push(side('zcGcGcGcGccz')); // invader row
  rows.push(side('z' + rep('c', 10) + 'z'));
  rows.push(side('zccGcGcGcGcz')); // invader row (offset)
  rows.push(side('z' + rep('c', 10) + 'z'));
  rows.push(side('zccccccWcccz')); // bullet
  rows.push(side('z' + rep('c', 10) + 'z'));
  rows.push(side('z' + rep('c', 10) + 'z'));
  rows.push(side('zccccWWccccz')); // player ship
  rows.push(side(rep('z', 12)));
  rows.push(rep('o', 16));
  // control deck r17-19 (joystick ball + two buttons)
  rows.push(side(rep('k', 12)));
  rows.push(side('kkRkkkGYkkkk'));
  rows.push(side(rep('k', 12)));
  rows.push(rep('o', 16));
  // body r21-42 with sticker + coin door + kick plate
  for (let r = 21; r <= 42; r++) {
    if (r === 24)
      rows.push(side('kkkGGkkYYkkk')); // decal
    else if (r === 25) rows.push(side('kkkGGkkYYkkk'));
    else if (r === 30 || r === 33)
      rows.push(side('kkkggggggkkk')); // coin door frame
    else if (r === 31 || r === 32)
      rows.push(side('kkkgddddgkkk')); // coin slots
    else if (r >= 39)
      rows.push(side(rep('d', 12))); // kick plate
    else rows.push(side(rep('k', 12)));
  }
  // bottom edge + feet
  rows.push('.' + rep('o', 14) + '.');
  rows.push('..oo........oo..');
  rows.push('..oo........oo..');
  rows.push(rep('.', 16));
  rows.push(rep('.', 16));
  return fromAscii(rows, {
    o: INK,
    Y: GOLD,
    R: RED,
    z: SCREEN_SHADOW,
    c: SCREEN_BLUE,
    G: LED_GREEN,
    W: PAPER,
    k: IRON_DARK,
    g: STEEL,
    d: IRON,
  });
})();

// ════════════════════════════════════════════════════════════════
// Export + validation
// ════════════════════════════════════════════════════════════════

export const SPRITES2: GeneratedSprite[] = [
  {
    id: 'desk_standing',
    name: 'DESK_STANDING',
    label: 'Standing Desk',
    widthPx: 32,
    heightPx: 32,
    footprintW: 2,
    footprintH: 1,
    sprite: DESK_STANDING,
  },
  {
    id: 'desk_double',
    name: 'DESK_DOUBLE',
    label: 'Double Desk',
    widthPx: 48,
    heightPx: 32,
    footprintW: 3,
    footprintH: 2,
    sprite: DESK_DOUBLE,
  },
  {
    id: 'chair_office',
    name: 'CHAIR_OFFICE',
    label: 'Office Chair',
    widthPx: 16,
    heightPx: 32,
    footprintW: 1,
    footprintH: 1,
    sprite: CHAIR_OFFICE,
  },
  {
    id: 'stool',
    name: 'STOOL',
    label: 'Stool',
    widthPx: 16,
    heightPx: 16,
    footprintW: 1,
    footprintH: 1,
    sprite: STOOL,
  },
  {
    id: 'couch',
    name: 'COUCH',
    label: 'Couch',
    widthPx: 32,
    heightPx: 32,
    footprintW: 2,
    footprintH: 1,
    sprite: COUCH,
  },
  {
    id: 'coffee_table',
    name: 'COFFEE_TABLE',
    label: 'Coffee Table',
    widthPx: 32,
    heightPx: 16,
    footprintW: 2,
    footprintH: 1,
    sprite: COFFEE_TABLE,
  },
  {
    id: 'bookshelf_tall',
    name: 'BOOKSHELF_TALL',
    label: 'Tall Bookshelf',
    widthPx: 16,
    heightPx: 48,
    footprintW: 1,
    footprintH: 1,
    sprite: BOOKSHELF_TALL,
  },
  {
    id: 'filing_cabinet',
    name: 'FILING_CABINET',
    label: 'Filing Cabinet',
    widthPx: 16,
    heightPx: 32,
    footprintW: 1,
    footprintH: 1,
    sprite: FILING_CABINET,
  },
  {
    id: 'water_dispenser',
    name: 'WATER_DISPENSER',
    label: 'Water Dispenser',
    widthPx: 16,
    heightPx: 32,
    footprintW: 1,
    footprintH: 1,
    sprite: WATER_DISPENSER,
  },
  {
    id: 'mini_fridge',
    name: 'MINI_FRIDGE',
    label: 'Mini Fridge',
    widthPx: 16,
    heightPx: 32,
    footprintW: 1,
    footprintH: 1,
    sprite: MINI_FRIDGE,
  },
  {
    id: 'lamp_floor',
    name: 'LAMP_FLOOR',
    label: 'Floor Lamp',
    widthPx: 16,
    heightPx: 48,
    footprintW: 1,
    footprintH: 1,
    sprite: LAMP_FLOOR,
  },
  {
    id: 'plant_cactus',
    name: 'PLANT_CACTUS',
    label: 'Cactus',
    widthPx: 16,
    heightPx: 16,
    footprintW: 1,
    footprintH: 1,
    sprite: PLANT_CACTUS,
  },
  {
    id: 'corkboard',
    name: 'CORKBOARD',
    label: 'Corkboard',
    widthPx: 32,
    heightPx: 32,
    footprintW: 2,
    footprintH: 1,
    sprite: CORKBOARD,
  },
  {
    id: 'wall_clock',
    name: 'WALL_CLOCK',
    label: 'Wall Clock',
    widthPx: 16,
    heightPx: 16,
    footprintW: 1,
    footprintH: 1,
    sprite: WALL_CLOCK,
  },
  {
    id: 'arcade_machine',
    name: 'ARCADE_MACHINE',
    label: 'Arcade Machine',
    widthPx: 16,
    heightPx: 48,
    footprintW: 1,
    footprintH: 1,
    sprite: ARCADE_MACHINE,
  },
];

validateSprites(SPRITES2);

// palette-only check: every opaque pixel must use a house-palette color
const allowed = new Set(ALL_COLORS);
for (const s of SPRITES2) {
  s.sprite.forEach((row, r) => {
    row.forEach((hex, c) => {
      if (hex && !allowed.has(hex)) {
        throw new Error(`${s.id}: non-palette color ${hex} at row ${r} col ${c}`);
      }
    });
  });
}
