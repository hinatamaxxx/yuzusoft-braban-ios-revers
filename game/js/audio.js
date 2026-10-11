// BGM / SE / voice playback with Web Audio.
// iOS can leave an AudioContext "interrupted"/"suspended" after the app is backgrounded or a call
// comes in; recover() resumes it and, if that does not work, rebuilds the context and restarts loops.
(function () {
  // ---------- native (iOS app): AVAudioEngine does the playback ----------
  const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.audio;
  if (bridge) {
    const cfg = { bgm: 0.8, se: 1.0, voice: 1.0 };
    const post = (m) => { try { return Promise.resolve(bridge.postMessage(m)).catch(() => 0); } catch (e) { return Promise.resolve(0); } };
    const all = {};
    class NativeTrack {
      constructor(name) { this.name = name; this.src = null; this.storage = null; this.loop = false; this.token = 0; this.paused = null; all[name] = this; }
      get playing() { return !!this.src; }
      play(storage, opt = {}) {
        const tok = ++this.token;
        const path = Assets.url(storage);
        this.paused = null;
        if (!path) { this.storage = null; this.src = null; return Promise.resolve(0); }
        this.storage = storage;
        this.loop = !!opt.loop;
        this.src = tok;
        const lp = opt.loop ? (window.LOOPS || {})[String(storage).toLowerCase().replace(/\.ogg$/, "")] : null;
        const m = { cmd: "play", track: this.name, path, loop: !!opt.loop, volume: opt.volume ?? 1, fadein: opt.fadein || 0, offset: opt.offset || 0, token: tok };
        if (lp && lp[0] > lp[1]) { m.loopStart = lp[1]; m.loopEnd = lp[0]; }
        return post(m).then((d) => {
          if (tok === this.token && !d) { this.src = null; this.storage = null; }
          return d || 0;
        });
      }
      stop(fadeMs = 0) { this.token++; this.src = null; this.storage = null; this.paused = null; post({ cmd: "stop", track: this.name, fade: fadeMs || 0 }); }
      fade(volume, ms) { post({ cmd: "fade", track: this.name, volume, time: ms || 0 }); }
      pause(fadeMs) {
        if (!this.src) return;
        this.paused = { storage: this.storage, loop: this.loop };
        this.src = null;
        post({ cmd: "pause", track: this.name, fade: fadeMs || 0 });
      }
      resume(fadeMs = 0) {
        const p = this.paused;
        if (!p) return;
        this.paused = null;
        this.storage = p.storage; this.loop = p.loop;
        this.src = ++this.token;
        post({ cmd: "resume", track: this.name, fade: fadeMs || 0, token: this.token });
      }
      waitEnd() {
        return new Promise((res) => { const check = () => (this.src ? setTimeout(check, 50) : res()); check(); });
      }
      applyCfg() {}
    }
    const bgm = new NativeTrack("bgm");
    const se = [];
    for (let i = 0; i < 10; i++) se.push(new NativeTrack("se" + i));
    const voices = new NativeTrack("voice");
    const noop = () => {};
    window.Sound = {
      native: true, ctx: null, cfg, bgm, se, voices,
      unlock: noop, suspend: noop, foreground: noop,
      recover: () => post({ cmd: "recover" }),
      // keep playing while the app is only inactive (notification/control center); always pause in background
      setPolicy: () => post({ cmd: "policy", keepWhenInactive: !(VM.config && VM.config.keepAudioInactive === false) }),
      playVoice: (s) => voices.play(s, {}),
      setVolume(kind, v) { cfg[kind] = v; post(Object.assign({ cmd: "cfg" }, cfg)); },
      _ended(name, token) { const t = all[name]; if (t && t.token === token) { t.src = null; if (!t.loop) t.storage = null; } },
    };
    return;
  }

  // ---------- browser: Web Audio ----------
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null, master = null;
  const tracks = [];

  const cfg = { bgm: 0.8, se: 1.0, voice: 1.0 };

  function makeContext() {
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    ctx.onstatechange = () => { if (ctx.state !== "running" && !document.hidden) scheduleRecover(); };
  }
  makeContext();

  function silentTick() {
    try {
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(master);
      s.start(0);
    } catch (e) {}
  }

  // call inside user gestures
  function unlock() {
    if (ctx.state !== "running") {
      // resume() must be called synchronously inside the gesture on iOS
      try { ctx.resume(); } catch (e) {}
      recover(true);
    } else silentTick();
  }

  function ramp(param, to, ms) {
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    if (ms > 0) param.linearRampToValueAtTime(to, now + ms / 1000);
    else param.setValueAtTime(to, now);
  }

  // A track = gain node + current source
  class Track {
    constructor(kind) {
      this.kind = kind;
      this.vol = null; // per-source gain (script volume / fades)
      this.src = null;
      this.storage = null;
      this.loop = false;
      this.token = 0;
      this.paused = null;
      this.attach();
      tracks.push(this);
    }
    attach() {
      this.cfg = ctx.createGain(); // user config volume
      this.cfg.connect(master);
      this.applyCfg();
    }
    applyCfg() { this.cfg.gain.value = cfg[this.kind === "voice" ? "voice" : this.kind === "bgm" ? "bgm" : "se"]; }
    get playing() { return !!this.src; }
    stopSrc() {
      if (this.src) {
        try { this.src.onended = null; this.src.stop(); } catch (e) {}
        try { this.src.disconnect(); } catch (e) {}
        this.src = null;
        if (this.vol) { try { this.vol.disconnect(); } catch (e) {} this.vol = null; }
      }
    }
    async play(storage, opt = {}) {
      const tok = ++this.token;
      this.stopSrc();
      this.paused = null;
      this.storage = storage;
      this.loop = !!opt.loop;
      const buf = await Assets.getAudioBuffer(ctx, storage);
      if (tok !== this.token || !buf) { if (!buf && tok === this.token) this.storage = null; return 0; }
      const s = ctx.createBufferSource();
      s.buffer = buf;
      if (opt.loop) {
        s.loop = true;
        const lp = (window.LOOPS || {})[String(storage).toLowerCase().replace(/\.ogg$/, "")];
        if (lp && lp[0] > lp[1]) {
          s.loopStart = lp[1] / 44100;
          s.loopEnd = Math.min(lp[0] / 44100, buf.duration);
        }
      }
      this.vol = ctx.createGain();
      this.vol.connect(this.cfg);
      s.connect(this.vol);
      const now = ctx.currentTime;
      const volume = opt.volume ?? 1;
      if (opt.fadein) {
        this.vol.gain.setValueAtTime(0, now);
        this.vol.gain.linearRampToValueAtTime(volume, now + opt.fadein / 1000);
      } else {
        this.vol.gain.setValueAtTime(volume, now);
      }
      let offset = opt.offset || 0;
      if (offset >= buf.duration) offset = 0;
      s.start(0, offset);
      this.startedAt = now - offset;
      this.buffer = buf;
      this.src = s;
      this.volume = volume;
      s.onended = () => { if (this.src === s) { this.src = null; this.storage = this.loop ? this.storage : null; } };
      return buf.duration * 1000;
    }
    position() {
      if (!this.src || !this.buffer) return 0;
      let p = ctx.currentTime - this.startedAt;
      const s = this.src;
      if (s.loop && s.loopEnd > s.loopStart && p > s.loopEnd) p = s.loopStart + ((p - s.loopStart) % (s.loopEnd - s.loopStart));
      else if (s.loop && !(s.loopEnd > s.loopStart)) p = p % this.buffer.duration;
      return p;
    }
    stop(fadeMs = 0) {
      this.token++;
      this.paused = null;
      this.storage = null;
      if (!this.src) return;
      if (fadeMs > 0) {
        const s = this.src, g = this.vol;
        this.src = null;
        this.vol = null;
        s.onended = null;
        ramp(g.gain, 0, fadeMs);
        setTimeout(() => { try { s.stop(); s.disconnect(); g.disconnect(); } catch (e) {} }, fadeMs + 50);
      } else this.stopSrc();
    }
    fade(volume, ms) { if (this.vol) { this.volume = volume; ramp(this.vol.gain, volume, ms); } }
    pause(fadeMs) {
      if (!this.src) return;
      const st = { storage: this.storage, loop: this.loop, offset: this.position(), volume: this.vol ? this.vol.gain.value : 1 };
      this.stop(fadeMs);
      this.paused = st;
    }
    resume(fadeMs = 0) {
      const p = this.paused;
      if (!p) return;
      this.play(p.storage, { loop: p.loop, offset: p.offset, fadein: fadeMs || 0, volume: p.volume || 1 });
    }
    // state needed to restart after the context is rebuilt (only looping sounds are restarted)
    snapshot() {
      if (this.src && this.loop && this.storage) return { storage: this.storage, offset: this.position(), volume: this.volume ?? 1 };
      return null;
    }
    waitEnd() {
      return new Promise((res) => {
        const check = () => { if (!this.src) res(); else setTimeout(check, 50); };
        check();
      });
    }
  }

  // ---- recovery ----
  let recovering = false, recoverTimer = null;
  function scheduleRecover() {
    if (recoverTimer) return;
    recoverTimer = setTimeout(() => { recoverTimer = null; recover(false); }, 300);
  }
  function rebuild() {
    const snaps = tracks.map((t) => t.snapshot());
    for (const t of tracks) { t.token++; t.stopSrc(); }
    try { ctx.onstatechange = null; if (ctx.state !== "closed") ctx.close().catch(() => {}); } catch (e) {}
    makeContext();
    for (const t of tracks) t.attach();
    tracks.forEach((t, i) => { const s = snaps[i]; if (s) t.play(s.storage, { loop: true, offset: s.offset, volume: s.volume, fadein: 300 }); });
    silentTick();
  }
  // allowRebuild: true inside a user gesture (or once when the native app becomes active)
  async function recover(allowRebuild = false) {
    if (recovering) return;
    recovering = true;
    try {
      if (ctx.state === "closed") { rebuild(); return; }
      if (ctx.state !== "running") {
        const r = ctx.resume();
        await Promise.race([r.catch(() => {}), new Promise((res) => setTimeout(res, 400))]);
      }
      if (ctx.state !== "running" && allowRebuild) rebuild();
      else if (ctx.state === "running") silentTick();
    } finally {
      recovering = false;
    }
  }
  // Do not suspend explicitly: on iOS a context we suspended may refuse to resume without a gesture.
  function suspend() {}

  // After the screen is locked/unlocked iOS can report "running" while producing no sound,
  // so returning to the foreground always rebuilds the context (loops restart where they were).
  let lastRebuild = 0;
  function foreground() {
    setTimeout(() => {
      if (performance.now() - lastRebuild < 1000) return;
      lastRebuild = performance.now();
      rebuild();
    }, 400);
  }

  // watchdog: a "running" context whose clock does not advance is dead
  let lastTime = -1, stalls = 0;
  setInterval(() => {
    if (document.hidden) { lastTime = -1; return; }
    const t = ctx.currentTime;
    if (ctx.state === "running" && t === lastTime) {
      if (++stalls >= 2) { stalls = 0; lastRebuild = performance.now(); rebuild(); }
    } else stalls = 0;
    lastTime = ctx.state === "running" ? t : -1;
  }, 1000);

  const bgm = new Track("bgm");
  const se = [];
  for (let i = 0; i < 10; i++) se.push(new Track("se"));
  const voices = new Track("voice");

  function setVolume(kind, v) {
    cfg[kind] = v;
    tracks.forEach((t) => t.applyCfg());
  }

  async function playVoice(storage) {
    return voices.play(storage, {});
  }

  window.Sound = { get ctx() { return ctx; }, unlock, recover, suspend, foreground, setPolicy: () => {}, bgm, se, voices, playVoice, setVolume, cfg };
})();
