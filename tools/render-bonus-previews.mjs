import { createCanvas, loadImage } from '/tmp/rr-napi/node_modules/@napi-rs/canvas/index.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const wheelArt = loadArt('daily-wheel-art.js').ReefDailyWheelArt;
const choiceArt = loadArt('bonus-choice-art.js', { ReefDailyWheelArt: wheelArt }).ReefBonusChoiceArt;

const bgReef = await loadImage(path.join(root, 'assets/bg.webp'));
const bonusBg = await loadImage(path.join(root, 'assets/bonus-bg.webp'));
const chestC = await loadImage(path.join(root, 'assets/bonus-chest-closed.webp'));
const chestO = await loadImage(path.join(root, 'assets/bonus-chest-open.webp'));
const pearl = await loadImage(path.join(root, 'assets/bonus-tap-pearl.webp'));
const chestCsm = await loadImage(path.join(root, 'assets/bonus-chest-closed-sm.webp'));
const chestOsm = await loadImage(path.join(root, 'assets/bonus-chest-open-sm.webp'));
const pearlSm = await loadImage(path.join(root, 'assets/bonus-tap-pearl-sm.webp'));

choiceArt.setImages({
  bg: bonusBg,
  chestClosed: chestC,
  chestOpen: chestO,
  pearl,
  chestClosedSm: chestCsm,
  chestOpenSm: chestOsm,
  pearlSm
});

const W = 985, H = 400;
mkdirSync('/workspace/shots', { recursive: true });
mkdirSync(path.join(root, 'docs'), { recursive: true });

