// Minimal TJS2 literal parser (dictionaries %[...], arrays [...], strings, numbers, identifiers)
// Used for envinit.tjs. Dictionaries become Map-like plain objects with an ordered key list in __keys.
(function () {
  const CONST = {
    "KAGEnvironment.XPOSITION": 1, "KAGEnvironment.LEVEL": 2, "KAGEnvironment.DISPPOSITION": 3, "KAGEnvironment.YPOSITION": 4,
    "KAGEnvImage.BOTH": 1, "KAGEnvImage.BU": 2, "KAGEnvImage.CLEAR": 3, "KAGEnvImage.FACE": 4, "KAGEnvImage.INVISIBLE": 5,
  };

  function parse(src) {
    let i = 0;
    const n = src.length;
    function ws() {
      for (;;) {
        while (i < n && /\s/.test(src[i])) i++;
        if (src.startsWith("//", i)) { while (i < n && src[i] !== "\n") i++; continue; }
        if (src.startsWith("/*", i)) { const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
        break;
      }
    }
    function str() {
      const q = src[i++];
      let s = "";
      while (i < n && src[i] !== q) {
        if (src[i] === "\\") { i++; const c = src[i++]; s += c === "n" ? "\n" : c === "t" ? "\t" : c; }
        else s += src[i++];
      }
      i++;
      return s;
    }
    function value() {
      ws();
      if (src.startsWith("%[", i)) {
        i += 2;
        const o = {};
        Object.defineProperty(o, "__keys", { value: [], enumerable: false });
        for (;;) {
          ws();
          if (src[i] === "]") { i++; break; }
          if (src[i] === ",") { i++; continue; }
          let k;
          if (src[i] === '"' || src[i] === "'") k = str();
          else { const m = /^[\w$]+/.exec(src.slice(i)); k = m[0]; i += k.length; }
          ws();
          if (src.startsWith("=>", i)) i += 2; else if (src[i] === ":") i++;
          const v = value();
          if (!(k in o)) o.__keys.push(k);
          o[k] = v;
        }
        return o;
      }
      if (src[i] === "[") {
        i++;
        const a = [];
        for (;;) {
          ws();
          if (src[i] === "]") { i++; break; }
          if (src[i] === ",") { i++; continue; }
          a.push(value());
        }
        return a;
      }
      if (src[i] === '"' || src[i] === "'") return str();
      let m = /^(?:int|real)\s+/.exec(src.slice(i));
      if (m) { i += m[0].length; return value(); }
      m = /^-?(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?)/.exec(src.slice(i));
      if (m) { i += m[0].length; return Number(m[0]); }
      m = /^[A-Za-z_][\w.]*/.exec(src.slice(i));
      if (m) {
        i += m[0].length;
        if (m[0] === "true") return true;
        if (m[0] === "false") return false;
        if (m[0] === "void" || m[0] === "null") return undefined;
        return m[0] in CONST ? CONST[m[0]] : m[0];
      }
      throw new Error("TJS parse error at " + i + ": " + src.slice(i, i + 30));
    }
    return value();
  }

  window.TJS = { parse };
})();
