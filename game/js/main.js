(async function () {
  const $ = (id) => document.getElementById(id);
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
    UI.init();
    Render.init($("cv"), () => VM.isSkip());
    VM.loadSystem();
    const info = TJS.parse(window.SCRIPTS["envinit.tjs"]);
    new Env.Environment(info);
    await VM.boot();
  } catch (e) {
    console.error(e);
    $("boottap").textContent = "起動エラー: " + e.message;
    return;
  }
  const tap = $("boottap");
  tap.textContent = "タップしてスタート";
  const go = () => {
    Sound.unlock();
    $("boot").remove();
    UI.showTitle();
  };
  $("boot").addEventListener("click", go, { once: true });
  const save = () => { try { VM.flushSf(); } catch (e) {} };
  // pause the whole game (clock, script, typing, movie); the native app calls this for the
  // app switcher / home, the browser on tab hide
  window.__gamePause = (on) => {
    on = !!on;
    if (VM.paused === on) return;
    VM.paused = on;
    Render.setPaused(on);
    const v = $("movie");
    if (!v.classList.contains("hidden")) { if (on) v.pause(); else v.play().catch(() => {}); }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { save(); window.__gamePause(true); }
    else { window.__gamePause(false); Sound.foreground(); }
  });
  window.addEventListener("pageshow", (e) => { if (e.persisted) Sound.foreground(); });
  // any touch anywhere re-enables audio after an interruption
  document.addEventListener("pointerdown", () => Sound.unlock(), true);
  document.addEventListener("touchend", () => Sound.unlock(), true);
  // called by the native app on becoming active / after an audio-session interruption ends
  window.__appActive = () => Sound.foreground();
  window.__appInactive = () => save();
  window.addEventListener("pagehide", save);
  // automated playthrough: ?autotest=<heroine name or "random">
  const at = /[?&]autotest=([^&]+)/.exec(location.search);
  if (at) {
    const target = decodeURIComponent(at[1]);
    window.__log = [];
    const ow = console.warn, oe = console.error;
    console.warn = (...a) => { window.__log.push("W " + a.map(String).join(" ")); ow(...a); };
    console.error = (...a) => { window.__log.push("E " + a.map(String).join(" ")); oe(...a); };
    window.addEventListener("error", (e) => window.__log.push("E " + e.message));
    window.AUTOTEST = {
      picks: [],
      pick(n, texts) {
        let i = texts.findIndex((t) => t && t.includes(target));
        if (i < 0) i = Math.floor(Math.random() * n);
        this.picks.push(texts[i]);
        return i;
      },
    };
    VM.cancelSkip = () => {};
    VM.config.allskip = true;
    UI.backToTitle = () => { window.__done = { label: VM.labelTitle, at: VM.stack.map((s) => s.script.storage + ":" + s.pc), f: VM.fRaw }; VM.abort(); };
    $("boot").remove();
    VM.newGame("香住", "純", false);
    VM.skipMode = true;
    return;
  }
  // debug helper for desktop testing: ?jump=03.ks*label
  const m = /[?&]jump=([^&]+)/.exec(location.search);
  if (m) {
    const [st, lb] = decodeURIComponent(m[1]).split("*");
    $("boot").remove();
    VM.resetGameVars();
    Object.assign(VM.fRaw, { family: "香住", name: "純", practicemode: 1, tae_flag: 0, ebi_flag: 0, nori_flag: 0, sumi_flag: 0, yuki_flag: 0 });
    UI.resetGameUI();
    VM.start(st, lb);
  }
})();