function plate(g) {
  const s = Math.max(W / bonusBg.width, H / bonusBg.height);
  const dw = bonusBg.width * s, dh = bonusBg.height * s;
  g.drawImage(bonusBg, (W - dw) / 2, (H - dh) / 2, dw, dh);
  g.fillStyle = 'rgba(2,12,24,.42)';
  g.fillRect(0, 0, W, H);
  round(g, 36, 16, W - 72, H - 32, 18);
  g.fillStyle = 'rgba(6,20,32,.50)';
  g.fill();
  g.strokeStyle = '#c5a45d'; g.lineWidth = 3; g.stroke();
}
function round(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
function title(g, text, y=44){g.textAlign='center';g.font='900 18px system-ui';g.fillStyle='#ffdf9d';g.shadowColor='rgba(0,0,0,.5)';g.shadowBlur=6;g.fillText(text,W/2,y);g.shadowBlur=0;}
function save(canvas, name) {
  const out = `/workspace/shots/${name}`;
  writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(JSON.stringify({ out, bytes: readFileSync(out).length }));
}

// 1) daily wheel
{
  const canvas = createCanvas(W, H);
  const g = canvas.getContext('2d');
  const DAILY = [100, 200, 300, 400, 500, 800, 1000, 1500, 2500, 10000];
  wheelArt.paintDailyModalChrome(g, W, H, {
    bgImage: bgReef, prizes: DAILY, fmt: (c) => (c / 100).toFixed(2), seed: 11,
    streakLabel: 'DAY 1', resultText: '', buttonText: 'SPIN · DAILY GIFT'
  });
  save(canvas, 'bonus1-daily-wheel.png');
  writeFileSync(path.join(root, 'docs/daily-temple-wheel-ui5-preview.png'), canvas.toBuffer('image/png'));
  const c2 = createCanvas(700, 700); const g2 = c2.getContext('2d');
  g2.fillStyle = '#041420'; g2.fillRect(0, 0, 700, 700);
  g2.save(); g2.translate(350, 350);
  wheelArt.paintDailyTempleWheel(g2, { R: 300, prizes: DAILY, fmt: (c) => (c / 100).toFixed(2), seed: 3 });
  g2.restore();
  writeFileSync(path.join(root, 'docs/daily-temple-wheel-ui5-closeup.png'), c2.toBuffer('image/png'));
  writeFileSync('/workspace/shots/bonus1-daily-wheel-closeup.png', c2.toBuffer('image/png'));
  console.log(JSON.stringify({ out: '/workspace/shots/bonus1-daily-wheel-closeup.png' }));
}

// 2) choice menu
{
  const canvas = createCanvas(W, H); const g = canvas.getContext('2d'); plate(g); title(g, 'TEMPLE RELIC BONUS');
  g.font = '600 12px system-ui'; g.fillStyle = 'rgba(200,230,240,.9)';
  g.fillText('Locked stake 1.00 · pick ONE game · once per 12 hours', W / 2, 66);
  const cards = [
    ['wheel', 'TEMPLE WHEEL', 'Spin a sunken-temple stake wheel'],
    ['chest', 'TREASURE CHESTS', 'Pick 1 of 3 · 2x / 5x / 10x'],
    ['tap', 'TAP FRENZY', '20s free taps · rate raises mult']
  ];
  const cw = 280, ch = 270, gap = 16;
  const total = cards.length * cw + (cards.length - 1) * gap;
  let x = (W - total) / 2;
  const y = 84;
  for (const [kind, t, b] of cards) {
    g.save(); g.translate(x, y);
    choiceArt.paintChoiceCard(g, cw, ch, kind, t, b, false);
    g.restore();
    x += cw + gap;
  }
  g.font = '600 10px system-ui'; g.fillStyle = 'rgba(200,230,240,.75)';
  g.fillText('One bonus pick every 12 hours · play credits only · max 400.00 per award', W / 2, H - 24);
  save(canvas, 'bonus-choice-menu.png');
}

// 3) treasure chests
{
  const canvas = createCanvas(W, H); const g = canvas.getContext('2d'); plate(g); title(g, 'TEMPLE TREASURE CHESTS');
  g.fillStyle = 'rgba(200,230,240,.9)'; g.font = '600 12px system-ui';
  g.fillText('Stake 1.00 · pick a chest · server shuffled 2x · 5x · 10x', W / 2, 66);
  const px = 50, py = 78, pw = W - 100, ph = 260;
  g.save();
  g.beginPath(); round(g, px, py, pw, ph, 14); g.clip();
  choiceArt.paintChestPanel(g, pw, ph, [
    { open: true, mult: 2 },
    { open: true, mult: 5 },
    { open: true, mult: 10 }
  ]);
  g.restore();
  g.strokeStyle = 'rgba(197,164,93,.75)'; g.lineWidth = 2;
  round(g, px, py, pw, ph, 14); g.stroke();
  g.fillStyle = '#fff6d0'; g.font = '900 20px system-ui';
  g.fillText('+5.00 · 5\u00d7', W / 2, H - 30);
  save(canvas, 'bonus2-treasure-chests.png');
}

// 4) tap frenzy
{
  const canvas = createCanvas(W, H); const g = canvas.getContext('2d'); plate(g); title(g, 'REEF TAP FRENZY');
  g.fillStyle = '#cde5e7'; g.font = '800 12px system-ui';
  g.fillText('TIME 14.2    TAPS 96    MULT 3.10\u00d7    LIVE 3.10', W / 2, 66);
  const px = 50, py = 78, pw = W - 100, ph = 260;
  g.save();
  g.beginPath(); round(g, px, py, pw, ph, 14); g.clip();
  choiceArt.paintTapScene(g, pw, ph, {
    timeFrac: 14.2 / 20,
    timeLeft: '14.2',
    heat: 0.55,
    multLabel: '3.10\u00d7',
    pulse: 0.55,
    bursts: [
      { x: pw * 0.55, y: ph * 0.42, t: 1 },
      { x: pw * 0.70, y: ph * 0.36, t: 2 },
      { x: pw * 0.64, y: ph * 0.55, t: 3 },
      { x: pw * 0.74, y: ph * 0.50, t: 4 }
    ]
  });
  g.restore();
  g.strokeStyle = 'rgba(197,164,93,.75)'; g.lineWidth = 2;
  round(g, px, py, pw, ph, 14); g.stroke();
  g.fillStyle = '#fff6d0'; g.font = '900 20px system-ui';
  g.fillText('+3.10 live', W / 2, H - 30);
  save(canvas, 'bonus3-tap-frenzy.png');
}

// 5) choice wheel
{
  const canvas = createCanvas(W, H); const g = canvas.getContext('2d'); plate(g); title(g, 'TEMPLE STAKE WHEEL');
  g.fillStyle = 'rgba(200,230,240,.9)'; g.font = '600 12px system-ui';
  g.fillText('Stake 1.00 · weighted multipliers', W / 2, 66);
  g.save(); g.translate(W / 2, 200);
  const prizes = MathBonus.CHOICE_WHEEL.map(([m]) => Math.round(100 * m));
  wheelArt.paintDailyTempleWheel(g, { R: 110, prizes, fmt: (c) => (c / 100).toFixed(1) + '\u00d7', seed: 5 });
  g.restore();
  g.fillStyle = '#ffe28a'; g.strokeStyle = '#6a420a'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(W/2, 78); g.lineTo(W/2-9, 90); g.lineTo(W/2+9, 90); g.closePath(); g.fill(); g.stroke();
  const bw = 160, bh = 30, bx = W/2 - bw/2, by = 330;
  round(g, bx, by, bw, bh, 15);
  const btn = g.createLinearGradient(bx, by, bx, by + bh);
  btn.addColorStop(0, '#fff0b0'); btn.addColorStop(0.55, '#f0b532'); btn.addColorStop(1, '#b9770e');
  g.fillStyle = btn; g.fill(); g.strokeStyle = '#7a4a0c'; g.stroke();
  g.font = '900 13px system-ui'; g.fillStyle = '#3a2000'; g.fillText('SPIN', W / 2, by + 20);
  save(canvas, 'bonus-choice-wheel.png');
}
