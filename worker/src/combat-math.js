/* Authoritative candidate combat: truthful HP, locked encounter pricing and
   explicit variance calibration. No client balance/HP/payout input is trusted.
   R is expected released-or-stored prize value per paid shot, not hit frequency. */
export const MAX_AWARD = 40000;
export const MIN_BASE_STAKE = 10;
export const MAX_BASE_STAKE = 500;
/** Super-linear payout factor vs locked base stake. Keeps EV = targetR * cost < 1. */
export function stakePayoutBonus(baseStake, fishReturn) {
  if (![0.91, 0.87].includes(fishReturn)) throw new Error("invalid return");
  if (!Number.isSafeInteger(baseStake) || baseStake < MIN_BASE_STAKE || baseStake > MAX_BASE_STAKE)
    throw new Error("invalid base stake");
  const maxR = fishReturn === 0.91 ? 0.98 : 0.94;
  const t = Math.log(baseStake / MIN_BASE_STAKE) / Math.log(MAX_BASE_STAKE / MIN_BASE_STAKE);
  const targetR = fishReturn + (maxR - fishReturn) * Math.min(1, Math.max(0, t));
  return targetR / fishReturn;
}
export function lockedPrize(mult, lock) {
  const pay = Math.round(mult * lock.stake * lock.payoutFactor);
  if (!Number.isSafeInteger(pay) || pay < 0) throw new Error("invalid prize");
  return Math.min(MAX_AWARD, pay);
}
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
export function engage(fish, baseStake, tier, fishReturn = 0.91) {
  if (fish.lock) return fish;
  if (!Number.isSafeInteger(baseStake) || baseStake < MIN_BASE_STAKE || baseStake > MAX_BASE_STAKE)
    throw new Error("invalid base stake");
  const p = profile(tier, baseStake),
    stake = Math.round(baseStake * p.costFactor),
    payoutFactor = stakePayoutBonus(baseStake, fishReturn);
  // Refuse rather than clip: include LV cost and bigger-bullet payout bonus.
  if (Math.round(stake * fish.mult * payoutFactor) > MAX_AWARD)
    throw new Error("lower stake: prize would exceed cap");
  return {
    ...fish,
    lock: { stake, tier, baseStake, payoutFactor, fishReturn, ...p },
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
    prize: next.dead ? lockedPrize(target.mult, target.lock) : 0,
  };
}
export function attack(fishes, id, baseStake, tier, style, fishReturn, rng) {
  if (!["normal", "arc", "plasma", "laser"].includes(style))
    throw new Error("invalid style");
  const primary = fishes.find((f) => f.id === id && !f.dead);
  if (!primary) throw new Error("unavailable target");
  const engaged = engage(primary, baseStake, tier, fishReturn),
    { stake, tier: lockedTier } = engaged.lock;
  let list = fishes.map((f) => (f.id === id ? engaged : f)),
    targets = [engaged],
    budget = lockedPrize(engaged.mult, engaged.lock);
  const area =
    style === "arc" ||
    style === "laser" ||
    ["bomb", "chain", "drill"].includes(engaged.kind);
  if (area)
    for (const f of list) {
      if (targets.length >= (engaged.kind === "drill" ? 8 : 3)) break;
      if (f.id === id || f.dead) continue;
      if (f.lock && (f.lock.stake !== stake || f.lock.tier !== lockedTier))
        continue;
      const child = f.lock
        ? f
        : {
            ...f,
            lock: { ...engaged.lock },
            hp: f.mult * engaged.lock.hpUnit,
            maxHp: f.mult * engaged.lock.hpUnit,
            dead: false,
          };
      const childPay = lockedPrize(f.mult, child.lock);
      if (budget + childPay > MAX_AWARD) continue;
      targets.push(child);
      budget += childPay;
    }
  let updates = targets.map((t) =>
    packet(t, 1 / targets.length, style, fishReturn, rng),
  );
  const byId = new Map(updates.map((u) => [u.target.id, u.target]));
  list = list.map((f) => byId.get(f.id) || f);
  const payout = updates.reduce((s, u) => s + u.prize, 0);
  if (payout > MAX_AWARD) throw new Error("award budget invariant");
  const spent = (engaged.spent || 0) + stake;
  list = list.map((f) => (f.id === id ? { ...f, spent } : f));
  updates = updates.map((u) =>
    u.target.id === id ? { ...u, target: { ...u.target, spent }, spent } : { ...u, spent: u.target.spent || 0 },
  );
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
        ? ((f.maxHp - f.hp) * lockedPrize(f.mult, f.lock)) / f.maxHp
        : 0),
    0,
  );
}

// Joint fish + jackpot award never exceeds MAX_AWARD. Calibrate against the
// full (at most 8) capture outcomes, not the observed winning outcome: this
// retains 1% expected jackpot value without clipping wins after the draw.
export function jackpotAward(updates,style,stake,meter,roll){
 const chances=updates.map(u=>({p:u.target.hp+u.damage<=u.target.lock.packet*(style==='plasma'?2:1)*u.target.lock.hpUnit?u.probability:0,pay:lockedPrize(u.target.mult,u.target.lock)}));
 let expected=0;
 for(let mask=0;mask<(1<<chances.length);mask++){let probability=1,prize=0;chances.forEach((c,i)=>{const win=!!(mask&(1<<i));probability*=win?c.p:1-c.p;if(win)prize+=c.pay;});expected+=probability*Math.max(0,Math.min(meter,MAX_AWARD-prize));}
 const probability=expected>0?.01*stake/expected:0;
 if(probability>1)throw new Error('jackpot calibration unavailable');
 const paid=updates.reduce((sum,u)=>sum+u.prize,0),award=Math.max(0,Math.min(meter,MAX_AWARD-paid));
 return roll<probability?award:0;
}
