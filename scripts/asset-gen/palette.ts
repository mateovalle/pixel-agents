/**
 * palette.ts — Curated house palette for Pixel Agents sprite generation.
 *
 * Every color below was extracted from the hand-authored furniture/character
 * sprites in webview-ui/src/office/sprites/spriteData.ts. New generated sprites
 * must use ONLY these colors so they sit next to the existing furniture without
 * looking foreign.
 *
 * Observed style rules (from studying spriteData.ts):
 *  - 1px outline in a DARKER SHADE OF THE MATERIAL (not pure black), e.g. wood
 *    edges use WOOD on a WOOD_SHADOW corner, monitors use IRON frames.
 *  - Light source top-left: top/left rows get the light tone, bottom/right the dark.
 *  - 2-tone shading per material (base + light or base + dark), 3-6 colors per sprite.
 *  - Top-down-ish 3/4 perspective: tops visible, short front faces, legs/feet
 *    as 2px dark stubs under the corners.
 */

// ── Wood tones (desks, bookshelf, chair) ────────────────────────
export const WOOD_SHADOW = '#5C3D0A'; // deepest wood, chair back
export const WOOD_DARK = '#6B4E0A'; // wood outline/edge, shelf interior, stems
export const WOOD = '#8B6914'; // wood frame/edge base
export const WOOD_LIGHT = '#A07828'; // lit wood
export const WOOD_SURFACE = '#B8922E'; // desk top surface

// ── Metals / greys (PC, cooler, lamp, whiteboard frame) ─────────
export const INK = '#222222'; // near-black (shoes, darkest accents)
export const IRON_DARK = '#333333';
export const IRON = '#444444'; // monitor stand
export const STEEL_DARK = '#555555'; // monitor frame
export const STEEL = '#666666'; // cooler base
export const STEEL_LIGHT = '#888888'; // lamp arm
export const SILVER = '#999999'; // cooler frame
export const SILVER_LIGHT = '#AAAAAA'; // whiteboard frame

// ── Greens (plants, LEDs, waiting check) ────────────────────────
export const LEAF_DARK = '#2D6B27';
export const LEAF = '#3D8B37';
export const GREEN = '#44AA66'; // book spines / soft green accent
export const LED_GREEN = '#44BB66'; // waiting-bubble check green

// ── Blues / screens / water ─────────────────────────────────────
export const SCREEN_SHADOW = '#3A3A5C'; // monitor bezel
export const SCREEN_BLUE = '#6688CC'; // lit screen
export const BLUE = '#4477AA'; // book spines, marker blue, deep water
export const SKY = '#88BBDD'; // cooler water, light water
export const ICE = '#CCDDEE'; // glass / bottle white-blue

// ── Fabric / paper whites ───────────────────────────────────────
export const PAPER = '#EEEEFF'; // whiteboard surface, bubble fill
export const SLATE = '#555566'; // bubble border blue-grey

// ── Accents ─────────────────────────────────────────────────────
export const RED = '#CC4444'; // books, markers, gamer accents
export const AMBER = '#CCA700'; // permission-bubble amber
export const GOLD_DARK = '#CCAA33'; // book spine yellow / dark gold
export const GOLD = '#FFD700'; // character hair gold
export const GOLD_LIGHT = '#FFEE88'; // lamp glow light
export const ORANGE = '#FF8844'; // character shirt orange (fish!)

// ── Terracotta (plant pot) ──────────────────────────────────────
export const CLAY_DARK = '#8B4422';
export const CLAY = '#B85C3A';

/** Palette grouped by material family, for docs/tooling. */
export const PALETTE_GROUPS: Record<string, Record<string, string>> = {
  wood: { WOOD_SHADOW, WOOD_DARK, WOOD, WOOD_LIGHT, WOOD_SURFACE },
  metal: { INK, IRON_DARK, IRON, STEEL_DARK, STEEL, STEEL_LIGHT, SILVER, SILVER_LIGHT },
  green: { LEAF_DARK, LEAF, GREEN, LED_GREEN },
  blue: { SCREEN_SHADOW, SCREEN_BLUE, BLUE, SKY, ICE },
  fabric: { PAPER, SLATE },
  accent: { RED, AMBER, GOLD_DARK, GOLD, GOLD_LIGHT, ORANGE },
  clay: { CLAY_DARK, CLAY },
};

/** Flat list of every allowed hex color. */
export const ALL_COLORS: string[] = Object.values(PALETTE_GROUPS).flatMap((g) => Object.values(g));
