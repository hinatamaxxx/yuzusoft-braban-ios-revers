// KAG (.ks) scenario parser.
// ops: {t:'label',name,title} {t:'tag',name,attrs:[[k,v]],ln} {t:'text',s} {t:'name',name,disp}
//      {t:'eol'} {t:'iscript',code} {t:'macro',name,body}
(function () {
  const asciiLower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
  function parseTagBody(body) {
    let i = 0;
    const n = body.length;
    const skip = () => { while (i < n && /\s/.test(body[i])) i++; };
    skip();
    let name = "";
    while (i < n && !/[\s=]/.test(body[i])) name += body[i++];
    const attrs = [];
    for (;;) {
      skip();
      if (i >= n) break;
      let k = "";
      while (i < n && !/[\s=]/.test(body[i])) k += body[i++];
      skip();
      let v = true;
      if (body[i] === "=") {
        i++;
        skip();
        let pre = "";
        if (body[i] === "&" && (body[i + 1] === '"' || body[i + 1] === "'")) { pre = "&"; i++; }
        if (body[i] === '"' || body[i] === "'") {
          const q = body[i++];
          v = pre;
          while (i < n && body[i] !== q) v += body[i++];
          i++;
        } else {
          v = "";
          while (i < n && !/\s/.test(body[i])) v += body[i++];
        }
      }
      if (k) attrs.push([asciiLower(k), v]);
    }
    return { name: asciiLower(name), attrs };
  }

  // split a line into text / tag pieces
  function splitLine(line) {
    const out = [];
    let i = 0, buf = "";
    while (i < line.length) {
      const c = line[i];
      if (c === "[") {
        if (line[i + 1] === "[") { buf += "["; i += 2; continue; }
        let depth = 0, j = i, q = null;
        for (; j < line.length; j++) {
          const d = line[j];
          if (q) { if (d === q) q = null; continue; }
          if (d === '"' || d === "'") { if (/=\s*&?$/.test(line.slice(i, j))) q = d; continue; }
          if (d === "[") depth++;
          else if (d === "]" && --depth === 0) break;
        }
        if (buf) { out.push({ text: buf }); buf = ""; }
        out.push({ tag: line.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
      buf += c;
      i++;
    }
    if (buf) out.push({ text: buf });
    return out;
  }

  function parse(src, storage) {
    const lines = src.replace(/\r/g, "").split("\n");
    const top = [];
    const stack = [top]; // macro bodies
    const macroNames = [];
    let cur = top;
    let inScript = null;
    const push = (op) => cur.push(op);
    for (let ln = 0; ln < lines.length; ln++) {
      const raw = lines[ln];
      const line = raw.replace(/^[\t ]+/, "");
      if (inScript !== null) {
        if (/^(@endscript|\[endscript\])/.test(line)) { push({ t: "iscript", code: inScript, ln }); inScript = null; }
        else inScript += raw + "\n";
        continue;
      }
      if (line === "" || line[0] === ";") continue;
      if (line[0] === "*") {
        const m = /^\*([^|]*)(?:\|(.*))?$/.exec(line);
        push({ t: "label", name: m[1].trim(), title: m[2] || "", ln });
        continue;
      }
      let pieces;
      if (line[0] === "@") pieces = [{ tag: line.slice(1) }];
      else pieces = splitLine(line);
      let hasText = false;
      let first = true;
      for (const p of pieces) {
        if (p.tag !== undefined) {
          const { name, attrs } = parseTagBody(p.tag);
          if (name === "iscript") { inScript = ""; continue; }
          if (name === "macro") {
            const body = [];
            const nm = (attrs.find((a) => a[0] === "name") || [])[1];
            macroNames.push(nm);
            stack.push(body);
            cur = body;
            continue;
          }
          if (name === "endmacro") {
            const body = stack.pop();
            cur = stack[stack.length - 1];
            push({ t: "macro", name: macroNames.pop(), body, ln });
            continue;
          }
          push({ t: "tag", name, attrs, ln });
          first = false;
          continue;
        }
        let s = p.text;
        if (first) {
          const m = /^【([^】]*)】/.exec(s);
          if (m) {
            const [nm, disp] = m[1].split("/");
            push({ t: "name", name: nm, disp: disp || "", ln });
            s = s.slice(m[0].length);
          } else if (s.trim()) {
            push({ t: "name", name: "", disp: "", ln });
          }
        }
        first = false;
        if (s.length) { push({ t: "text", s, ln }); if (s.trim()) hasText = true; }
      }
      if (hasText) push({ t: "eol", ln });
    }
    const labels = {};
    top.forEach((op, i) => { if (op.t === "label" && !(op.name in labels)) labels[op.name] = i; });
    return { storage, ops: top, labels };
  }

  window.KS = { parse, parseTagBody };
})();
