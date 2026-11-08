# Cinematic reef and bomb terrain response

Preserves original bg.webp, all original fish/cannon images, responsive shell, account gate, Telegram integration and PWA. No engine, Worker, database or account edits.

- Successful bomb captures (normal bullet and existing laser paths) emit a localized sand plume, debris, thin shockwave and temporary dark blast scar. No effect on failed captures, ordinary hits, collision, targets or payouts. Scar expires after six seconds; plume after 1.8 seconds; debris within 2.2 seconds. Hard bounds: six scars and 96 debris particles. Reduced motion shows the fading scar only.
- Original detailed laser gains fixed-count branching electric filaments and a calmer intensity envelope. Original cannon art gains chamber rings/status cells while laser or a visual mode is active. No generated replacement assets or expensive blur filters.
- ARC and PLASMA are explicitly labeled VISUAL MODES, not stronger weapons: six seconds of styled paid bullets, then twelve seconds cooldown. Shared cooldown prevents stacking; existing laser takes precedence. Already fired bullets retain their style until their normal hit/refund/expiry. Costs, total damage, capture probability, targeting, jackpot feed and refund basis are identical. No free beam activation, freezing, chain damage or multi-target mechanics were added.
- New presentation code does not consume gameplay randomness. Restrained wakes appear behind existing boss/special sprites; caustics are less overpowering. Account-sheet colors/focus treatment and HUD numeral contrast are polished without moving existing controls. Static cache advances tg17 → tg18.

## Verification

`node --test tools/reef-fx.test.cjs` — lifecycle/bounds/reduced-motion/render smoke and source/economic regression. The baseline fixture captures relevant functions from 155ebb54.

`npm test --prefix worker` — existing 16 tests; no live integration/account mutation tests.

`node --check game.js && node --check reef-fx.js && git diff --check`

No frontend build command exists: static HTML/JS app. Browser screenshots, phone performance and touch QA remain required before merge. No production deployment is part of this change.
