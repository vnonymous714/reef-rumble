'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, loadImage, GlobalFonts } = require('/tmp/rr-napi/node_modules/@napi-rs/canvas');

const root = path.resolve(__dirname, '..');
const M = require(path.join(root, 'bonus-choice-math.js'));

const FROZEN_WEDGES = [
  [1, 28], [1.5, 22], [2, 18], [2.5, 12], [3, 9], [4, 5], [5, 3], [8, 2], [10, 1]
];

test('choice wheel weights and EV are unchanged', () => {
  assert.deepEqual(M.CHOICE_WHEEL.map(([m, w]) => [m, w]), FROZEN_WEDGES);
  assert.equal(M.CHOICE_WHEEL.length, 9);
  assert.ok(Math.abs(M.choiceWheelEV() - 2.15) < 1e-9);
});

test('target rotation lands the server wedge under the pointer', () => {
  const n = M.CHOICE_WHEEL.length;
  for (const [mult] of M.CHOICE_WHEEL) {
    const idx = M.wheelIndexForMult(mult);
    const target = M.wheelTargetRotation(idx, n);
    const landed = M.wedgeAtPointer(target, n);
    assert.equal(landed, idx, 'mult ' + mult);
    assert.equal(M.CHOICE_WHEEL[landed][0], mult);
    // Spin end settles exactly on the target (wobble is 0 at t=1)
    assert.equal(M.wheelSpinAngle(1, target), target);
    assert.equal(M.wedgeAtPointer(M.wheelSpinAngle(1, target), n), idx);
  }
});

test('settle wobble stays on the already-chosen wedge', () => {
  const n = M.CHOICE_WHEEL.length;
  for (let idx = 0; idx < n; idx++) {
    const target = M.wheelTargetRotation(idx, n);
    for (let t = 880; t <= 1000; t += 5) {
      const ang = M.wheelSpinAngle(t / 1000, target);
      assert.equal(M.wedgeAtPointer(ang, n), idx, 'idx ' + idx + ' t=' + t / 1000);
    }
  }
});

test('wobble is not jackpot-seeking', () => {
  // A low-value result must never pass through the 10x wedge during the settle
  const n = M.CHOICE_WHEEL.length;
  const low = M.wheelIndexForMult(1);
  const jack = M.wheelIndexForMult(10);
  assert.notEqual(low, jack);
  const target = M.wheelTargetRotation(low, n);
  for (let t = 0; t <= 100; t++) {
    const ang = M.wheelSpinAngle(t / 100, target);
    if (t / 100 >= M.WHEEL_WOBBLE_START) {
      assert.equal(M.wedgeAtPointer(ang, n), low);
      assert.notEqual(M.wedgeAtPointer(ang, n), jack);
    }
  }
});

function loadArt() {
  const daily = readFileSync(path.join(root, 'daily-wheel-art.js'), 'utf8');
  const art = readFileSync(path.join(root, 'bonus-choice-art.js'), 'utf8');
  const sandbox = { globalThis: {}, Math, console, Image: class Image {}, ReefBonusChoice: M };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(daily, sandbox);
  vm.runInNewContext(art, sandbox);
  return sandbox.ReefBonusChoiceArt;
}


