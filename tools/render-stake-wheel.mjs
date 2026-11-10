import { createCanvas, loadImage, GlobalFonts } from '/tmp/rr-napi/node_modules/@napi-rs/canvas/index.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const MathBonus = require(path.join(root, 'bonus-choice-math.js'));

function loadArt(file, extras = {}) {
  const code = readFileSync(path.join(root, file), 'utf8');
  const sandbox = { globalThis: {}, Math, console, Image: class Image {}, ...extras };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox);
  return sandbox;
}

const daily = loadArt('daily-wheel-art.js').ReefDailyWheelArt;
GlobalFonts.registerFromPath(path.join(root, 'assets/fonts/Cinzel-Black.ttf'), 'CinzelBlack');
GlobalFonts.registerFromPath(path.join(root, 'assets/fonts/Cinzel-Bold.ttf'), 'CinzelBold');

const choiceArt = loadArt('bonus-choice-art.js', {
  ReefDailyWheelArt: daily,
  ReefBonusChoice: MathBonus
}).ReefBonusChoiceArt;

const bonusBg = await loadImage(path.join(root, 'assets/bonus-bg.webp'));
const images = {
  bg: bonusBg,
  rim: await loadImage(path.join(root, 'assets/bonus-wheel-rim.webp')),
  face: await loadImage(path.join(root, 'assets/bonus-wheel-face.webp')),
  pointer: await loadImage(path.join(root, 'assets/bonus-wheel-pointer.webp')),
  hub: await loadImage(path.join(root, 'assets/bonus-wheel-hub.webp')),
  plaque: await loadImage(path.join(root, 'assets/bonus-wheel-plaque.webp')),
  rimSm: await loadImage(path.join(root, 'assets/bonus-wheel-rim-sm.webp')),
  faceSm: await loadImage(path.join(root, 'assets/bonus-wheel-face-sm.webp')),
  pointerSm: await loadImage(path.join(root, 'assets/bonus-wheel-pointer-sm.webp')),
  hubSm: await loadImage(path.join(root, 'assets/bonus-wheel-hub-sm.webp')),
  plaqueSm: await loadImage(path.join(root, 'assets/bonus-wheel-plaque-sm.webp'))
};
const NUMS = ['1.0','1.5','2.0','2.5','3.0','4.0','5.0','8.0','10'];
for (const k of NUMS) {
  const key = k === '10' ? 'num10' : 'num' + k.replace('.', '_');
  images[key] = await loadImage(path.join(root, `assets/bonus-wheel-num-${k}.webp`));
}
choiceArt.setImages(images);

const SIZES = [
  [985, 400, ''],
  [844, 390, '@844'],
  [740, 360, '@740']
];
mkdirSync('/workspace/shots', { recursive: true });
mkdirSync('/tmp/wheel4-hi', { recursive: true });

function round(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
function plate(g, W, H) {
  round(g, 0, 0, W, H, 16);
  g.save();
  g.clip();
  choiceArt.paintBgPlate(g, W, H);
  g.restore();
  g.strokeStyle = '#c5a45d';
  g.lineWidth = 3;
  round(g, 1.5, 1.5, W - 3, H - 3, 16);
  g.stroke();
}

function downsample(srcPng, destPng, W, H) {
  // Proper Lanczos downsample of the 2x render via Pillow
  execFileSync('python3', [
    path.join(root, 'tools/lanczos-down.py'),
    srcPng, destPng, String(W), String(H)
  ]);
}

function render(W, H, state, name) {
  const scale = 2;
  const canvas = createCanvas(W * scale, H * scale);
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.scale(scale, scale);
  plate(g, W, H);
  g.save();
  round(g, 3, 3, W - 6, H - 6, 14);
  g.clip();
  choiceArt.paintStakeWheelScene(g, W, H, state);
  g.restore();
  g.strokeStyle = '#c5a45d';
  g.lineWidth = 3;
  round(g, 1.5, 1.5, W - 3, H - 3, 16);
  g.stroke();
  const hi = `/tmp/wheel4-hi/${name}@2x.png`;
  writeFileSync(hi, canvas.toBuffer('image/png'));
  const out = `/workspace/shots/${name}`;
  downsample(hi, out, W, H);
  const bytes = readFileSync(out).length;
  console.log(JSON.stringify({ out, bytes, w: W, h: H }));
}

const n = MathBonus.CHOICE_WHEEL.length;
const winIdx = MathBonus.wheelIndexForMult(5);
const winRot = MathBonus.wheelTargetRotation(winIdx, n);

for (const [W, H, tag] of SIZES) {
  const beforeName = tag ? `wheel4-before${tag}.png` : 'wheel4-before.png';
  const winName = tag ? `wheel4-win${tag}.png` : 'wheel4-win.png';
  render(W, H, {
    stake: 100,
    rotation: 0,
    buttonText: 'SPIN',
    paintButton: true,
    seed: 9,
    lightPhase: 420,
    spinning: false
  }, beforeName);
  render(W, H, {
    stake: 100,
    rotation: winRot,
    winIndex: winIdx,
    winMult: 5,
    winPay: 500,
    reveal: 1,
    buttonText: 'COLLECT',
    paintButton: true,
    shimmer: 0.48,
    seed: 9,
    lightPhase: 1800,
    spinning: false
  }, winName);
}
