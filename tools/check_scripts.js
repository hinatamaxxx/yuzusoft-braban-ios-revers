// Static check of all scenarios: jump/call targets, and referenced storages (images, sounds, voices).
// usage: node check_scripts.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const G = path.join(__dirname, "..", "game");
const ctx = { window: {}, console };
ctx.window.window = ctx.window;
vm.createContext(ctx);
for (const f of ["data/manifest.js", "data/scripts.js", "js/tjs.js", "js/ks.js"]) vm.runInContext(fs.readFileSync(path.join(G, f), "utf8").replace(/^window\./gm, "window."), ctx);
const W = ctx.window;
const M = W.MANIFEST, S = W.SCRIPTS;
const has = (n) => { const k = String(n).toLowerCase(); return k in M || k.replace(/\.[^.]+$/, "") in M; };
const env = W.TJS.parse(S["envinit.tjs"]);
const problems = [];
const parsed = {};
for (const name of Object.keys(S).filter((n) => n.endsWith(".ks"))) parsed[name] = W.KS.parse(S[name], name);
const scen = Object.keys(parsed).filter((n) => /^\d\d\.ks$/.test(n) || n === "practice.ks" || n === "macro.ks");
const stats = { tags: 0, missing: 0 };
for (const n of scen) {
  const p = parsed[n];
  const walk = (ops) => {
    for (const op of ops) {
      if (op.t === "macro") { walk(op.body); continue; }
      if (op.t !== "tag") continue;
      stats.tags++;
      const a = Object.fromEntries(op.attrs);
      if (op.name === "jump" || op.name === "call" || (op.name === "seladd" && a.target) || op.name === "mseladd") {
        const st = a.storage ? (a.storage.endsWith(".ks") ? a.storage : a.storage + ".ks") : n;
        if (st === "title.ks") continue;
        if (!parsed[st]) { problems.push(`${n}:${op.ln} missing storage ${st}`); continue; }
        if (a.target && !String(a.target).startsWith("&")) {
          const t = String(a.target).replace(/^\*/, "");
          if (!(t in parsed[st].labels)) problems.push(`${n}:${op.ln} missing label ${st} *${t}`);
        }
      }
      for (const k of ["storage", "file"]) {
        const v = a[k];
        if (typeof v === "string" && !v.startsWith("&") && !v.startsWith("%") && !/\.ks$/.test(v) && !["jump", "call"].includes(op.name) && !has(v)) {
          problems.push(`${n}:${op.ln} [${op.name}] missing asset ${v}`);
          stats.missing++;
        }
      }
      if ((op.name === "ev" || op.name === "event")) for (const [k, v] of op.attrs) if (v === true && /^ev/i.test(k) && !has(k)) problems.push(`${n}:${op.ln} missing EV ${k}`);
    }
  };
  walk(p.ops);
}
// voices: simulate counters per character from [char voice=N] then count dialogue lines
let vMissing = 0, vTotal = 0;
const chars = env.characters;
for (const n of scen) {
  const counters = {};
  for (const op of parsed[n].ops) {
    if (op.t === "tag" && chars[op.name] !== undefined) {
      const a = op.attrs.find(([k]) => k === "voice");
      if (a) counters[op.name] = parseInt(a[1], 10);
    }
    if (op.t === "name" && op.name && chars[op.name] && chars[op.name].voiceFile && counters[op.name] !== undefined) {
      const f = chars[op.name].voiceFile.replace("%06d", String(counters[op.name]).padStart(6, "0")).replace("%s", "");
      vTotal++;
      if (!has(f)) { vMissing++; if (vMissing < 15) problems.push(`${n}:${op.ln} voice missing ${f}`); }
      counters[op.name]++;
    }
  }
}
console.log(problems.slice(0, 80).join("\n"));
console.log(JSON.stringify({ scenarios: scen.length, ...stats, problems: problems.length, voiceLines: vTotal, voiceMissing: vMissing }));
