// Canvas compositor: sprites, tweens, KAG-like action modules, transitions, quake.
(function () {
  const W = 800, H = 600;
  let canvas, ctx;
  const sprites = new Set();
  let frozen = null; // canvas snapshot shown while a transition is being prepared
  let trans = null;  // active transition
  let quake = null;
  // game clock: stops while the game is paused (app switcher / home), so tweens, actions and
  // transitions continue exactly where they were when play resumes
  let pausedAt = null, pausedTotal = 0;
  const now = () => (pausedAt !== null ? pausedAt : performance.now()) - pausedTotal;
  function setPaused(on) {
    if (on && pausedAt === null) pausedAt = performance.now();
    else if (!on && pausedAt !== null) { pausedTotal += performance.now() - pausedAt; pausedAt = null; }
  }
  let skipFast = () => false;

  class Sprite {
    constructor(z = 0) {
      this.img = null; this.key = null;
      this.x = 0; this.y = 0;
      this.opacity = 255; this.zoom = 100; this.rotate = 0;
      this.afx = null; this.afy = null;
      this.visible = false; this.z = z;
      this.tw = {}; this.actions = [];
      this.ox = 0; this.oy = 0; this.oz = 1; // action offsets
      this.filter = null;
      sprites.add(this);
    }
    destroy() { sprites.delete(this); }
    get w() { return this.img ? this.img.width : 0; }
    get h() { return this.img ? this.img.height : 0; }
    setImage(img, key) { this.img = img; this.key = key; }
    clear() { this.img = null; this.key = null; this.visible = false; this.tw = {}; this.actions = []; this.resetFx(); }
    resetFx() { this.ox = this.oy = 0; this.oz = 1; }
    tween(prop, from, to, ms, accel = 0) {
      if (from !== undefined && from !== null) this[prop] = from;
      if (!ms || ms <= 0 || skipFast()) { this[prop] = to; delete this.tw[prop]; return; }
      this.tw[prop] = { from: this[prop], to, t0: now(), ms, accel };
    }
    moveTo(x, y, ms, accel) {
      if (!ms || ms <= 0 || skipFast()) { this.x = x; this.y = y; delete this.tw.x; delete this.tw.y; return; }
      this.tween("x", null, x, ms, accel);
      this.tween("y", null, y, ms, accel);
    }
    finish() {
      for (const k in this.tw) this[k] = this.tw[k].to;
      this.tw = {};
      this.stopActions();
    }
    stopActions() {
      for (const a of this.actions) if (a.end) a.end(this);
      this.actions = [];
      this.resetFx();
    }
    busy() { return Object.keys(this.tw).length > 0 || this.actions.some((a) => a.finite); }
    beginAction(a) {
      const act = makeAction(a);
      if (act) this.actions.push(act);
      if (skipFast()) this.stopActions();
    }
    update(t) {
      for (const k in this.tw) {
        const tw = this.tw[k];
        let p = Math.min(1, (t - tw.t0) / tw.ms);
        if (tw.accel > 0) p = Math.pow(p, tw.accel + 1);
        else if (tw.accel < 0) p = 1 - Math.pow(1 - p, -tw.accel + 1);
        this[k] = tw.from + (tw.to - tw.from) * p;
        if (p >= 1) delete this.tw[k];
      }
      this.resetFx();
      this.actions = this.actions.filter((a) => a.step(this, t) !== false);
    }
    draw(c) {
      if (!this.visible || !this.img) return;
      const op = Math.max(0, Math.min(255, this.opacity)) / 255;
      if (op <= 0) return;
      c.save();
      c.globalAlpha = op;
      const z = (this.zoom / 100) * this.oz;
      const ax = this.afx != null ? +this.afx : this.w / 2;
      const ay = this.afy != null ? +this.afy : this.h / 2;
      c.translate(this.x + this.ox + ax, this.y + this.oy + ay);
      if (this.rotate) c.rotate((this.rotate * Math.PI) / 180);
      if (z !== 1) c.scale(z, z);
      c.drawImage(this.img, -ax, -ay);
      c.restore();
    }
  }

  // ---- KAG action modules (approximate) ----
  function makeAction(a) {
    const m = a.module;
    const t0 = now() + (+a.delay || 0);
    const num = (v, d) => (v === undefined || v === true ? d : +v);
    switch (m) {
      case "LayerVibrateActionModule": {
        const vib = num(a.vibration, 10), wait = num(a.waittime ?? a.waitTime, 50), time = a.time !== undefined ? +a.time : null;
        let last = 0, dx = 0, dy = 0;
        return { finite: time != null, step(s, t) {
          if (t < t0) return;
          if (time != null && t - t0 > time) return false;
          if (t - last > wait) { last = t; dx = (Math.random() * 2 - 1) * vib; dy = (Math.random() * 2 - 1) * vib; }
          s.ox += dx; s.oy += dy;
        } };
      }
      case "LayerFadeToModeModule": {
        const to = num(a.opacity, 255), time = num(a.time, 500);
        let from = null;
        return { finite: true, step(s, t) {
          if (t < t0) return;
          if (from === null) from = s.opacity;
          const p = Math.min(1, (t - t0) / time);
          s.opacity = from + (to - from) * p;
          if (p >= 1) return false;
        }, end(s) { s.opacity = to; } };
      }
      case "LayerJumpOnceActionModule": {
        const vib = num(a.vibration, 10), cycle = num(a.cycle, 500);
        return { finite: true, step(s, t) {
          if (t < t0) return;
          const p = (t - t0) / cycle;
          if (p >= 1) return false;
          s.oy += -vib * Math.sin(Math.PI * p);
        } };
      }
      case "LayerJumpActionModule": {
        const vib = num(a.vibration, 10), cycle = num(a.cycle, 500), time = a.time !== undefined ? +a.time : null;
        return { finite: time != null, step(s, t) {
          if (t < t0) return;
          if (time != null && t - t0 > time) return false;
          s.oy += -Math.abs(vib * Math.sin((Math.PI * (t - t0)) / cycle));
        } };
      }
      case "LayerHeartBeatZoomModule": {
        const zoom = num(a.zoom, 120), time = num(a.time, 300);
        return { finite: true, step(s, t) {
          if (t < t0) return;
          const p = (t - t0) / time;
          if (p >= 1) return false;
          s.oz *= 1 + ((zoom - 100) / 100) * Math.sin(Math.PI * p);
        } };
      }
      case "LayerVibrateZoomModule": {
        const zoom = num(a.zoom, 150), time = num(a.time, 200), vib = num(a.vibration, 0);
        return { finite: false, step(s, t) {
          if (t < t0) return;
          const p = ((t - t0) % time) / time;
          s.oz *= 1 + ((zoom - 100) / 100) * 0.25 * Math.abs(Math.sin(Math.PI * p));
          if (vib) { s.ox += (Math.random() * 2 - 1) * vib * 0.05; s.oy += (Math.random() * 2 - 1) * vib * 0.05; }
        } };
      }
      case "LayerNormalMoveModule": {
        const time = num(a.time, 1000);
        let fx = null, fy = null;
        return { finite: true, step(s, t) {
          if (t < t0) return;
          if (fx === null) { fx = s.x; fy = s.y; }
          const p = Math.min(1, (t - t0) / time);
          s.x = fx + ((a.x !== undefined ? +a.x : fx) - fx) * p;
          s.y = fy + ((a.y !== undefined ? +a.y : fy) - fy) * p;
          if (p >= 1) return false;
        } };
      }
      case "LayerParabolaMoveModule": {
        const dx = num(a.x, 0), dy = num(a.y, -100), time = num(a.time, 500);
        let done = false;
        const fin = (s) => { if (!done) { done = true; s.x += dx; } };
        return { finite: true, step(s, t) {
          if (t < t0) return;
          const p = Math.min(1, (t - t0) / time);
          if (p >= 1) { fin(s); return false; }
          s.ox += dx * p; s.oy += dy * 4 * p * (1 - p);
        }, end: fin };
      }
      case "LayerNormalRotateModule": {
        const av = num(a.angvel, 360), time = a.time !== undefined ? +a.time : null;
        let last = null;
        return { finite: time != null, step(s, t) {
          if (t < t0) return;
          if (time != null && t - t0 > time) return false;
          if (last !== null) s.rotate += (av * (t - last)) / 1000;
          last = t;
        } };
      }
      case "LayerWaveOnceActionModule": {
        const vib = num(a.vibration, 10), cycle = num(a.cycle, 100), n = 4;
        return { finite: true, step(s, t) {
          if (t < t0) return;
          const p = (t - t0) / (cycle * n);
          if (p >= 1) return false;
          s.ox += vib * (1 - p) * Math.sin((2 * Math.PI * (t - t0)) / cycle);
        } };
      }
      default:
        console.warn("unknown action", m, a);
        return null;
    }
  }

  // ---- frame drawing ----
  function drawScene(c) {
    c.fillStyle = "#000";
    c.fillRect(0, 0, W, H);
    const list = [...sprites].filter((s) => s.visible && s.img).sort((a, b) => a.z - b.z);
    for (const s of list) s.draw(c);
  }

  function snapshot() {
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const c = cv.getContext("2d");
    if (frozen) c.drawImage(frozen, 0, 0);
    else if (trans) drawTransFrame(c, now());
    else drawScene(c);
    return cv;
  }

  function freeze() {
    finishTransition();
    frozen = snapshot();
  }
  function unfreeze() { frozen = null; }

  // rule cache: name -> Uint8Array gray
  const ruleCache = new Map();
  async function loadRule(name) {
    if (ruleCache.has(name)) return ruleCache.get(name);
    const im = await Assets.image(name);
    if (!im) return null;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const c = cv.getContext("2d");
    c.drawImage(im, 0, 0, W, H);
    const d = c.getImageData(0, 0, W, H).data;
    const g = new Uint8Array(W * H);
    for (let i = 0; i < g.length; i++) g[i] = d[i * 4];
    ruleCache.set(name, g);
    return g;
  }

  // Start a transition from the frozen (or current) frame to the live scene.
  async function transition(tr) {
    const old = frozen || snapshot();
    frozen = null;
    let ms = +tr.time;
    if (!(ms >= 0)) ms = 1000;
    if (skipFast()) ms = 0;
    if (ms <= 0) { trans = null; return; }
    const method = tr.method || (tr.rule ? "universal" : "crossfade");
    const t = { old, t0: now(), ms, method, done: null };
    if (method === "universal" && tr.rule) {
      t.rule = await loadRule(tr.rule);
      t.vague = tr.vague !== undefined ? +tr.vague : 64;
      const oc = old.getContext("2d");
      t.oldData = oc.getImageData(0, 0, W, H);
      t.tmp = document.createElement("canvas");
      t.tmp.width = W; t.tmp.height = H;
      t.t0 = now();
    }
    trans = t;
    return new Promise((res) => { t.done = res; });
  }

  function finishTransition() {
    if (trans) { const d = trans.done; trans = null; if (d) d(); }
  }

  function drawTransFrame(c, t) {
    const tr = trans;
    const p = Math.min(1, (t - tr.t0) / tr.ms);
    if (tr.method === "mosaic") {
      const blockMax = 24;
      const src = p < 0.5 ? tr.old : null;
      const q = p < 0.5 ? p * 2 : (1 - p) * 2;
      const bs = Math.max(1, Math.round(q * blockMax));
      if (!src) drawScene(c);
      else c.drawImage(src, 0, 0);
      if (bs > 1) {
        const sw = Math.ceil(W / bs), sh = Math.ceil(H / bs);
        const tmp = tr.mtmp || (tr.mtmp = document.createElement("canvas"));
        tmp.width = sw; tmp.height = sh;
        const tc = tmp.getContext("2d");
        tc.drawImage(c.canvas, 0, 0, sw, sh);
        c.save(); c.imageSmoothingEnabled = false;
        c.drawImage(tmp, 0, 0, sw, sh, 0, 0, W, H);
        c.restore();
      }
      return p >= 1;
    }
    drawScene(c);
    if (tr.rule) {
      const v = tr.vague, phase = p * (255 + v);
      const od = tr.oldData, g = tr.rule;
      const out = tr.out || (tr.out = new ImageData(new Uint8ClampedArray(od.data), W, H));
      const o = out.data;
      for (let i = 0, j = 3; i < g.length; i++, j += 4) {
        // new image appears where rule value is low
        let a = (g[i] - phase + v) / v;
        o[j] = a <= 0 ? 0 : a >= 1 ? 255 : a * 255;
      }
      tr.tmp.getContext("2d").putImageData(out, 0, 0);
      c.drawImage(tr.tmp, 0, 0);
    } else {
      c.save();
      c.globalAlpha = 1 - p;
      c.drawImage(tr.old, 0, 0);
      c.restore();
    }
    return p >= 1;
  }

  function startQuake(ms, hmax, vmax) {
    if (skipFast()) return;
    quake = { t0: now(), ms: +ms || 500, h: +hmax || 10, v: +vmax || 10 };
  }

  function frame() {
    const t = now();
    for (const s of sprites) s.update(t);
    ctx.save();
    if (quake) {
      if (t - quake.t0 > quake.ms) quake = null;
      else ctx.translate((Math.random() * 2 - 1) * quake.h, (Math.random() * 2 - 1) * quake.v);
    }
    if (frozen) ctx.drawImage(frozen, 0, 0);
    else if (trans) {
      if (drawTransFrame(ctx, t)) finishTransition();
    } else drawScene(ctx);
    ctx.restore();
    requestAnimationFrame(frame);
  }

  function init(cv, skipFn) {
    canvas = cv;
    canvas.width = W; canvas.height = H;
    ctx = canvas.getContext("2d");
    skipFast = skipFn;
    requestAnimationFrame(frame);
  }

  function thumbnail(w = 160, h = 120) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(snapshot(), 0, 0, w, h);
    return cv.toDataURL("image/jpeg", 0.7);
  }

  function anyBusy() { return [...sprites].some((s) => s.visible && s.busy()); }
  function finishAll() { finishTransition(); for (const s of sprites) s.finish(); quake = null; }

  // tinted copy of an image (character light colour for 夕/夜)
  const tintCache = new Map();
  function tinted(img, key, info) {
    if (!info || (info.charLightColor === undefined && info.charBrightness === undefined)) return img;
    const ck = key + "|" + info.prefix;
    if (tintCache.has(ck)) return tintCache.get(ck);
    const cv = document.createElement("canvas");
    cv.width = img.width; cv.height = img.height;
    const c = cv.getContext("2d");
    const b = (100 + (+info.charBrightness || 0)) / 100, ct = (100 + (+info.charContrast || 0)) / 100;
    c.drawImage(img, 0, 0);
    if (b !== 1 || ct !== 1) {
      const id = c.getImageData(0, 0, cv.width, cv.height), d = id.data;
      const lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) lut[v] = (v * b - 128) * ct + 128;
      for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
      c.putImageData(id, 0, 0);
    }
    if (info.charLightColor !== undefined) {
      const col = info.charLightColor >>> 0;
      const a = ((col >>> 24) & 255) / 255, r = (col >>> 16) & 255, g = (col >>> 8) & 255, bl = col & 255;
      c.globalCompositeOperation = "soft-light";
      c.fillStyle = `rgba(${r},${g},${bl},${a})`;
      c.fillRect(0, 0, cv.width, cv.height);
      c.globalCompositeOperation = "destination-in";
      c.drawImage(img, 0, 0);
    }
    if (tintCache.size > 30) tintCache.delete(tintCache.keys().next().value);
    tintCache.set(ck, cv);
    return cv;
  }

  window.Render = { W, H, Sprite, clock: now, setPaused, get paused() { return pausedAt !== null; }, init, freeze, unfreeze, transition, finishTransition, startQuake, thumbnail, anyBusy, finishAll, tinted,
    get inTransition() { return !!trans; }, get frozen() { return !!frozen; } };
})();
