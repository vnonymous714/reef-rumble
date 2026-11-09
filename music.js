/* Original procedural reef/temple ambient bed (Web Audio). No external audio assets. */
(function (root) {
  'use strict';

  var NORMAL_BPM = 76;
  var BONUS_BPM = 140;
  var RAMP_PER_SEC = 1.15; /* intensity units/sec toward target */
  var LOOKAHEAD = 0.12;
  var SCHEDULE_MS = 80;
  var SCALE = [0, 3, 5, 7, 10]; /* minor pentatonic degrees */
  var ROOT = 110; /* A2 drone root */

  function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }

  /** Pure tempo / intensity state machine (Node + browser). */
  function createTempo(opts) {
    opts = opts || {};
    var normalBpm = opts.normalBpm || NORMAL_BPM;
    var bonusBpm = opts.bonusBpm || BONUS_BPM;
    var ramp = opts.rampPerSec || RAMP_PER_SEC;
    var intensity = 0;
    var mode = 'normal';
    var bonus = false;

    function setBonus(active) {
      bonus = !!active;
      mode = bonus ? 'bonus' : 'normal';
    }

    function tick(dt) {
      if (!Number.isFinite(dt) || dt < 0) return intensity;
      var target = bonus ? 1 : 0;
      if (intensity < target) intensity = Math.min(target, intensity + ramp * dt);
      else if (intensity > target) intensity = Math.max(target, intensity - ramp * dt);
      return intensity;
    }

    function bpm() {
      return normalBpm + (bonusBpm - normalBpm) * intensity;
    }

    return {
      setBonus: setBonus,
      tick: tick,
      get mode() {
        return mode;
      },
      get bonus() {
        return bonus;
      },
      get intensity() {
        return intensity;
      },
      get bpm() {
        return bpm();
      },
      snapshot: function () {
        return { mode: mode, bonus: bonus, intensity: intensity, bpm: bpm() };
      }
    };
  }

  /**
   * DOM / authority bonus probe. Pure when doc + extras are injected.
   * Bonus when: temple crab slots, daily wheel, catch wheel, neon slots,
   * laser window, or ARC/PLASMA weapon window.
   */
  function detectBonusActive(doc, extras) {
    extras = extras || {};
    if (extras.laserOn || extras.weaponMode || extras.forceBonus) return true;
    if (!doc || typeof doc.querySelector !== 'function') return false;
    if (doc.querySelector('#dailyM.open, #wheelM.open, #templeM.open, #slotsV.open, #bonusChoiceM.open, #chestBonusM.open, #tapBonusM.open, #choiceWheelM.open')) return true;
    if (doc.querySelector('#laserHud.on')) return true;
    if (doc.querySelector('#arcMode[aria-pressed="true"], #plasmaMode[aria-pressed="true"]')) return true;
    return false;
  }

  function readMuted() {
    try {
      if (root.__slotsBridge && typeof root.__slotsBridge.mute === 'boolean') return !!root.__slotsBridge.mute;
      if (root.__reef && root.__reef.S) return !!root.__reef.S.mute;
    } catch (e) {}
    return false;
  }

  function readExtras() {
    var extras = { laserOn: false, weaponMode: false };
    try {
      var auth = root.ReefAuthority;
      var snap = auth && auth.snapshot;
      var now = auth && typeof auth.now === 'function' ? auth.now() : Date.now();
      if (snap && snap.world) {
        if (snap.world.laserUntil && now < snap.world.laserUntil) extras.laserOn = true;
        var weapons = snap.world.weapons || snap.world.modes;
        if (weapons) {
          var arc = weapons.arc;
          var plasma = weapons.plasma;
          if ((arc && arc.until && now < arc.until) || (plasma && plasma.until && now < plasma.until)) {
            extras.weaponMode = true;
          }
          if (weapons.mode === 'arc' || weapons.mode === 'plasma') extras.weaponMode = true;
        }
      }
    } catch (e) {}
    return extras;
  }

  function midi(semi) {
    return ROOT * Math.pow(2, semi / 12);
  }

  function createEngine() {
    var tempo = createTempo();
    var ac = null;
    var master = null;
    var bed = null;
    var unlocked = false;
    var running = false;
    var timer = null;
    var nextBeat = 0;
    var beatCount = 0;
    var lastTs = 0;

    function ensureContext() {
      if (ac) return ac;
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      try {
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0;
        master.connect(ac.destination);
        bed = ac.createGain();
        bed.gain.value = 0.22;
        bed.connect(master);
      } catch (e) {
        ac = null;
        master = null;
        bed = null;
      }
      return ac;
    }

    function setMasterQuiet(mute) {
      if (!master || !ac) return;
      var t = ac.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(mute || document.hidden ? 0 : 0.38, t, 0.08);
    }

    function tone(freq, dur, type, vol, when) {
      if (!ac || !bed || !freq) return;
      var t0 = when != null ? when : ac.currentTime;
      var o = ac.createOscillator();
      var g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol || 0.05), t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.05, dur));
      o.connect(g);
      g.connect(bed);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    }

    function softKick(when, intensity) {
      if (!ac || !bed) return;
      var t0 = when;
      var o = ac.createOscillator();
      var g = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(90 + 40 * intensity, t0);
      o.frequency.exponentialRampToValueAtTime(42, t0 + 0.16);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.09 + 0.08 * intensity, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.connect(g);
      g.connect(bed);
      o.start(t0);
      o.stop(t0 + 0.25);
    }

    function softHat(when, intensity) {
      if (!ac || !bed) return;
      var t0 = when;
      var o = ac.createOscillator();
      var f = ac.createBiquadFilter();
      var g = ac.createGain();
      o.type = 'triangle';
      o.frequency.value = 4200 + 800 * intensity;
      f.type = 'highpass';
      f.frequency.value = 3500;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.02 + 0.03 * intensity, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
      o.connect(f);
      f.connect(g);
      g.connect(bed);
      o.start(t0);
      o.stop(t0 + 0.05);
    }

    function scheduleBeat(when, intensity) {
      var deg = SCALE[beatCount % SCALE.length];
      var octave = beatCount % 8 < 4 ? 0 : 12;
      var pad = midi(deg + octave);
      tone(pad, 0.55 + 0.25 * (1 - intensity), intensity > 0.55 ? 'triangle' : 'sine', 0.035 + 0.02 * intensity, when);
      tone(midi(-12), 0.9, 'sine', 0.028, when); /* drone pulse */

      if (intensity > 0.15 && beatCount % 2 === 0) softKick(when, intensity);
      if (intensity > 0.35) softHat(when + (60 / Math.max(40, tempo.bpm)) * 0.5, intensity);

      if (intensity > 0.55) {
        var arp = SCALE[(beatCount * 2) % SCALE.length];
        tone(midi(arp + 24), 0.12, 'triangle', 0.03 + 0.025 * intensity, when + 0.02);
        tone(midi(SCALE[(beatCount * 2 + 1) % SCALE.length] + 24), 0.1, 'sine', 0.022, when + 0.08);
      }
      beatCount++;
    }

    function scheduler() {
      if (!running || !ac || !unlocked) return;
      if (document.hidden || readMuted()) {
        setMasterQuiet(true);
        return;
      }
      setMasterQuiet(false);
      var now = ac.currentTime;
      var horizon = now + LOOKAHEAD;
      while (nextBeat < horizon) {
        scheduleBeat(nextBeat, tempo.intensity);
        nextBeat += 60 / Math.max(40, tempo.bpm);
      }
    }

    function loop(ts) {
      if (!running) return;
      if (!lastTs) lastTs = ts;
      var dt = Math.min(0.1, (ts - lastTs) / 1000);
      lastTs = ts;
      var bonus = detectBonusActive(root.document, readExtras());
      tempo.setBonus(bonus);
      tempo.tick(dt);
      if (timer == null) {
        timer = setInterval(scheduler, SCHEDULE_MS);
        scheduler();
      }
      root.requestAnimationFrame(loop);
    }

    function unlock() {
      unlocked = true;
      ensureContext();
      if (!ac) return false;
      if (ac.state === 'suspended') {
        try {
          ac.resume();
        } catch (e) {}
      }
      if (!running) {
        running = true;
        nextBeat = ac.currentTime + 0.05;
        lastTs = 0;
        root.requestAnimationFrame(loop);
      }
      setMasterQuiet(readMuted());
      return true;
    }

    function stop() {
      running = false;
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
      if (ac && ac.state !== 'closed') {
        try {
          setMasterQuiet(true);
        } catch (e) {}
      }
    }

    function onVisibility() {
      if (!ac || !unlocked) return;
      if (document.hidden) {
        try {
          ac.suspend();
        } catch (e) {}
        setMasterQuiet(true);
      } else {
        try {
          ac.resume();
        } catch (e) {}
        setMasterQuiet(readMuted());
        nextBeat = Math.max(nextBeat, ac.currentTime + 0.05);
      }
    }

    function bind() {
      var unlockOnce = function () {
        unlock();
      };
      ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(function (ev) {
        root.document.addEventListener(ev, unlockOnce, { capture: true, passive: true });
      });
      root.document.addEventListener('visibilitychange', onVisibility);
      var muteBtn = root.document.getElementById('muteBtn');
      if (muteBtn) {
        muteBtn.addEventListener(
          'click',
          function () {
            setTimeout(function () {
              setMasterQuiet(readMuted());
            }, 0);
          },
          true
        );
      }
    }

    return {
      unlock: unlock,
      stop: stop,
      bind: bind,
      tempo: tempo,
      get unlocked() {
        return unlocked;
      },
      get running() {
        return running;
      },
      detect: function () {
        return detectBonusActive(root.document, readExtras());
      },
      snapshot: function () {
        return Object.assign({ unlocked: unlocked, running: running, muted: readMuted() }, tempo.snapshot());
      }
    };
  }

  var api = {
    NORMAL_BPM: NORMAL_BPM,
    BONUS_BPM: BONUS_BPM,
    createTempo: createTempo,
    detectBonusActive: detectBonusActive,
    createEngine: createEngine
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ReefMusic = api;
    var engine = null;
    function boot() {
      if (engine) return engine;
      engine = createEngine();
      engine.bind();
      root.ReefMusic.engine = engine;
      root.ReefMusic.unlock = function () {
        return engine.unlock();
      };
      root.ReefMusic.snapshot = function () {
        return engine.snapshot();
      };
      return engine;
    }
    if (root.document && root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
