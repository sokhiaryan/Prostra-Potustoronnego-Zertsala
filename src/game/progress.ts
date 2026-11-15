// Progress through the game: which worlds exist, which are open, how many motes have
// been collected and how much of the codex that has revealed. Pure functions over the
// saved mote bitmasks.
import { FRACTALS } from '../app/fractals';
import { PRESETS } from '../app/presets';
import { NOTES } from '../explore/notes';
import { MOTES_PER_WORLD } from './motes';

export interface World {
  /** Index into PRESETS. */
  preset: number;
  id: string;
  /** Total motes needed before the world opens. */
  unlockAt: number;
}

export const WORLDS: World[] = PRESETS.flatMap((p, i) =>
  FRACTALS[p.fractal].flat ? [] : [{ preset: i, id: p.id, unlockAt: p.unlockAt ?? 0 }],
);

export const TOTAL_MOTES = WORLDS.length * MOTES_PER_WORLD;
const WORLD_MASK = (1 << MOTES_PER_WORLD) - 1;
/** Motes in these tiers count as "deep" (the last three). */
const DEEP_MASK = WORLD_MASK & ~((1 << (MOTES_PER_WORLD - 3)) - 1);
/** Share of a fractal's motes that reveals all of its codex facts. */
const FACTS_AT = 0.6;

type Motes = Readonly<Record<string, number>>;

function bitCount(v: number): number {
  let n = 0;
  for (let b = v & WORLD_MASK; b; b &= b - 1) n++;
  return n;
}

export const worldMotes = (motes: Motes, id: string): number => bitCount(motes[id] ?? 0);
export const hasMote = (motes: Motes, id: string, index: number): boolean => ((motes[id] ?? 0) & (1 << index)) !== 0;

/** Motes collected in the worlds that exist (stale ids in a saved record do not count). */
export function totalMotes(motes: Motes): number {
  return WORLDS.reduce((sum, w) => sum + worldMotes(motes, w.id), 0);
}

export function isOpen(world: World, motes: Motes): boolean {
  return totalMotes(motes) >= world.unlockAt;
}

export const worldsOpen = (motes: Motes): number => WORLDS.filter((w) => isOpen(w, motes)).length;
export const anyWorldComplete = (motes: Motes): boolean => WORLDS.some((w) => worldMotes(motes, w.id) === MOTES_PER_WORLD);
export const anyDeepMote = (motes: Motes): boolean => WORLDS.some((w) => ((motes[w.id] ?? 0) & DEEP_MASK) !== 0);

/** Record a mote as collected. Returns false if it already was. */
export function collectMote(motes: Record<string, number>, id: string, index: number): boolean {
  if (index < 0 || index >= MOTES_PER_WORLD || hasMote(motes, id, index)) return false;
  motes[id] = (motes[id] ?? 0) | (1 << index);
  return true;
}

/** The world whose shape these parameters are, or -1 for a shape of the player's own. */
export function worldOf(fractal: number, params: ArrayLike<number>): number {
  return WORLDS.findIndex((w) => {
    const p = PRESETS[w.preset];
    return p.fractal === fractal && p.params.every((v, i) => Math.abs(v - params[i]) < 1e-9);
  });
}

/** How many of a fractal's codex facts the collected motes have revealed. */
export function factsRevealed(fractal: number, motes: Motes): number {
  const facts = NOTES[fractal]?.facts.length ?? 0;
  const worlds = WORLDS.filter((w) => PRESETS[w.preset].fractal === fractal);
  if (facts === 0 || worlds.length === 0) return facts;
  const have = worlds.reduce((sum, w) => sum + worldMotes(motes, w.id), 0);
  const needAll = FACTS_AT * worlds.length * MOTES_PER_WORLD;
  return Math.min(facts, Math.floor((have * facts) / needAll + 1e-9));
}

/** Motes still needed in a fractal's worlds before its next fact appears; 0 when all are revealed. */
export function motesToNextFact(fractal: number, motes: Motes): number {
  const facts = NOTES[fractal]?.facts.length ?? 0;
  const worlds = WORLDS.filter((w) => PRESETS[w.preset].fractal === fractal);
  const shown = factsRevealed(fractal, motes);
  if (shown >= facts || worlds.length === 0) return 0;
  const have = worlds.reduce((sum, w) => sum + worldMotes(motes, w.id), 0);
  const need = Math.ceil(((shown + 1) * FACTS_AT * worlds.length * MOTES_PER_WORLD) / facts - 1e-9);
  return Math.max(1, need - have);
}
