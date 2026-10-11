// KAG interpreter (scenario execution, flags, waits, save/load).
(function () {
  const parsed = new Map();
  function getScript(storage) {
    let s = String(storage);
    if (!/\.ks$/i.test(s)) s += ".ks";
    if (parsed.has(s)) return parsed.get(s);
    const src = (window.SCRIPTS || {})[s] ?? Object.entries(window.SCRIPTS || {}).find(([k]) => k.toLowerCase() === s.toLowerCase())?.[1];
    if (src === undefined) throw new Error("script not found: " + s);
    const p = KS.parse(src, s);
    parsed.set(s, p);
    return p;
  }

  // ---------- persistence ----------
  const Store = {
    get(k) {
      try {
        if (window.NATIVE_STORE && k in window.NATIVE_STORE) return JSON.parse(window.NATIVE_STORE[k]);
        const v = localStorage.getItem("braban." + k);
        return v ? JSON.parse(v) : null;
      } catch (e) { return null; }
    },
    set(k, v) {
      const s = JSON.stringify(v);
      try {
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.store) {
          window.NATIVE_STORE = window.NATIVE_STORE || {};
          window.NATIVE_STORE[k] = s;
          window.webkit.messageHandlers.store.postMessage({ key: k, value: s });
        } else localStorage.setItem("braban." + k, s);
      } catch (e) { console.warn("store failed", e); }
    },
    del(k) {
      try {
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.store) {
          if (window.NATIVE_STORE) delete window.NATIVE_STORE[k];
          window.webkit.messageHandlers.store.postMessage({ key: k, value: null });
        } else localStorage.removeItem("braban." + k);
      } catch (e) {}
    },
  };

  function vars(obj) {
    return new Proxy(obj, {
      get(t, k) { if (k in t) return t[k]; return typeof k === "string" && k !== "toJSON" && k !== "then" ? 0 : undefined; },
    });
  }

  class Abort extends Error {}

  const VM = {
    f: null, sf: null, tf: null, fRaw: {}, sfRaw: {}, tfRaw: {},
    globals: {},
    macros: new Map(),
    stack: [],
    skipMode: false, autoMode: false, skipBlock: null,
    config: null,
    savePoint: null,
    backlog: [],
    gen: 0,
    running: false,
    selects: [], mselects: [], selStart: null,
    labelTitle: "",
    lastTrans: null,
    clickWaiters: [],
    currentEntry: null,
    showdayStorage: null,
    Store,
  };
  window.VM = VM;

  // ---------- config / system flags ----------
  const DEFAULT_CONFIG = { textSpeed: 30, autoWait: 1200, bgm: 0.8, se: 1.0, voice: 1.0, allskip: false, layout: "auto" };
  VM.loadSystem = function () {
    VM.config = Object.assign({}, DEFAULT_CONFIG, Store.get("config") || {});
    VM.sfRaw = Store.get("sf") || {};
    VM.sf = vars(VM.sfRaw);
    if (VM.sfRaw.first_start !== "comp") {
      Object.assign(VM.sfRaw, { voicecut: true, dateview: true, noeffect: false, bgmdown: false, first_start: "comp" });
    }
    VM.sfRaw.defaultName = "純";
    VM.sfRaw.defaultFamily = "香住";
    VM.read = Store.get("read") || {};
    VM.applyConfig();
  };
  VM.applyConfig = function () {
    Sound.setVolume("bgm", VM.config.bgm);
    Sound.setVolume("se", VM.config.se);
    Sound.setVolume("voice", VM.config.voice);
    if (Sound.setPolicy) Sound.setPolicy();
  };
  // back to factory settings (also the system flags shown in the settings screen)
  VM.resetConfig = function () {
    VM.config = Object.assign({}, DEFAULT_CONFIG);
    VM.sfRaw.voicecut = true;
    VM.sfRaw.dateview = true;
    VM.saveConfig();
    VM.markSf();
  };
  VM.saveConfig = function () { Store.set("config", VM.config); VM.applyConfig(); };
  let sfTimer = null;
  VM.markSf = function () {
    if (sfTimer) return;
    sfTimer = setTimeout(() => { sfTimer = null; Store.set("sf", VM.sfRaw); Store.set("read", VM.read); }, 1500);
  };
  VM.flushSf = function () { if (sfTimer) { clearTimeout(sfTimer); sfTimer = null; } Store.set("sf", VM.sfRaw); Store.set("read", VM.read); };
  VM.voiceOn = function () { return true; };

  // ---------- expression evaluation ----------
  const fnCache = new Map();
  const kagObj = {
    get skipMode() { return VM.skipMode ? 1 : 0; },
    get autoMode() { return VM.autoMode ? 1 : 0; },
    get clickSkipEnabled() { return true; },
    invisibleCurrentMessageLayer() { UI.hideWindowTemp(); },
    se: Sound.se.map((t) => ({ fadeOut: (o) => t.stop((o && o.time) || 0), stop: () => t.stop() })),
    bgm: { get playingStorage() { return Sound.bgm.storage; } },
    close() {},
    isRecollection: false,
  };
  const noop = () => {};
  function scope(mp) {
    return {
      f: VM.f, sf: VM.sf, tf: VM.tf, mp: mp || {}, kag: kagObj, global: VM.globals,
      intrandom: (a, b) => (b === undefined ? Math.floor(Math.random() * (a + 1)) : a + Math.floor(Math.random() * (b - a + 1))),
      startSystem: () => UI.openMenu("system"), startSave: () => UI.openMenu("save"), startLoad: () => UI.openMenu("load"),
      backlogAction: () => UI.openBacklog(), automodeAction: () => VM.toggleAuto(), skipmodeAction: () => VM.toggleSkip(),
      hidewindowAction: () => UI.toggleHide(), quicksaveAction: () => VM.quickSave(), quickloadAction: () => VM.quickLoad(), backbeforeAction: noop,
      practiceSuccess: () => VM.globals.practiceSuccess(), practiceFail: () => VM.globals.practiceFail(),
      playTae: (v) => Sound.se[8].play(v + ".ogg"),
      lockMessageLayerSelProcess: noop, shutdown: noop, dm: noop,
      Math, String, Number,
    };
  }
  VM.evalExp = function (exp, mp) {
    if (exp === undefined || exp === true) return exp;
    let src = String(exp).replace(/\bvoid\b/g, "undefined").replace(/\bglobal\.world_object\b/g, "global.world_object");
    let fn = fnCache.get(src);
    if (!fn) {
      try { fn = new Function("__s", "with(__s){ return (" + src + "); }"); }
      catch (e) { console.warn("bad expression", exp, e); fn = () => undefined; }
      fnCache.set(src, fn);
    }
    try { return fn(scope(mp)); }
    catch (e) { console.warn("eval error", exp, e); return undefined; }
  };

  // ---------- waits ----------
  let abortP, abortFn;
  function newAbort() { abortP = new Promise((_, rej) => { abortFn = () => rej(new Abort()); }); abortP.catch(() => {}); }
  newAbort();
  function guard(p) { return Promise.race([p, abortP]); }
  VM.isSkip = () => VM.skipMode;
  VM.click = function () {
    const w = VM.clickWaiters;
    VM.clickWaiters = [];
    w.forEach((f) => f());
    return w.length > 0;
  };
  function onClick() { return new Promise((res) => VM.clickWaiters.push(res)); }
  VM.waitTime = function (ms, canskip = true) {
    if (VM.skipMode || ms <= 0) return guard(Promise.resolve());
    // measured on the game clock, so a pause (app switcher / home) does not eat the wait
    return guard(new Promise((res) => {
      let done = false;
      const fin = () => { if (!done) { done = true; res(); } };
      const end = Render.clock() + ms;
      const chk = () => {
        if (done) return;
        const left = end - Render.clock();
        if (left <= 0) fin();
        else setTimeout(chk, Math.min(left, 100));
      };
      chk();
      if (canskip) onClick().then(fin);
    }));
  };
  VM.waitTransition = function (p) {
    if (!p) return guard(Promise.resolve());
    if (VM.skipMode) Render.finishTransition();
    onClick().then(() => Render.finishTransition());
    return guard(p);
  };
  VM.waitVoice = function () {
    if (VM.skipMode) return guard(Promise.resolve());
    return guard(new Promise((res) => {
      const t = Sound.voices;
      onClick().then(res);
      const chk = () => (t.playing ? setTimeout(chk, 50) : res());
      chk();
    }));
  };
  VM.waitClick = function () {
    if (VM.skipMode) return guard(Promise.resolve());
    return guard(onClick());
  };
  function waitActions() {
    return guard(new Promise((res) => {
      if (VM.skipMode) { Render.finishAll(); return res(); }
      onClick().then(() => { Render.finishAll(); res(); });
      const chk = () => (Render.anyBusy() ? setTimeout(chk, 30) : res());
      chk();
    }));
  }

  // ---------- modes ----------
  VM.toggleSkip = function (on) {
    VM.skipMode = on === undefined ? !VM.skipMode : on;
    if (VM.skipMode) { VM.autoMode = false; Render.finishAll(); VM.click(); }
    UI.updateModes();
  };
  VM.toggleAuto = function (on) {
    VM.autoMode = on === undefined ? !VM.autoMode : on;
    if (VM.autoMode) { VM.skipMode = false; VM.click(); }
    UI.updateModes();
  };
  VM.cancelSkip = function () { if (VM.skipMode) { VM.skipMode = false; UI.updateModes(); } };

  // ---------- read tracking ----------
  function isRead(storage, ln) { const r = VM.read[storage]; return !!(r && r[ln >> 5] & (1 << (ln & 31))); }
  function markRead(storage, ln) {
    const r = VM.read[storage] || (VM.read[storage] = []);
    const i = ln >> 5;
    while (r.length <= i) r.push(0);
    r[i] |= 1 << (ln & 31);
    VM.markSf();
  }

  // ---------- execution ----------
  function frame() { return VM.stack[VM.stack.length - 1]; }
  function attrsObj(list, mp) {
    const o = {};
    const out = [];
    for (let [k, v] of list) {
      if (typeof v === "string" && v[0] === "&") v = VM.evalExp(v.slice(1), mp);
      else if (typeof v === "string" && v[0] === "%" && mp) {
        const [n, d] = v.slice(1).split("|");
        v = n in mp ? mp[n] : d;
      }
      if (v !== undefined && v !== null && typeof v !== "boolean") v = typeof v === "number" ? String(v) : v;
      o[k] = v;
      out.push([k, v]);
    }
    return { elm: o, list: out };
  }
  function jumpTo(storage, target, call) {
    const fr = frame();
    const scr = storage ? getScript(storage) : fr.script;
    let pc = 0;
    if (target) {
      const t = String(target).replace(/^\*/, "");
      if (!(t in scr.labels)) throw new Error("label not found: " + scr.storage + " " + target);
      pc = scr.labels[t];
    }
    const nf = { script: scr, ops: scr.ops, pc, mp: null };
    if (call) VM.stack.push(nf);
    else {
      // jump discards macro frames
      while (VM.stack.length > 1 && frame().macro) VM.stack.pop();
      VM.stack[VM.stack.length - 1] = nf;
    }
  }
  // skip from pc to matching else/elsif/endif. mode 'cond': stops at else/elsif ; 'end': only endif
  function skipIf(fr, mode) {
    let depth = 0;
    while (fr.pc < fr.ops.length) {
      const op = fr.ops[fr.pc++];
      if (op.t !== "tag") continue;
      if (op.name === "if") depth++;
      else if (op.name === "endif") { if (depth === 0) return; depth--; }
      else if (depth === 0 && mode === "cond") {
        if (op.name === "else") return;
        if (op.name === "elsif") {
          const { elm } = attrsObj(op.attrs, fr.mp);
          if (VM.evalExp(elm.exp, fr.mp)) return;
        }
      }
    }
  }

  VM.start = async function (storage, target) {
    VM.abort();
    VM.stack = [];
    const scr = getScript(storage);
    VM.stack.push({ script: scr, ops: scr.ops, pc: target ? scr.labels[target.replace(/^\*/, "")] : 0, mp: null });
    return VM.run();
  };
  VM.abort = function () {
    VM.gen++;
    abortFn();
    newAbort();
    VM.clickWaiters = [];
  };
  VM.run = async function () {
    const gen = VM.gen;
    VM.running = true;
    try {
      while (gen === VM.gen) {
        const fr = frame();
        if (!fr) break;
        if (fr.pc >= fr.ops.length) {
          if (VM.stack.length > 1) { VM.stack.pop(); continue; }
          console.warn("end of script", fr.script.storage);
          break;
        }
        // while the game is paused nothing advances (auto / skip included)
        while (VM.paused && gen === VM.gen) await guard(new Promise((r) => setTimeout(r, 100)));
        const op = fr.ops[fr.pc++];
        await exec(op, fr);
      }
    } catch (e) {
      if (!(e instanceof Abort)) { console.error(e); UI.toast("スクリプトエラー: " + e.message); }
    }
    if (gen === VM.gen) VM.running = false;
  };

  function takeSavePoint(fr, pcOverride) {
    const stack = VM.stack.filter((s) => !s.macro).map((s) => ({ storage: s.script.storage, pc: s === fr || s === frame() ? (pcOverride ?? fr.pc - 1) : s.pc }));
    VM.savePoint = {
      stack,
      f: JSON.parse(JSON.stringify(VM.fRaw)),
      env: Env.env.store(),
      bgm: Sound.bgm.storage ? { storage: Sound.bgm.storage, loop: Sound.bgm.loop } : (Sound.bgm.paused ? { storage: Sound.bgm.paused.storage, loop: true } : null),
      title: VM.labelTitle,
      showday: VM.showdayStorage,
      frame: UI.frameVisible,
      time: Date.now(),
    };
  }

  async function exec(op, fr) {
    switch (op.t) {
      case "label":
        if (op.title) VM.labelTitle = op.title;
        return;
      case "macro":
        VM.macros.set(op.name, op.body);
        return;
      case "iscript":
        return runIscript(op.code, fr);
      case "name": {
        if (!fr.macro) takeSavePoint(fr);
        VM.selStart = null;
        const wasRead = isRead(fr.script.storage, op.ln);
        VM.curLine = { storage: fr.script.storage, ln: op.ln, read: wasRead };
        if (VM.skipMode && !wasRead && !VM.config.allskip && !VM.skipForce) VM.cancelSkip();
        UI.showWindow();
        const r = await Env.env.dispname(op.name, op.disp);
        VM.currentEntry = { name: op.name ? r.dispName : "", text: "", voice: r.voice, voiceChar: op.name };
        VM.voiceDur = r.dur || 0;
        VM.lineStart = performance.now();
        return;
      }
      case "text": {
        const s = op.s;
        if (VM.currentEntry) VM.currentEntry.text += s;
        UI.showWindow();
        await guard(UI.typeText(s, VM.skipMode ? 0 : VM.config.textSpeed));
        return;
      }
      case "eol":
        return endOfLine(fr, op);
      case "tag":
        return execTag(op, fr);
    }
  }

  async function endOfLine(fr, op) {
    if (VM.currentEntry) {
      VM.backlog.push(VM.currentEntry);
      if (VM.backlog.length > 300) VM.backlog.shift();
      VM.currentEntry = null;
    }
    markRead(fr.script.storage, op.ln);
    UI.showClickWait(true);
    if (VM.skipMode) {
      await guard(new Promise((r) => setTimeout(r, window.AUTOTEST ? 0 : 30)));
    } else if (VM.autoMode) {
      const len = UI.textLength();
      const wait = Math.max(VM.config.autoWait + len * 40, 0);
      await guard(new Promise((res) => {
        let done = false;
        const fin = () => { if (!done) { done = true; res(); } };
        onClick().then(fin);
        const t0 = Render.clock();
        const chk = () => {
          if (done) return;
          if (!VM.autoMode && !VM.skipMode) { onClick().then(fin); return; }
          if (VM.skipMode) return fin();
          if (!Sound.voices.playing && Render.clock() - t0 > wait) return fin();
          setTimeout(chk, 100);
        };
        chk();
      }));
    } else {
      await guard(onClick());
    }
    UI.showClickWait(false);
    UI.clearText();
  }

  // ---------- iscript blocks (hand-ported) ----------
  async function runIscript(code, fr) {
    const G = VM.globals;
    if (code.includes("var practiceinfo")) {
      G.practiceinfo = [...code.matchAll(/file:"([^"]+)",\s*select:"([^"]+)",\s*file2:"([^"]+)"/g)].map((m) => ({ file: m[1], select: m[2], file2: m[3] }));
      G.practicenames = ["tae", "ebi", "nori", "sumi"];
      G.practiceSuccess = () => {
        Sound.se[0].stop(1000);
        VM.fRaw.pracsuccess = VM.fRaw.pracsuccess > 0 ? VM.fRaw.pracsuccess + 1 : 1;
        const p = VM.fRaw.pracsuccess;
        if (p >= 7) VM.sfRaw.bgm_BGM53 = true;
        else if (p >= 6) VM.sfRaw.bgm_BGM55 = true;
        else if (p >= 5) VM.sfRaw.bgm_BGM54 = true;
        else if (p >= 4) VM.sfRaw.bgm_BGM52 = true;
        VM.markSf();
      };
      G.practiceFail = () => Sound.se[0].stop(1000);
      return;
    }
    if (code.includes("f.practiceList === void")) {
      const f = VM.fRaw, info = G.practiceinfo, names = G.practicenames;
      const rnd = (n) => Math.floor(Math.random() * (n + 1));
      if (!Array.isArray(f.practiceList)) f.practiceList = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
      let num, n, guardN = 0;
      do { num = rnd(f.practiceList.length - 1); n = f.practiceList[num]; } while (n >= 12 && !f.sumiAppear && ++guardN < 200);
      f.practiceList.splice(num, 1);
      f.practiceSound = info[n].file;
      f.practiceImage = info[n].file2;
      const base = n % 4, basename = "*" + names[Math.floor(n / 4)];
      f.practice = [info[n].select]; f.practarget = [basename + "_success"]; f.pracexp = ["practiceSuccess()"];
      const add = (k) => { f.practice.push(info[k].select); f.practarget.push(basename + "_fail"); f.pracexp.push("practiceFail()"); };
      if (n >= 12) add(Math.floor(n / 4) * 4 + ((base + 1) % 2));
      else { add(Math.floor(n / 4) * 4 + ((base + 3) % 4)); add(Math.floor(n / 4) * 4 + ((base + 1) % 4)); }
      f.pracCount = f.practice.length;
      for (let i = 0; i < 10; i++) {
        const a = rnd(f.pracCount - 1), b = rnd(f.pracCount - 1);
        if (a !== b) for (const k of ["practice", "practarget", "pracexp"]) [f[k][a], f[k][b]] = [f[k][b], f[k][a]];
      }
      return;
    }
    console.warn("unsupported iscript", fr.script.storage, code.slice(0, 80));
  }

  // ---------- tags ----------
  const T = {};
  const num = (v, d) => (v === undefined || v === true || v === "" ? d : +v);
  const bool = (v, d) => (v === undefined ? d : v === true || v === "true" || v === "1" || v === 1);

  T.if = (e, fr) => { if (!VM.evalExp(e.exp, fr.mp)) skipIf(fr, "cond"); };
  T.elsif = (e, fr) => skipIf(fr, "end");
  T.else = (e, fr) => skipIf(fr, "end");
  T.endif = () => {};
  T.ignore = (e, fr) => { if (VM.evalExp(e.exp, fr.mp)) { while (fr.pc < fr.ops.length) { const o = fr.ops[fr.pc++]; if (o.t === "tag" && o.name === "endignore") break; } } };
  T.endignore = () => {};
  T.eval = (e, fr) => { VM.evalExp(e.exp, fr.mp); };
  T.emb = async (e, fr) => {
    const v = VM.evalExp(e.exp, fr.mp);
    const s = v === undefined || v === null ? "" : String(v);
    if (VM.currentEntry) VM.currentEntry.text += s;
    await guard(UI.typeText(s, VM.skipMode ? 0 : VM.config.textSpeed));
  };
  T["主人公名前"] = (e, fr) => T.emb({ exp: "f.name" }, fr);
  T["主人公苗字"] = (e, fr) => T.emb({ exp: "f.family" }, fr);
  T.jump = (e) => {
    if (e.storage && /^title(\.ks)?$/i.test(e.storage)) { VM.flushSf(); return UI.backToTitle(); }
    jumpTo(e.storage, e.target, false);
  };
  T.call = (e) => {
    if (e.storage && /^title(\.ks)?$/i.test(e.storage)) return UI.backToTitle();
    jumpTo(e.storage, e.target, true);
  };
  T.return = () => { if (VM.stack.length > 1) VM.stack.pop(); };
  T.s = () => guard(new Promise(() => {}));
  T.r = () => UI.typeText("\n", 0);
  T.l = async () => { UI.showClickWait(true); if (!VM.skipMode) await guard(onClick()); UI.showClickWait(false); };
  T.p = async () => { await T.l(); UI.clearText(); };
  T.er = T.ct = T.cm = () => UI.clearText();
  T.wait = (e) => VM.waitTime(num(e.time, 0), bool(e.canskip, true));
  T.waitclick = (e, fr) => { if (e.cond === undefined || VM.evalExp(e.cond, fr.mp)) return VM.waitClick(); };
  T.wt = () => VM.waitTransition(VM.lastTrans);
  T.wact = () => waitActions();
  T.wm = T.wact;
  T.cancelskip = () => VM.cancelSkip();
  T.beginskip = () => {};
  T.endskip = () => {};
  T.breakskip = () => {};
  // env
  T.begintrans = () => Env.env.beginTrans();
  T.endtrans = (e) => Env.env.endTrans(e);
  T.newlay = (e, fr, list) => Env.env.newLayer(e, list);
  T.newchar = async (e, fr, list) => { const ch = Env.env.getCharacter(e.name, e.initname); if (ch) await ch.tagfunc(e, list.filter(([k]) => k !== "name" && k !== "initname")); };
  T.env = (e, fr, list) => Env.env.tagfunc(e, list);
  T.quake = (e) => { Render.startQuake(e.time, e.hmax, e.vmax); };
  T.stopaction = (e, fr, list) => { const n = list.find(([k, v]) => v === true && k !== "layer"); Env.env.stopAction(n ? n[0] : e.layer); };
  T.clearlayers = (e) => { if (e.page === "back") Render.freeze(); Env.env.clearLayers(); UI.hideWindowTemp(); };
  T.backlay = () => Render.freeze();
  T.trans = (e) => {
    const tr = Object.assign({}, e);
    if (!tr.method) tr.method = tr.rule ? "universal" : "crossfade";
    VM.lastTrans = Render.transition(tr);
  };
  // audio
  T.playbgm = (e) => { Sound.bgm.play(e.storage, { loop: bool(e.loop, true) }); };
  T.fadeinbgm = (e) => { Sound.bgm.play(e.storage, { loop: bool(e.loop, true), fadein: VM.skipMode ? 0 : num(e.time, 1000) }); };
  T.fadeoutbgm = (e) => { Sound.bgm.stop(VM.skipMode ? 0 : num(e.time, 1000)); };
  T.stopbgm = () => Sound.bgm.stop(0);
  T.fadebgm = (e) => Sound.bgm.fade(num(e.volume, 100) / 100, VM.skipMode ? 0 : num(e.time, 1000));
  T.pausebgm = () => Sound.bgm.pause(0);
  T.fadepausebgm = (e) => Sound.bgm.pause(VM.skipMode ? 0 : num(e.time, 1000));
  T.resumebgm = (e) => Sound.bgm.resume(num(e.time, 0));
  T.wb = () => {};
  T.wl = () => {};
  const seTrack = (e) => Sound.se[Math.min(9, num(e.buf, 0))];
  T.playse = (e) => { seTrack(e).play(e.storage, { loop: bool(e.loop, false) }); };
  T.fadeinse = (e) => { seTrack(e).play(e.storage, { loop: bool(e.loop, false), fadein: VM.skipMode ? 0 : num(e.time, 1000) }); };
  T.fadeoutse = (e) => seTrack(e).stop(VM.skipMode ? 0 : num(e.time, 1000));
  T.stopse = (e) => seTrack(e).stop(0);
  T.fadese = (e) => seTrack(e).fade(num(e.volume, 100) / 100, num(e.time, 0));
  T.ws = (e) => {
    const t = seTrack(e);
    if (VM.skipMode) { if (!t.loop) t.stop(0); return; }
    return guard(new Promise((res) => {
      if (bool(e.canskip, true)) onClick().then(res);
      t.waitEnd().then(res);
    }));
  };
  T.seopt = T.bgmopt = () => {};
  // ui-ish
  T.position = (e) => {
    if (e.layer && e.layer !== "message0") return;
    if (e.frame !== undefined) UI.setFrame(e.frame !== "" && e.frame !== true);
    if (e.visible !== undefined) { if (bool(e.visible)) UI.showWindow(); else UI.hideWindowTemp(); }
  };
  T.layopt = (e) => { if ((e.layer || "").startsWith("message") && e.visible !== undefined && !bool(e.visible)) UI.hideWindowTemp(); };
  for (const n of ["current", "locate", "csysbutton", "sysbutton", "history", "rclick", "clearhistory", "linemode", "autolabelmode", "laycount",
    "clickskip", "font", "deffont", "resetfont", "style", "defstyle", "resetstyle", "nowait", "endnowait", "delay", "init", "startanchor", "commit",
    "loadplugin", "selopt", "mselopt", "mselbutton", "mselpos", "sakurainit", "sakurauninit", "stopvideo", "editfont", "clearvar", "timeout", "hch", "ruby", "graph", "endhact", "hact"]) T[n] = T[n] || (() => {});
  T.showday = async (e) => { VM.showdayStorage = e.storage; await UI.showDay(e.storage); };
  T.hideday = () => { VM.showdayStorage = null; UI.showDay(null); };
  T.sysmovie = async (e) => {
    if (e.state === "play") VM.moviePromise = UI.playMovie(e.storage);
    else if (e.state === "wait") { if (VM.moviePromise) await guard(VM.moviePromise); VM.moviePromise = null; }
    else if (e.state === "end" || e.state === "term") { if (e.state === "end") UI.stopMovie(); }
  };
  // choices
  T.seladd = (e, fr) => {
    if (!VM.selStart) VM.selStart = { fr, pc: fr.pc - 1 };
    if (e.cond !== undefined && !VM.evalExp(e.cond, fr.mp)) return;
    VM.selects.push({ text: e.text, target: e.target, storage: e.storage, exp: e.exp });
  };
  T.select = async (e, fr) => {
    const list = VM.selects;
    VM.selects = [];
    if (VM.selStart && !fr.macro) takeSavePoint(fr, VM.selStart.pc);
    VM.selStart = null;
    VM.cancelSkip();
    if (VM.autoMode) VM.toggleAuto(false);
    UI.hideWindowTemp();
    const i = await guard(UI.showChoices(list.map((s) => s.text)));
    const s = list[i];
    VM.backlog.push({ name: "", text: "→ " + s.text, voice: null });
    if (s.exp) VM.evalExp(s.exp, fr.mp);
    if (s.target || s.storage) jumpTo(s.storage, s.target, false);
  };
  T.mseladd = (e, fr) => {
    if (!VM.selStart) VM.selStart = { fr, pc: fr.pc - 1 };
    if (e.cond !== undefined && !VM.evalExp(e.cond, fr.mp)) return;
    VM.mselects.push({ text: e.text, pos: e.pos, target: e.target, storage: e.storage, exp: e.exp });
  };
  T.mselect = async (e, fr) => {
    const list = VM.mselects;
    VM.mselects = [];
    if (VM.selStart && !fr.macro) takeSavePoint(fr, VM.selStart.pc);
    VM.selStart = null;
    VM.cancelSkip();
    if (VM.autoMode) VM.toggleAuto(false);
    UI.hideWindowTemp();
    const i = await guard(UI.showMapSelect(list));
    const s = list[i];
    VM.backlog.push({ name: "", text: "→ " + s.text, voice: null });
    if (s.exp) VM.evalExp(s.exp, fr.mp);
    if (s.target || s.storage) jumpTo(s.storage, s.target, false);
  };

  async function execTag(op, fr) {
    const { elm, list } = attrsObj(op.attrs, fr.mp);
    const name = op.name;
    if (elm.cond !== undefined && name !== "seladd" && name !== "mseladd" && name !== "waitclick" && !VM.evalExp(elm.cond, fr.mp)) return;
    const h = T[name];
    if (h && (name === "主人公名前" || name === "主人公苗字" || !VM.macros.has(name))) return h(elm, fr, list);
    const m = VM.macros.get(name);
    if (m) {
      VM.stack.push({ script: fr.script, ops: m, pc: 0, mp: elm, macro: true });
      return;
    }
    if (h) return h(elm, fr, list);
    const handled = await Env.env.unknown(name, elm, list);
    if (!handled) console.warn("unknown tag", name, fr.script.storage, op.ln);
  }

  // ---------- new game / save / load ----------
  VM.resetGameVars = function () {
    VM.fRaw = {};
    VM.f = vars(VM.fRaw);
    VM.tfRaw = {};
    VM.tf = vars(VM.tfRaw);
    VM.backlog = [];
    VM.selects = []; VM.mselects = []; VM.selStart = null;
    VM.skipMode = false; VM.autoMode = false;
  };
  VM.boot = async function () {
    // load macro definitions and plugin data once
    VM.resetGameVars();
    for (const s of ["macro.ks", "practice.ks"]) {
      const scr = getScript(s);
      VM.stack = [{ script: scr, ops: scr.ops, pc: 0, mp: null }];
      const gen = VM.gen;
      // run definitions until the first [return]
      while (VM.stack.length && frame().pc < frame().ops.length && gen === VM.gen) {
        const fr = frame();
        const op = fr.ops[fr.pc];
        if (op.t === "tag" && op.name === "return" && VM.stack.length === 1) break;
        fr.pc++;
        if (op.t === "macro" || op.t === "iscript") await exec(op, fr);
        else if (op.t === "tag" && (op.name === "if" || op.name === "endif" || op.name === "else")) { if (op.name === "if") { const { elm } = attrsObj(op.attrs); if (!VM.evalExp(elm.exp)) skipIf(fr, "cond"); } }
      }
    }
    VM.stack = [];
  };
  VM.newGame = async function (family, name, practicemode) {
    VM.resetGameVars();
    Object.assign(VM.fRaw, { tae_flag: 0, ebi_flag: 0, nori_flag: 0, sumi_flag: 0, yuki_flag: 0, alone_flag: 0, ebi_haru_flag: 0, ebi_10_day: 0, kyou_flag: 0 });
    VM.fRaw.family = family; VM.fRaw.name = name;
    VM.sfRaw.family = family; VM.sfRaw.name = name;
    VM.fRaw.practicemode = practicemode ? 1 : 0;
    VM.markSf();
    Env.env.init();
    Render.unfreeze();
    UI.resetGameUI();
    VM.start("01.ks");
  };
  VM.makeSaveData = function () {
    if (!VM.savePoint) return null;
    return Object.assign({}, VM.savePoint, { thumb: Render.thumbnail(), text: UI.currentTextPreview() });
  };
  VM.saveSlot = function (slot) {
    const d = VM.makeSaveData();
    if (!d) return false;
    Store.set("save" + slot, d);
    const idx = Store.get("saveindex") || {};
    idx[slot] = { title: d.title, time: d.time, thumb: d.thumb, text: d.text };
    Store.set("saveindex", idx);
    return true;
  };
  VM.loadSlot = async function (slot) {
    const d = Store.get("save" + slot);
    if (!d) return false;
    await VM.restore(d);
    return true;
  };
  VM.quickSave = function () { if (VM.saveSlot("q")) UI.toast("クイックセーブしました"); };
  VM.quickLoad = function () { VM.loadSlot("q").then((ok) => { if (!ok) UI.toast("クイックセーブがありません"); }); };
  VM.restore = async function (d) {
    VM.abort();
    VM.resetGameVars();
    Object.assign(VM.fRaw, JSON.parse(JSON.stringify(d.f)));
    Sound.voices.stop();
    Sound.se.forEach((t) => t.stop(0));
    Render.unfreeze();
    Render.finishAll();
    UI.resetGameUI();
    await Env.env.restore(d.env);
    if (d.bgm && d.bgm.storage) { if (Sound.bgm.storage !== d.bgm.storage) Sound.bgm.play(d.bgm.storage, { loop: d.bgm.loop !== false }); }
    else Sound.bgm.stop(0);
    VM.showdayStorage = d.showday || null;
    await UI.showDay(VM.showdayStorage);
    UI.setFrame(d.frame !== false);
    VM.labelTitle = d.title || "";
    VM.stack = d.stack.map((s) => { const scr = getScript(s.storage); return { script: scr, ops: scr.ops, pc: s.pc, mp: null }; });
    VM.savePoint = d;
    VM.run();
  };

  VM.getScript = getScript;
})();
