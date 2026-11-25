/* Server spawn mix (play credits only). The engine table's species, art and
 * multipliers are unchanged; only how OFTEN each species appears. "Warm Tide"
 * leans the reef toward small and medium fish so hits land more often
 * (expected shots per catch = multiplier / return), with fewer rare giants.
 * Specials (bomb, eel, crab chest, prism ray, relic) keep their weights.
 * Bosses are timed, not weighted, and are unaffected. */
import E from "../../engine.js";
export const WARM_TIDE_WEIGHTS = Object.freeze({
  minnow: 42, guppy: 34, darter: 25, pebble: 18, tang: 12, lantern: 8,
  jelly: 6, turtle: 4, ray: 3.2, sword: 2.5, shark: 2, koi: 1.8, whale: 1,
});
export const ACTIVE_WEIGHTS = WARM_TIDE_WEIGHTS;
export function spawnTable(weights = ACTIVE_WEIGHTS) {
  return E.spawnTable().map((def) =>
    weights && Object.hasOwn(weights, def.id) ? { ...def, w: weights[def.id] } : def);
}
