import { createCanvas, loadImage, GlobalFonts } from '/tmp/rr-napi/node_modules/@napi-rs/canvas/index.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
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
choiceArt.setImages({
  bg: bonusBg,
  rim: await loadImage(path.join(root, 'assets/bonus-wheel-rim.webp')),
  face: await loadImage(path.join(root, 'assets/bonus-wheel-face.webp')),
  pointer: await loadImage(path.join(root, 'assets/bonus-wheel-pointer.webp')),
  hub: await loadImage(path.join(root, 'assets/bonus-wheel-hub.webp')),
  plaque: await loadImage(path.join(root, 'assets/bonus-wheel-plaque.webp'))
});

const SIZES = [
  [985, 400, ''],
  [844, 390, '@844'],
  [740, 360, '@740']
];
mkdirSync('/workspace/shots', { recursive: true });

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
function save(canvas, name) {
  const out = `/workspace/shots/${name}`;
  writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(JSON.stringify({ out, bytes: readFileSync(out).length, w: canvas.width, h: canvas.height }));
}

const n = MathBonus.CHOICE_WHEEL.length;
const winIdx = MathBonus.wheelIndexForMult(5);
const winRot = MathBonus.wheelTargetRotation(winIdx, n);

for (const [W, H, tag] of SIZES) {
  {
    const canvas = createCanvas(W, H);
    const g = canvas.getContext('2d');
    plate(g, W, H);
    g.save();
    round(g, 3, 3, W - 6, H - 6, 14);
    g.clip();
    choiceArt.paintStakeWheelScene(g, W, H, {
      stake: 100,
      rotation: 0,
      buttonText: 'SPIN',
      paintButton: true,
      seed: 9
    });
    g.restore();
    g.strokeStyle = '#c5a45d';
    g.lineWidth = 3;
    round(g, 1.5, 1.5, W - 3, H - 3, 16);
    g.stroke();
    save(canvas, tag ? `wheel3-before${tag}.png` : 'wheel3-before.png');
  }
  {
    const canvas = createCanvas(W, H);
    const g = canvas.getContext('2d');
    plate(g, W, H);
    g.save();
    round(g, 3, 3, W - 6, H - 6, 14);
    g.clip();
    choiceArt.paintStakeWheelScene(g, W, H, {
      stake: 100,
      rotation: winRot,
      winIndex: winIdx,
      winMult: 5,
      winPay: 500,
      reveal: 1,
      buttonText: 'COLLECT',
      paintButton: true,
      shimmer: 0.48,
      seed: 9
    });
    g.restore();
    g.strokeStyle = '#c5a45d';
    g.lineWidth = 3;
    round(g, 1.5, 1.5, W - 3, H - 3, 16);
    g.stroke();
    save(canvas, tag ? `wheel3-win${tag}.png` : 'wheel3-win.png');
  }
}