async function artWithAssets() {
  GlobalFonts.registerFromPath(path.join(root, 'assets/fonts/Cinzel-Black.ttf'), 'CinzelBlack');
  GlobalFonts.registerFromPath(path.join(root, 'assets/fonts/Cinzel-Bold.ttf'), 'CinzelBold');
  const art = loadArt();
  const names = {
    bg: 'bonus-bg.webp',
    rim: 'bonus-wheel-rim.webp',
    face: 'bonus-wheel-face.webp',
    pointer: 'bonus-wheel-pointer.webp',
    hub: 'bonus-wheel-hub.webp',
    plaque: 'bonus-wheel-plaque.webp',
    rimSm: 'bonus-wheel-rim-sm.webp',
    faceSm: 'bonus-wheel-face-sm.webp',
    num1_0: 'bonus-wheel-num-1.0.webp',
    num1_5: 'bonus-wheel-num-1.5.webp',
    num2_0: 'bonus-wheel-num-2.0.webp',
    num2_5: 'bonus-wheel-num-2.5.webp',
    num3_0: 'bonus-wheel-num-3.0.webp',
    num4_0: 'bonus-wheel-num-4.0.webp',
    num5_0: 'bonus-wheel-num-5.0.webp',
    num8_0: 'bonus-wheel-num-8.0.webp',
    num10: 'bonus-wheel-num-10.webp',
    num1: 'bonus-wheel-num-1.webp',
    num2: 'bonus-wheel-num-2.webp',
    num3: 'bonus-wheel-num-3.webp',
    num4: 'bonus-wheel-num-4.webp',
    num5: 'bonus-wheel-num-5.webp',
    num8: 'bonus-wheel-num-8.webp'
  };
  const images = {};
  for (const [k, file] of Object.entries(names)) {
    images[k] = await loadImage(path.join(root, 'assets', file));
  }
  art.setImages(images);
  return art;
}

function numeralSize(art, mult) {
  const t = art.fmtFaceLabel(mult);
  const core = String(t).replace(/\u00d7/g, '').replace(/[xX]$/, '');
  const key = core.indexOf('.') === -1 ? 'num' + core : 'num' + core.replace('.', '_');
  const im = art.getImage(key);
  if (im && im.width) return { w: im.width, h: im.height, im };
  const fallback = art.getImage(key + '_0');
  if (fallback && fallback.width) return { w: fallback.width, h: fallback.height, im: fallback };
  return { w: 44, h: 24, im: null };
}

test('stake wheel scene paints and winner readout is present', async () => {
  const art = await artWithAssets();
  const W = 740, H = 360;
  const before = createCanvas(W, H);
  art.paintStakeWheelScene(before.getContext('2d'), W, H, {
    stake: 100, rotation: 0, buttonText: 'SPIN', paintButton: true
  });
  const buf = before.toBuffer('image/png');
  assert.ok(buf.length > 8000);

  const target = M.wheelTargetRotation(M.wheelIndexForMult(5), 9);
  const win = createCanvas(W, H);
  art.paintStakeWheelScene(win.getContext('2d'), W, H, {
    stake: 100,
    rotation: target,
    winIndex: M.wheelIndexForMult(5),
    winMult: 5,
    winPay: 500,
    reveal: 1,
    buttonText: 'COLLECT',
    paintButton: true
  });
  const winBuf = win.toBuffer('image/png');
  assert.ok(winBuf.length > 8000);
  // Before and win frames must differ (winner banner / glow)
  assert.notEqual(buf.compare(winBuf), 0);
});

test('numeral boxes stay inside their wedges with padding at every size', async () => {
  const art = await artWithAssets();
  const sizes = [[740, 360], [844, 390], [985, 400]];
  const n = M.CHOICE_WHEEL.length;
  const rotations = [];
  for (let d = 0; d < 360; d += 10) rotations.push(d);
  rotations.push(M.wheelTargetRotation(M.wheelIndexForMult(5), n));
  for (const [W, H] of sizes) {
    const L = art.layoutStakeWheel(W, H);
    const frac = art.sectorCentroidFrac(n);
    assert.ok(frac >= 0.62 && frac <= 0.68, 'centroid frac ' + frac);
    const layout = art.layoutWheelNumerals({
      faceR: L.faceR,
      hubR: L.hubR,
      n,
      sectors: M.CHOICE_WHEEL,
      fmt: art.fmtFaceLabel,
      getSize: (mult) => numeralSize(art, mult)
    });
    assert.equal(layout.length, n);
    for (const lab of layout) {
      assert.ok(Math.abs(lab.frac - frac) < 1e-9);
      assert.ok(lab.dw > 8 && lab.dh > 8, lab.text + ' collapsed');
      // Clear padding budget is baked into rIn/rOut/padRay
      assert.ok(lab.padRay >= 3.5);
    }
    for (const rot of rotations) {
      const failures = art.numeralsClearDividers(layout, rot);
      assert.equal(failures.length, 0, JSON.stringify(failures) + ' at ' + W + 'x' + H + ' rot=' + rot);
    }
  }
});
