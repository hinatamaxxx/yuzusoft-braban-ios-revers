// DOM user interface: message window, choices, map select, menus, title screen.
(function () {
  const $ = (id) => document.getElementById(id);
  const A = (n) => Assets.url(n) || "";
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const UI = {
    windowShown: false, userHidden: false, frameVisible: true,
    typing: null, inGame: false, overlayOpen: false,
  };
  window.UI = UI;

  // ---------------- layout ----------------
  // "classic": the original 800x600 screen (iPad, desktop).
  // "compact": phones; same screen and message window, plus large touch buttons in the side margins.
  function layoutMode() {
    const want = (VM.config && VM.config.layout) || "auto";
    if (want === "compact" || want === "classic") return want;
    const vw = window.innerWidth, vh = window.innerHeight;
    return vw / vh >= 1.5 && Math.min(vw, vh) < 600 ? "compact" : "classic";
  }
  function safe(side) {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--sa" + side);
    return parseFloat(v) || 0;
  }
  let currentMode = null;
  function fit() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const sl = safe("l"), sr = safe("r");
    const cfg = VM.config || {};
    let compact = layoutMode() === "compact" && UI.inGame;
    // default: only the corner (︙) button; "side" adds the big side-bar buttons
    const sideButtons = compact && cfg.menuStyle === "side";
    let s = Math.min(vw / 800, vh / 600);
    let left = (vw - 800 * s) / 2;
    document.body.classList.toggle("sideblack", cfg.sideStyle !== "color"); // default: black
    document.body.classList.toggle("showicons", cfg.showIcons === true); // default: text only
    document.body.classList.toggle("ingame", !!UI.inGame);
    // the original small buttons on the message window (kept on phones unless turned off)
    // "none" = original style: only the message-window buttons, so they are always shown then
    const noMenu = cfg.menuStyle === "none";
    document.body.classList.toggle("nosysbtns", compact && cfg.origButtons === false && !noMenu);
    // the corner (︙) menu is always available in game
    // the corner (︙) menu is shown on the title screen and in game
    $("cornerbtn").classList.toggle("hidden", !UI.booted || noMenu);
    if (noMenu) $("cornermenu").classList.add("hidden");
    $("sideL").classList.toggle("hidden", !sideButtons);
    $("sideR").classList.toggle("hidden", !sideButtons);
    document.body.classList.toggle("sidebtns", sideButtons);
    if (sideButtons) {
      // keep ~110px on each side for the (big) buttons; the scene shrinks a little if needed
      const minSide = 110;
      const maxW = vw - sl - sr - 2 * (minSide + 8);
      if (800 * s > maxW) s = Math.max(0.3, maxW / 800);
      left = (vw - 800 * s) / 2;
      const L = $("sideL"), R = $("sideR");
      L.style.left = sl + 6 + "px"; L.style.width = left - sl - 12 + "px";
      R.style.right = sr + 6 + "px"; R.style.width = vw - (left + 800 * s) - sr - 12 + "px";
    }
    $("stage").style.transform = `translate(${left}px, ${(vh - 600 * s) / 2}px) scale(${s})`;
    // the blurred background covers the whole screen with the scene's 4:3 aspect
    const bs = Math.max(vw / 800, vh / 600) * 1.15;
    const bb = $("bgblur");
    bb.style.width = 800 * bs + "px"; bb.style.height = 600 * bs + "px";
    bb.style.left = (vw - 800 * bs) / 2 + "px"; bb.style.top = (vh - 600 * bs) / 2 + "px";
    UI.scale = s;
    const mode = compact ? "compact" : "classic";
    if (mode !== currentMode) {
      currentMode = mode;
      document.body.classList.toggle("compact", compact);
    }
    applyTextSize();
    if (sideButtons) requestAnimationFrame(fitSideButtons);
  }

  // Side buttons: each takes a quarter of the side bar; the original treble-clef bar sits in the middle
  // with the label text on it. Both bars use the same (smaller) slot so they look identical.
  function fitSideButtons() {
    let minFs = 99;
    const sides = [$("sideL"), $("sideR")];
    const slotOf = (side) => {
      const cs = getComputedStyle(side);
      const innerH = side.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const gap = parseFloat(cs.rowGap) || 8;
      return Math.max(48, Math.min(110, (innerH - gap * 3) / 4));
    };
    const slot = Math.min(...sides.map(slotOf));
    for (const side of sides) {
      const cs = getComputedStyle(side);
      const sideW = side.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      side.style.setProperty("--slot", slot + "px");
      // the bar ends keep their aspect, so the bar must fit the side width: (0.6875 + 0.5625) * bh <= width
      side.style.setProperty("--side-bh", Math.min(56, slot * 0.6, sideW / 1.3) + "px");
      for (const b of side.querySelectorAll(".pbtn")) {
        const ico = b.querySelector(".ico"), span = b.querySelector("span"), lbl = b.querySelector(".lbl");
        const bh = parseFloat(side.style.getPropertyValue("--side-bh")) || 50;
        // the glass part of the bar, between the treble clef (left) and the round end (right)
        const inner = sideW - bh * (0.6875 + 0.5625);
        if (lbl) {
          // label image (Save / Load ...) sits as a background layer behind the translucent bar,
          // filling its glass part (between the treble clef and the round end)
          const nw = lbl.naturalWidth || 60, nh = lbl.naturalHeight || 17;
          const w = Math.min(inner + bh * 0.35, (bh * 0.62 * nw) / nh);
          lbl.style.width = w + "px";
          lbl.style.height = (w * nh) / nw + "px";
          lbl.style.marginLeft = bh * (0.6875 - 0.5625) + "px";
        }
        if (span) {
          // text (plus a small icon on its left when enabled), as large as fits the bar
          const withIcon = ico && document.body.classList.contains("showicons");
          b.style.flexDirection = "row";
          b.style.gap = withIcon ? "3px" : "0";
          span.style.marginTop = "0";
          span.style.marginLeft = withIcon ? "0" : bh * (0.6875 - 0.5625) + "px";
          if (ico) {
            ico.style.height = Math.min(19, bh * 0.4) + "px";
            ico.style.width = "auto";
            ico.style.marginLeft = bh * (0.6875 - 0.5625) + "px";
          }
          const iw = withIcon ? ico.offsetWidth + 3 : 0;
          let fs = Math.min(17, bh * 0.4);
          span.style.fontSize = fs + "px";
          while (span.offsetWidth + iw > sideW * (withIcon ? 0.92 : 0.8) && fs > 9) span.style.fontSize = --fs + "px";
          minFs = Math.min(minFs, fs);
        }
      }
    }
    // same text size on both bars
    if (minFs < 99) for (const sp of document.querySelectorAll(".side .pbtn span")) sp.style.fontSize = minFs + "px";
  }

  // ---------------- text size ----------------
  // level 0..3 (標準/大/特大/最大). Phones start one step larger. The text block moves up inside the
  // original window as it grows, and a line that would still overflow is shrunk to fit.
  const TEXT_SIZES = [21, 24, 27, 30];
  let textPx = 21;
  function applyTextSize() {
    const lv = VM.config && VM.config.textSize !== undefined ? +VM.config.textSize : (currentMode === "compact" ? 3 : 0);
    textPx = TEXT_SIZES[Math.max(0, Math.min(3, lv))];
    const grow = textPx - 21;
    // don't let the first line run under the original buttons (y 58-81) when they are shown
    const sysShown = !document.body.classList.contains("nosysbtns");
    const top = Math.max(sysShown ? 84 : 70, 94 - grow * 2);
    const t = $("text"), n = $("name");
    t.style.top = top + "px";
    t.style.height = 200 - 6 - top + "px";
    t.style.lineHeight = Math.round(textPx * 1.28) + "px";
    n.style.top = top - 30 + "px";
    n.style.fontSize = Math.min(26, textPx) + "px";
    fitText();
  }
  // shrink the current text until it fits in the window
  function fitText() {
    const t = $("text");
    let fs = textPx;
    t.style.fontSize = fs + "px";
    const max = parseFloat(t.style.height) || 90;
    while (t.scrollHeight > max + 2 && fs > 16) {
      fs--;
      t.style.fontSize = fs + "px";
      t.style.lineHeight = Math.round(fs * 1.28) + "px";
    }
    if (fs === textPx) t.style.lineHeight = Math.round(textPx * 1.28) + "px";
  }
  function overflowCheck(t) { if (t.scrollHeight > (parseFloat(t.style.height) || 90) + 2) fitText(); }
  UI.applyTextSize = applyTextSize;
  UI.relayout = fit;
  UI.isCompact = () => currentMode === "compact";
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", () => setTimeout(fit, 200));

  // ---------------- message window ----------------
  const SYSBTNS = [
    ["back", 609, 58, "message_backbeforechoice", () => UI.openBacklog()],
    ["log", 636, 58, "message_backlog", () => UI.openBacklog()],
    ["auto", 665, 58, "message_automode", () => VM.toggleAuto()],
    ["skip", 695, 58, "message_skipmode", () => VM.toggleSkip()],
    ["hide", 725, 58, "message_hidewindow", () => UI.toggleHide()],
    ["qsave", 469, 178, "message_quicksave", () => VM.quickSave()],
    ["qload", 534, 178, "message_quickload", () => UI.confirm("クイックロードしますか？").then((ok) => ok && VM.quickLoad())],
    ["save", 593, 178, "message_save", () => UI.openMenu("save")],
    ["load", 647, 178, "message_load", () => UI.openMenu("load")],
    ["system", 703, 178, "message_system", () => UI.openMenu("system")],
  ];
  // large touch buttons of the phone side panel
  // [id, original icon (or label image), text label or null, action]
  const PANELBTNS = [
    ["auto", "message_automode", "オート", () => VM.toggleAuto()],
    ["skip", "message_skipmode", "スキップ", () => VM.toggleSkip()],
    ["log", "message_backlog", "ログ", () => UI.openBacklog()],
    ["hide", "message_hidewindow", "隠す", () => UI.toggleHide()],
    ["qsave", null, "Qセーブ", () => VM.quickSave()],
    ["qload", null, "Qロード", () => UI.confirm("クイックロードしますか？").then((ok) => ok && VM.quickLoad())],
    ["save", null, "セーブ", () => UI.openMenu("save")],
    ["system", null, "システム", () => UI.openMenu("system")],
  ];
  // original small icon (auto / skip / log / hide); hidden by CSS unless "ボタンのアイコン" is on
  const iconHtml = (img) => (img
    ? `<img class="ico" src="${A(img + "_normal")}" data-on="${A(img + "_on") || A(img + "_over")}" data-off="${A(img + "_normal")}">`
    : "");
  function buildMsg() {
    $("msgframe").src = A("messagewindow");
    $("clickwait").src = A("clickwait");
    const box = $("sysbtns");
    for (const [id, x, y, img, fn] of SYSBTNS) {
      const b = el("img");
      b.id = "sb_" + id;
      b.src = A(img + "_normal");
      b.dataset.normal = A(img + "_normal");
      b.dataset.over = A(img + "_over");
      b.dataset.on = A(img + "_on") || A(img + "_over");
      b.style.left = x + "px"; b.style.top = y + "px";
      b.addEventListener("pointerdown", (e) => { e.stopPropagation(); b.src = b.dataset.over; });
      b.addEventListener("pointerup", (e) => { e.stopPropagation(); UI.updateModes(); if (UI.inGame && !UI.overlayOpen) fn(); });
      b.addEventListener("pointerleave", () => UI.updateModes());
      box.appendChild(b);
    }
    PANELBTNS.forEach(([id, img, label, fn], i) => {
      // text, with the original small icon in front when "ボタンのアイコン" is on
      const b = el("button", "pbtn", iconHtml(img) + `<span>${label}</span>`);
      b.id = "pb_" + id;
      b.querySelectorAll("img").forEach((im) => im.addEventListener("load", () => { if (document.body.classList.contains("sidebtns")) requestAnimationFrame(fitSideButtons); }));
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      b.addEventListener("pointerup", (e) => { e.stopPropagation(); if (UI.inGame && !UI.overlayOpen) fn(); });
      $(i < 4 ? "sideL" : "sideR").appendChild(b);
    });
    // corner (︙) menu: same original-styled buttons in a drop-down list
    const cm = $("cornermenu");
    const items = PANELBTNS.concat([
      ["load", null, "ロード", () => UI.openMenu("load")],
      ["config", null, "設定", () => UI.openMenu("config")],
      ["title", null, "タイトルへ", () => UI.confirm("タイトルに戻りますか？").then((ok) => ok && UI.backToTitle())],
    ]);
    for (const [id, img, label, fn] of items) {
      // same as the side bars: text, optional icon
      const b = el("button", "pbtn", iconHtml(img) + `<span>${label}</span>`);
      b.id = "cm_" + id;
      // on the title screen only load / settings make sense
      const anywhere = id === "load" || id === "config";
      b.dataset.scope = anywhere ? "any" : "game";
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      b.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        cm.classList.add("hidden");
        if (UI.overlayOpen) return;
        if (UI.inGame || anywhere) fn();
      });
      cm.appendChild(b);
    }
    const cb = $("cornerbtn");
    cb.addEventListener("pointerdown", (e) => e.stopPropagation());
    cb.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      if (!UI.booted || UI.overlayOpen) return;
      for (const b of cm.children) b.classList.toggle("hidden", !UI.inGame && b.dataset.scope !== "any");
      cm.classList.toggle("hidden");
      UI.updateModes();
    });
  }
  UI.updateModes = function () {
    for (const [id] of SYSBTNS) {
      const b = $("sb_" + id);
      if (!b) continue;
      const on = (id === "auto" && VM.autoMode) || (id === "skip" && VM.skipMode);
      b.src = on ? b.dataset.on : b.dataset.normal;
      b.classList.toggle("on", on);
    }
    for (const id of ["auto", "skip", "hide"]) {
      const on = (id === "auto" && VM.autoMode) || (id === "skip" && VM.skipMode) || (id === "hide" && UI.userHidden);
      for (const b of [$("pb_" + id), $("cm_" + id)]) {
        if (!b) continue;
        b.classList.toggle("on", on);
        const ico = b.querySelector(".ico");
        if (ico) ico.src = on ? ico.dataset.on : ico.dataset.off;
      }
    }
  };
  function applyMsgVisibility() {
    $("msg").classList.toggle("hidden", !(UI.windowShown && !UI.userHidden));
    $("hidecover").classList.toggle("hidden", !UI.userHidden);
    UI.updateModes && UI.updateModes();
  }
  UI.showWindow = function () { if (!UI.windowShown) { UI.windowShown = true; applyMsgVisibility(); } };
  UI.hideWindowTemp = function () { UI.windowShown = false; applyMsgVisibility(); };
  UI.toggleHide = function () { UI.userHidden = !UI.userHidden; applyMsgVisibility(); };
  UI.setFrame = function (on) { UI.frameVisible = on; $("msg").classList.toggle("noframe", !on); };
  UI.setName = function (n) { $("name").textContent = n ? "【" + n + "】" : ""; };
  UI.setFace = function (img) {
    const f = $("face");
    if (img) { f.src = img.src; f.style.display = "block"; }
    else { f.style.display = "none"; f.removeAttribute("src"); }
  };
  UI.clearText = function () { const t = $("text"); t.textContent = ""; t.style.fontSize = textPx + "px"; t.style.lineHeight = Math.round(textPx * 1.28) + "px"; UI.showClickWait(false); };
  UI.textLength = function () { return $("text").textContent.length; };
  UI.currentTextPreview = function () {
    const n = $("name").textContent, t = $("text").textContent;
    return (n + t).slice(0, 60);
  };
  UI.showClickWait = function (on) {
    const c = $("clickwait");
    if (!on) { c.style.display = "none"; return; }
    c.style.display = "block";
    if (currentMode !== "compact") { c.style.left = "752px"; c.style.top = "160px"; }
    else { c.style.left = ""; c.style.top = ""; }
  };
  UI.typeText = function (s, speed) {
    const t = $("text");
    if (!speed || speed <= 0) { t.textContent += s; overflowCheck(t); return Promise.resolve(); }
    return new Promise((res) => {
      let i = 0;
      const chars = Array.from(s);
      const st = { finish: () => { t.textContent += chars.slice(i).join(""); i = chars.length; overflowCheck(t); done(); } };
      let timer = null;
      const done = () => { if (timer) clearTimeout(timer); UI.typing = null; res(); };
      const step = () => {
        if (Render.paused) { timer = setTimeout(step, 100); return; } // typing waits while paused
        if (i >= chars.length) return done();
        t.textContent += chars[i++];
        overflowCheck(t);
        timer = setTimeout(step, VM.skipMode ? 0 : speed);
      };
      UI.typing = st;
      step();
    });
  };

  // ---------------- input ----------------
  function gameTap() {
    if (!UI.inGame || UI.overlayOpen) return;
    Sound.unlock();
    if (UI.userHidden) { UI.toggleHide(); return; }
    if (VM.skipMode) { VM.toggleSkip(false); return; }
    if (VM.autoMode) { VM.toggleAuto(false); }
    if (UI.typing) { UI.typing.finish(); return; }
    if (UI.choiceOpen) return;
    VM.click();
  }
  const NO_TAP = "#overlay, #title, #choices, #map, #sysbtns, #cgview, .pbtn, #cornerbtn, #cornermenu, #boot, input, button";
  function setupInput() {
    let down = null;
    // the whole screen (scene, side margins, letterbox) advances the text
    for (const area of [$("root")]) {
      area.addEventListener("pointerdown", (e) => {
        const cm = $("cornermenu");
        if (!cm.classList.contains("hidden") && !e.target.closest("#cornermenu, #cornerbtn")) {
          // a tap outside the open corner menu only closes it
          cm.classList.add("hidden");
          down = null;
          return;
        }
        if (e.target.closest(NO_TAP)) return;
        down = { x: e.clientX, y: e.clientY, t: performance.now() };
      });
      area.addEventListener("pointerup", (e) => {
        if (!down) return;
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        down = null;
        if (e.target.closest(NO_TAP)) return;
        // swipe up: backlog only when enabled in settings (default off; the swipe then does nothing)
        if (dy < -50 && Math.abs(dy) > Math.abs(dx)) { if (VM.config.swipeBacklog === true && UI.inGame && !UI.overlayOpen) UI.openBacklog(); return; }
        if (dy > 50 && Math.abs(dy) > Math.abs(dx)) { if (UI.inGame && !UI.overlayOpen) UI.toggleHide(); return; }
        gameTap();
      });
      area.addEventListener("pointercancel", () => { down = null; });
    }
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT") return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); gameTap(); }
      if (e.key === "Control" && UI.inGame && !UI.overlayOpen) { VM.skipForce = true; VM.toggleSkip(true); }
      if (e.key === "Escape" && UI.inGame) { if (UI.overlayOpen) UI.closeOverlay(); else UI.openMenu("system"); }
    });
    document.addEventListener("keyup", (e) => { if (e.key === "Control" && VM.skipForce) { VM.skipForce = false; VM.toggleSkip(false); } });
    document.addEventListener("gesturestart", (e) => e.preventDefault());
  }

  // ---------------- choices ----------------
  UI.showChoices = function (texts) {
    if (window.AUTOTEST) return Promise.resolve(window.AUTOTEST.pick(texts.length, texts));
    UI.choiceOpen = true;
    const box = $("choices");
    box.innerHTML = "";
    return new Promise((res) => {
      texts.forEach((t, i) => {
        const c = el("div", "choice");
        c.innerHTML = `<img src="${A("select_normal")}"><img class="over" src="${A("select_over")}"><span>${esc(t)}</span>`;
        c.addEventListener("pointerup", (e) => {
          e.stopPropagation();
          Sound.se[7].play("システム／決定３");
          box.classList.add("hidden");
          UI.choiceOpen = false;
          res(i);
        });
        c.addEventListener("pointerdown", (e) => { e.stopPropagation(); c.classList.add("sel"); Sound.se[7].play("システム／カーソル１"); });
        box.appendChild(c);
      });
      box.classList.remove("hidden");
    });
  };
  const MAP_BTN = { "妙": "map_tae", "みなせ": "map_ebi", "紀子": "map_nori", "須美": "map_sumi", "由貴": "map_yuki" };
  const MAP_POS = { "default": [400, 300], "妙・位置": [500, 160], "みなせ・位置": [265, 225], "紀子・位置": [415, 420], "須美・位置": [150, 420], "由貴・位置": [645, 395] };
  UI.showMapSelect = function (list) {
    if (window.AUTOTEST) return Promise.resolve(window.AUTOTEST.pick(list.length, list.map((x) => x.text)));
    const box = $("map");
    box.innerHTML = `<img class="mapbase" src="${A("map_base")}">` + (A("map_title") ? `<img class="mapbase" src="${A("map_title")}">` : "");
    UI.choiceOpen = true;
    const timers = [];
    return new Promise((res) => {
      list.forEach((s, i) => {
        const [cx, cy] = MAP_POS[s.pos] || MAP_POS.default;
        const icon = el("div", "mapicon");
        icon.style.left = cx - 116 + "px"; icon.style.top = cy - 114 + "px";
        icon.style.backgroundImage = `url("${A(MAP_BTN[s.text] || "map_tae")}")`;
        icon.innerHTML = `<div class="lbl">${esc(s.text)}</div>`;
        let fr = 0, over = false;
        timers.push(setInterval(() => { fr = (fr + 1) % 10; icon.style.backgroundPosition = `${over ? -232 : 0}px ${-228 * fr}px`; }, 110));
        icon.addEventListener("pointerdown", (e) => { e.stopPropagation(); over = true; Sound.se[7].play("システム／カーソル１"); });
        icon.addEventListener("pointerup", (e) => {
          e.stopPropagation();
          timers.forEach(clearInterval);
          Sound.se[7].play("システム／決定３");
          box.classList.add("hidden");
          UI.choiceOpen = false;
          res(i);
        });
        box.appendChild(icon);
      });
      box.classList.remove("hidden");
    });
  };

  // ---------------- date / movie ----------------
  UI.showDay = async function (storage) {
    const d = $("dayimg");
    if (!storage || !VM.sf.dateview) { d.style.display = "none"; return; }
    d.src = A(storage);
    d.style.display = "block";
  };
  UI.playMovie = function (storage) {
    if (window.AUTOTEST) return Promise.resolve();
    const v = $("movie");
    const u = A(storage);
    if (!u) return Promise.resolve();
    Sound.bgm.stop(0);
    return new Promise((res) => {
      const end = () => { v.onended = null; v.onclick = null; v.pause(); v.classList.add("hidden"); v.removeAttribute("src"); v.load(); res(); };
      v.src = u;
      v.classList.remove("hidden");
      v.onended = end;
      v.onerror = end;
      v.onpointerup = (e) => { e.stopPropagation(); end(); };
      v.play().catch(() => { UI.toast("タップで再生"); v.onpointerup = (e) => { e.stopPropagation(); if (v.paused) v.play().catch(end); else end(); }; });
      UI.stopMovie = end;
    });
  };
  UI.stopMovie = function () {};

  UI.toast = function (msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(UI._toastT);
    UI._toastT = setTimeout(() => t.classList.add("hidden"), 1800);
  };

  UI.confirm = function (msg) {
    return new Promise((res) => {
      const ov = el("div");
      ov.style.cssText = "position:absolute;inset:0;z-index:95;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;";
      ov.innerHTML = `<div style="background:#2a1d2c;border:1px solid #f08aa0;border-radius:12px;padding:24px 30px;text-align:center;min-width:340px">
        <div style="font-size:19px;margin-bottom:20px">${esc(msg)}</div>
        <button class="btnx primary" data-v="1">はい</button>　<button class="btnx" data-v="0">いいえ</button></div>`;
      ov.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        const b = e.target.closest("button");
        if (!b) return;
        ov.remove();
        res(b.dataset.v === "1");
      });
      ov.addEventListener("pointerdown", (e) => e.stopPropagation());
      $("root").appendChild(ov);
    });
  };

  UI.resetGameUI = function () {
    UI.clearText(); UI.setName(""); UI.setFace(null);
    $("choices").classList.add("hidden"); $("map").classList.add("hidden");
    UI.choiceOpen = false;
    UI.userHidden = false; UI.windowShown = false; applyMsgVisibility();
    UI.setFrame(true);
    $("title").classList.add("hidden");
    UI.closeOverlay();
    UI.booted = true;
    UI.inGame = true;
    fit();
    UI.updateModes();
  };

  // ---------------- overlays ----------------
  const ov = () => $("overlay");
  UI.closeOverlay = function () {
    ov().classList.add("hidden");
    ov().innerHTML = "";
    UI.overlayOpen = false;
  };
  function openOverlay(title, body, extraHead = "") {
    UI.overlayOpen = true;
    if (UI.typing) UI.typing.finish();
    const o = ov();
    o.innerHTML = `<div class="ov-head"><h2>${title}</h2>${extraHead}<button class="btnx" id="ovclose">閉じる</button></div><div class="ov-body"></div>`;
    o.querySelector(".ov-body").appendChild(body);
    o.querySelector("#ovclose").onclick = () => { UI.closeOverlay(); if (UI.onOverlayClose) { const f = UI.onOverlayClose; UI.onOverlayClose = null; f(); } };
    o.classList.remove("hidden");
    o.onpointerdown = (e) => e.stopPropagation();
    o.onpointerup = (e) => e.stopPropagation();
    return o;
  }

  UI.openMenu = function (kind) {
    if (kind === "save") return openSaveLoad(true);
    if (kind === "load") return openSaveLoad(false);
    if (kind === "config") return openConfig();
    const body = el("div", "menu-list");
    const items = [
      ["セーブ", () => openSaveLoad(true)],
      ["ロード", () => openSaveLoad(false)],
      ["クイックセーブ", () => { UI.closeOverlay(); VM.quickSave(); }],
      ["クイックロード", () => { UI.closeOverlay(); VM.quickLoad(); }],
      ["バックログ", () => UI.openBacklog()],
      [VM.autoMode ? "オート停止" : "オートモード", () => { UI.closeOverlay(); VM.toggleAuto(); }],
      [VM.skipMode ? "スキップ停止" : "スキップ", () => { UI.closeOverlay(); VM.toggleSkip(); }],
      ["設定", () => openConfig()],
      ["タイトルに戻る", () => UI.confirm("タイトルに戻りますか？").then((ok) => ok && UI.backToTitle())],
      ["ゲームに戻る", () => UI.closeOverlay()],
    ];
    for (const [t, fn] of items) { const b = el("button", "btnx", t); b.onclick = fn; body.appendChild(b); }
    openOverlay("システム", body);
  };

  function fmtTime(t) { const d = new Date(t); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
  let slPage = 0;
  function openSaveLoad(isSave, fromTitle) {
    const body = el("div");
    const render = () => {
      const idx = VM.Store.get("saveindex") || {};
      body.innerHTML = "";
      const grid = el("div", "slots");
      const slots = [];
      if (!isSave && slPage === 0) slots.push("q");
      for (let i = 0; i < 12; i++) slots.push(String(slPage * 12 + i + 1));
      for (const s of slots) {
        const d = idx[s];
        const c = el("div", "slot");
        const label = s === "q" ? "QUICK" : "No." + s.padStart(3, "0");
        c.innerHTML = d ? `<img src="${d.thumb}"><div class="meta"><b>${label}　${esc(d.title || "")}</b>${fmtTime(d.time)}<div class="tx">${esc(d.text || "")}</div></div>`
          : `<img style="opacity:.3"><div class="meta"><b>${label}</b>― NO DATA ―</div>`;
        c.onclick = async () => {
          if (isSave) {
            if (d && !(await UI.confirm("上書きしますか？"))) return;
            if (VM.saveSlot(s)) { UI.toast("セーブしました"); render(); }
            else UI.toast("ここではセーブできません");
          } else if (d) {
            if (!(await UI.confirm("ロードしますか？"))) return;
            UI.closeOverlay();
            $("title").classList.add("hidden");
            stopTitleFx();
            await VM.loadSlot(s);
          }
        };
        grid.appendChild(c);
      }
      body.appendChild(grid);
      const pg = el("div", "pager");
      for (let p = 0; p < 10; p++) {
        const b = el("button", "btnx" + (p === slPage ? " cur" : ""), String(p + 1));
        b.onclick = () => { slPage = p; render(); };
        pg.appendChild(b);
      }
      body.appendChild(pg);
    };
    render();
    openOverlay(isSave ? "セーブ" : "ロード", body);
  }
  UI.openSaveLoad = openSaveLoad;

  function openConfig() {
    const c = VM.config;
    const body = el("div");
    const row = (label, key, min, max, step, fmt, invert) => {
      const r = el("div", "cfg-row");
      r.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}"><span class="val"></span>`;
      const inp = r.querySelector("input"), val = r.querySelector(".val");
      const toUi = (v) => (invert ? max + min - v : v);
      inp.value = toUi(c[key]);
      const upd = () => { c[key] = toUi(+inp.value); val.textContent = fmt(c[key]); VM.saveConfig(); };
      val.textContent = fmt(c[key]);
      inp.oninput = upd;
      body.appendChild(r);
    };
    const tog = (label, get, set) => {
      const r = el("div", "cfg-row");
      r.innerHTML = `<label>${label}</label><button class="btnx"></button>`;
      const b = r.querySelector("button");
      const upd = () => (b.textContent = get() ? "ON" : "OFF");
      b.onclick = () => { set(!get()); upd(); };
      upd();
      body.appendChild(r);
    };
    row("文字表示速度", "textSpeed", 0, 80, 5, (v) => (v === 0 ? "瞬間" : Math.round(100 - v) + ""), true);
    row("オート待ち時間", "autoWait", 200, 4000, 100, (v) => (v / 1000).toFixed(1) + "s");
    row("BGM音量", "bgm", 0, 1, 0.05, (v) => Math.round(v * 100));
    row("効果音音量", "se", 0, 1, 0.05, (v) => Math.round(v * 100));
    row("ボイス音量", "voice", 0, 1, 0.05, (v) => Math.round(v * 100));
    tog("未読もスキップ", () => c.allskip, (v) => { c.allskip = v; VM.saveConfig(); });
    tog("次の文でボイス停止", () => !!VM.sfRaw.voicecut, (v) => { VM.sfRaw.voicecut = v; VM.markSf(); });
    tog("日付表示", () => !!VM.sfRaw.dateview, (v) => { VM.sfRaw.dateview = v; VM.markSf(); UI.showDay(VM.showdayStorage); });
    {
      const r = el("div", "cfg-row");
      r.innerHTML = `<label>画面レイアウト</label><div class="seg"></div>`;
      const seg = r.querySelector(".seg");
      const opts = [["auto", "自動"], ["compact", "iPhone向け"], ["classic", "オリジナル"]];
      const draw = () => {
        seg.innerHTML = "";
        for (const [v, label] of opts) {
          const b = el("button", "btnx" + ((c.layout || "auto") === v ? " primary" : ""), label);
          b.onclick = () => { c.layout = v; VM.saveConfig(); fit(); draw(); };
          seg.appendChild(b);
        }
      };
      draw();
      body.appendChild(r);
    }
    {
      const r = el("div", "cfg-row");
      r.innerHTML = `<label>文字の大きさ</label><div class="seg"></div>`;
      const seg = r.querySelector(".seg");
      const opts = [[0, "標準"], [1, "大"], [2, "特大"], [3, "最大"]];
      const cur = () => (c.textSize !== undefined ? +c.textSize : UI.isCompact() ? 3 : 0);
      const draw = () => {
        seg.innerHTML = "";
        for (const [v, label] of opts) {
          const b = el("button", "btnx" + (cur() === v ? " primary" : ""), label);
          b.style.fontSize = 13 + v * 2 + "px";
          b.onclick = () => { c.textSize = v; VM.saveConfig(); applyTextSize(); draw(); };
          seg.appendChild(b);
        }
      };
      draw();
      body.appendChild(r);
    }
    const seg = (label, key, opts, def, after) => {
      const r = el("div", "cfg-row");
      r.innerHTML = `<label>${label}</label><div class="seg"></div>`;
      const box = r.querySelector(".seg");
      const draw = () => {
        box.innerHTML = "";
        for (const [v, text] of opts) {
          const b = el("button", "btnx" + ((c[key] ?? def) === v ? " primary" : ""), text);
          b.onclick = () => { c[key] = v; VM.saveConfig(); if (after) after(); draw(); };
          box.appendChild(b);
        }
      };
      draw();
      body.appendChild(r);
    };
    seg("ボタンの配置", "menuStyle", [["corner", "右上︙のみ"], ["side", "右上︙＋両サイド"], ["none", "なし（オリジナル）"]], "corner", fit);
    seg("メッセージ窓の元のボタン", "origButtons", [[true, "表示"], [false, "非表示"]], true, fit);
    seg("上スワイプでバックログ", "swipeBacklog", [[false, "オフ"], [true, "オン"]], false);
    seg("ボタンのアイコン", "showIcons", [[false, "なし"], [true, "あり"]], false, fit);
    seg("サイドの背景", "sideStyle", [["black", "黒"], ["color", "カラー"]], "black", fit);
    seg("通知センター表示中の音", "keepAudioInactive", [[true, "鳴らす"], [false, "止める"]], true, () => Sound.setPolicy && Sound.setPolicy());
    const help = el("div");
    help.style.cssText = "margin-top:16px;color:#bbb;font-size:15px;line-height:1.7";
    help.innerHTML = "操作：画面（外枠も含む）をタップで進む／右上︙でメニュー／下スワイプでウィンドウ消去（上スワイプでバックログは設定でオン）。ボタンの配置「なし」のときは、メッセージ窓の「System」やタイトルの「システム」から設定を開けます";
    body.appendChild(help);
    const reset = el("div");
    reset.style.cssText = "margin-top:14px;text-align:center";
    const rb = el("button", "btnx", "設定を初期値に戻す");
    rb.onclick = async () => {
      if (!(await UI.confirm("設定を初期値に戻しますか？"))) return;
      VM.resetConfig();
      fit();
      UI.showDay(VM.showdayStorage);
      openConfig();
      UI.toast("設定を初期値に戻しました");
    };
    reset.appendChild(rb);
    body.appendChild(reset);
    openOverlay("設定", body);
  }

  UI.openBacklog = function () {
    const body = el("div");
    for (const e of VM.backlog) {
      const r = el("div", "log-entry");
      r.innerHTML = `<div class="nm">${esc(e.name ? "【" + e.name + "】" : "")}</div><div class="tx">${esc(e.text)}</div>`;
      if (e.voice) {
        const b = el("button", "vb", "▶");
        b.onclick = () => Sound.voices.play(e.voice);
        r.appendChild(b);
      }
      body.appendChild(r);
    }
    openOverlay("バックログ", body);
    const ob = ov().querySelector(".ov-body");
    ob.scrollTop = ob.scrollHeight;
  };

  // ---------------- extras (CG / music) ----------------
  function openGallery() {
    const body = el("div", "cg-grid");
    const keys = Object.keys(window.MANIFEST).filter((k) => /^ev\d{4}[a-z]?$/.test(k) && !/\./.test(k)).sort();
    const groups = new Map();
    for (const k of keys) { const g = k.slice(0, 6); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(k); }
    for (const [g, list] of groups) {
      const seen = list.filter((k) => VM.sfRaw["cg_" + k.toUpperCase()]);
      if (!seen.length) { body.appendChild(el("div", "lock", "？")); continue; }
      const im = el("img");
      im.src = A(seen[0]);
      im.onclick = () => {
        let i = 0;
        const v = el("div");
        v.id = "cgview";
        v.innerHTML = `<img src="${A(seen[0])}">`;
        v.onpointerup = (e) => { e.stopPropagation(); i++; if (i >= seen.length) v.remove(); else v.firstChild.src = A(seen[i]); };
        v.onpointerdown = (e) => e.stopPropagation();
        $("root").appendChild(v);
      };
      body.appendChild(im);
    }
    openOverlay("CGモード", body);
  }
  function openMusic() {
    const body = el("div");
    const names = Object.keys(window.MANIFEST).filter((k) => /^bgm\d+t?$/.test(k)).sort();
    for (const n of names) {
      const r = el("div", "cfg-row");
      r.innerHTML = `<label>${n.toUpperCase()}</label><button class="btnx">再生</button>`;
      r.querySelector("button").onclick = () => Sound.bgm.play(n, { loop: true });
      body.appendChild(r);
    }
    UI.onOverlayClose = () => Sound.bgm.play("bgm51", { loop: true });
    openOverlay("音楽モード", body);
  }

  // ---------------- title ----------------
  let petalTimer = null;
  function stopTitleFx() { if (petalTimer) { cancelAnimationFrame(petalTimer); petalTimer = null; } }
  // Port of sakura.ks: sakuraall.png holds 60 frames of 75x50; a petal shows frame
  // (tick/20ms + random offset) % 60, falls with its own velocity (+-15%), spawns gradually
  // (1% chance per 30ms) and restarts above the screen after leaving the bottom.
  // Small petals (zoom 50) sit behind the logo, big ones (zoom 100) in front of it.
  function startPetals(box) {
    const W = 800, H = 600, STEP = 75, FRAME_MS = 20;
    const back = el("canvas", "petals"), front = el("canvas", "petals");
    for (const c of [back, front]) { c.width = W; c.height = H; }
    const logo = box.querySelector(".tb.logo");
    box.insertBefore(back, logo);
    box.insertBefore(front, logo.nextSibling);
    const img = new Image();
    img.src = A("sakuraall");
    const groups = [
      { ctx: front.getContext("2d"), num: 20, xvelo: -200, yvelo: 200, zoom: 1 },
      { ctx: back.getContext("2d"), num: 40, xvelo: -100, yvelo: 100, zoom: 0.5 },
    ];
    const petals = [];
    for (const g of groups) {
      for (let i = 0; i < g.num; i++) {
        const xv = g.xvelo + (Math.random() - 0.5) * g.xvelo * 0.3;
        const yv = g.yvelo + (Math.random() - 0.5) * g.yvelo * 0.3;
        petals.push({ g, xv, yv, xdiff: xv * (H / yv), tdiff: Math.floor(Math.random() * 60), spawned: false, x0: 0, t0: 0 });
      }
    }
    const h = 50;
    const init = (p, now) => {
      const range = W - p.xdiff; // xdiff is negative: spawn also right of the screen so petals drift in
      p.x0 = Math.random() * range;
      p.y0 = -h * p.g.zoom;
      p.t0 = now;
    };
    let lastSpawnCheck = 0;
    const tick = (now) => {
      // spawn chance evaluated on the original 30ms timer grid
      while (now - lastSpawnCheck >= 30) {
        lastSpawnCheck = lastSpawnCheck ? lastSpawnCheck + 30 : now;
        for (const p of petals) if (!p.spawned && Math.random() < 0.01) { p.spawned = true; init(p, now); }
      }
      for (const g of groups) g.ctx.clearRect(0, 0, W, H);
      if (img.complete && img.naturalWidth) {
        const frames = Math.floor(img.naturalWidth / STEP);
        for (const p of petals) {
          if (!p.spawned) continue;
          const dt = (now - p.t0) / 1000;
          let x = p.x0 + p.xv * dt, y = p.y0 + p.yv * dt;
          if (y >= H) { init(p, now); x = p.x0; y = p.y0; }
          const f = (Math.floor(now / FRAME_MS) + p.tdiff) % frames;
          const z = p.g.zoom;
          p.g.ctx.drawImage(img, f * STEP, 0, STEP, h, x, y, STEP * z, h * z);
        }
      }
      petalTimer = requestAnimationFrame(tick);
    };
    petalTimer = requestAnimationFrame(tick);
  }
  function titleBtn(x, y, name, fn, voice) {
    const b = el("div", "btn");
    b.style.left = x + "px"; b.style.top = y + "px";
    b.innerHTML = `<img src="${A(name)}"><img class="over" src="${A(name + "Over") || A(name + "over")}">`;
    b.addEventListener("pointerdown", () => Sound.se[7].play("システム／カーソル１"));
    b.addEventListener("click", () => { Sound.unlock(); if (voice) Sound.se[8].play(voice); fn(); });
    return b;
  }
  UI.showTitle = function () {
    UI.booted = true;
    UI.inGame = false;
    $("cornermenu").classList.add("hidden");
    fit();
    UI.closeOverlay();
    const t = $("title");
    t.innerHTML = "";
    t.classList.remove("hidden");
    $("msg").classList.add("hidden");
    t.innerHTML = `<img class="tb" src="${A("titleBase")}" style="top:-482px"><img class="tb logo" src="${A("titleLogo")}" style="left:105px;top:24px"><img class="tb" src="${A("titleBar")}" style="top:550px">`;
    startPetals(t);
    if (Sound.bgm.storage !== "bgm51") Sound.bgm.play("bgm51", { loop: true });
    const ys = [325, 369, 413, 457, 501];
    let i = 0;
    t.appendChild(titleBtn(320, ys[i++], "titleStart", () => showNameEntry(), "tae930061.ogg"));
    t.appendChild(titleBtn(320, ys[i++], "titleNext", () => openSaveLoad(false, true), "tae930057.ogg"));
    if (VM.sfRaw.clear) {
      t.appendChild(titleBtn(320, ys[i++], "titleOmake", () => showOmake(), "tae930058.ogg"));
    }
    t.appendChild(titleBtn(320, ys[i++], "titleSystem", () => openConfig(), "tae930059.ogg"));
  };
  function showOmake() {
    const body = el("div", "menu-list");
    const items = [["CGモード", openGallery], ["音楽モード", openMusic]];
    for (const [n, fn] of items) { const b = el("button", "btnx", n); b.onclick = fn; body.appendChild(b); }
    openOverlay("おまけ", body);
  }
  function showNameEntry() {
    const t = $("title");
    const box = el("div");
    box.style.cssText = "position:absolute;inset:0;z-index:5";
    box.innerHTML = `<img class="tb" src="${A("namebase")}" style="top:0">`;
    const fam = el("input"), nam = el("input");
    fam.maxLength = 4; nam.maxLength = 4;
    fam.value = VM.sfRaw.family || VM.sfRaw.defaultFamily; nam.value = VM.sfRaw.name || VM.sfRaw.defaultName;
    fam.style.cssText = "left:218px;top:278px;width:140px"; nam.style.cssText = "left:405px;top:278px;width:140px";
    box.appendChild(fam); box.appendChild(nam);
    box.appendChild(titleBtn(183, 435, "nameinit", () => { fam.value = VM.sfRaw.defaultFamily; nam.value = VM.sfRaw.defaultName; }));
    box.appendChild(titleBtn(342, 435, "nameok", async () => {
      const f = fam.value.trim(), n = nam.value.trim();
      if (!f || !n) { UI.toast("名前を入力してください"); return; }
      Sound.se[8].play("tae930062.ogg");
      let practice = true;
      if (VM.sfRaw.clear) practice = await UI.confirm("指導モードを有効にしますか？");
      stopTitleFx();
      t.classList.add("hidden");
      VM.newGame(f, n, practice);
    }));
    box.appendChild(titleBtn(502, 435, "nametitle", () => box.remove()));
    box.addEventListener("pointerdown", (e) => e.stopPropagation());
    t.appendChild(box);
  }
  UI.backToTitle = function () {
    VM.abort();
    VM.flushSf();
    Sound.voices.stop(); Sound.se.forEach((s) => s.stop(0)); Sound.bgm.stop(500);
    Env.env.init();
    Render.unfreeze(); Render.finishAll();
    UI.resetGameUI();
    UI.showDay(null);
    UI.showTitle();
  };

  // copy the live scene into the tiny background canvas (upscaled + CSS blur = soft backdrop)
  function startBackdrop() {
    const bb = $("bgblur"), bctx = bb.getContext("2d"), cv = $("cv");
    bctx.imageSmoothingEnabled = true;
    setInterval(() => {
      if (!document.body.classList.contains("compact") || document.body.classList.contains("sideblack") || document.hidden) return;
      try { bctx.drawImage(cv, 0, 0, bb.width, bb.height); } catch (e) {}
    }, 100);
  }

  UI.init = function () {
    startBackdrop();
    // original artwork used by the phone/menus styling
    const root = document.documentElement.style;
    for (const [v, n] of [["--img-sel", "select_normal"], ["--img-selover", "select_over"], ["--img-sky", "titleBase"], ["--img-msg", "messagewindow"]]) {
      const u = A(n);
      // absolute URL: a relative url() inside a custom property would resolve against css/
      if (u) root.setProperty(v, `url("${new URL(u, location.href).href}")`);
    }
    fit();
    buildMsg();
    setupInput();
  };
})();
