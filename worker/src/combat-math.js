/* Authoritative candidate combat: truthful HP, locked encounter pricing and
   explicit variance calibration. No client balance/HP/payout input is trusted.
   R is expected released-or-stored prize value per paid shot, not hit frequency. */
export const MAX_AWARD = 40000;
export function profile(tier, baseStake = 10) {
  if (!Number.isInteger(tier) || tier < 1 || tier > 10)
    throw new Error("invalid tier");
  const costFactor = Math.min(2, 1 + (tier - 1) * 0.25),
    healthFactor =
      1 +
      Math.min(
        0.2,
        Math.min(4, tier - 1) * 0.05 + 0.02 * Math.log2(baseStake / 10),
      );
  const packet = Math.max(
    1,
    Math.floor((4 * costFactor) / (1 + Math.min(4, tier - 1) * 0.05) + 1e-9),
  );
  return {
    tier,
    costFactor,
    healthFactor,
    hpUnit: Math.round(100 * healthFactor),
    packet,
    actualPacketDamage: Math.round(100 * healthFactor) * packet,
  };
}
export function engage(fish, baseStake, tier) {
  if (fish.lock) return fish;
  if (!Number.isSafeInteger(baseStake) || baseStake < 10 || baseStake > 1000)
    throw new Error("invalid base stake");
  const p = profile(tier, baseStake),
    stake = Math.round(baseStake * p.costFactor);
  if (stake * fish.mult > MAX_AWARD)
    throw new Error("lower stake: prize would exceed cap");
  return {
    ...fish,
    lock: { stake, tier, ...p },
    hp: fish.mult * p.hpUnit,
    maxHp: fish.mult * p.hpUnit,
    dead: false,
  };
}
export function packet(target, weight, style, fishReturn, rng) {
  if (
    !target.lock ||
    target.dead ||
    !(weight > 0 && weight <= 1) ||
    ![0.91, 0.87].includes(fishReturn)
  )
    throw new Error("invalid packet");
  const { hpUnit, packet: normal } = target.lock;
  if (target.hp % hpUnit !== 0) throw new Error("invalid hp quantum");
  const remaining = target.hp / hpUnit,
    k = Math.min(remaining, normal * (style === "plasma" ? 2 : 1));
  const probability = (fishReturn * weight) / k;
  const roll = rng();
  if (!(roll >= 0 && roll < 1)) throw new Error("invalid rng");
  const damage = roll < probability ? k * hpUnit : 0;
  const next = {
    ...target,
    hp: target.hp - damage,
    dead: target.hp - damage === 0,
  };
  return {
    target: next,
    damage,
    probability,
    prize: next.dead ? target.mult * target.lock.stake : 0,
  };
}
export function attack(fishes, id, baseStake, tier, style, fishReturn, rng) {
  if (!["normal", "arc", "plasma", "laser"].includes(style))
    throw new Error("invalid style");
  const primary = fishes.find((f) => f.id === id && !f.dead);
  if (!primary) throw new Error("unavailable target");
  const engaged = engage(primary, baseStake, tier),
    { stake, tier: lockedTier } = engaged.lock;
  let list = fishes.map((f) => (f.id === id ? engaged : f)),
    targets = [engaged],
    budget = engaged.mult * stake;
  const area =
    style === "arc" ||
    style === "laser" ||
    ["bomb", "chain"].includes(engaged.kind);
  if (area)
    for (const f of list) {
      if (targets.length >= 3) break;
      if (f.id === id || f.dead) continue;
      if (f.lock && (f.lock.stake !== stake || f.lock.tier !== lockedTier))
        continue;
      if (budget + f.mult * stake > MAX_AWARD) continue;
      // Primary's locked tier/stake govern all children, not the newly selected UI bet.
      const child = f.lock
        ? f
        : {
            ...f,
            lock: { ...engaged.lock },
            hp: f.mult * engaged.lock.hpUnit,
            maxHp: f.mult * engaged.lock.hpUnit,
            dead: false,
          };
      targets.push(child);
      budget += f.mult * stake;
    }
  const updates = targets.map((t) =>
    packet(t, 1 / targets.length, style, fishReturn, rng),
  );
  const byId = new Map(updates.map((u) => [u.target.id, u.target]));
  list = list.map((f) => byId.get(f.id) || f);
  const payout = updates.reduce((s, u) => s + u.prize, 0);
  if (payout > MAX_AWARD) throw new Error("award budget invariant");
  return {
    fishes: list,
    cost: stake,
    payout,
    updates,
    lockedStake: stake,
    lockedTier,
  };
}
export function potential(fishes) {
  return fishes.reduce(
    (sum, f) =>
      sum +
      (f.lock && !f.dead
        ? ((f.maxHp - f.hp) * f.lock.stake) / f.lock.hpUnit
        : 0),
    0,
  );
}
