// Asset lookup (KAG-style storage names -> converted files) and caches.
(function () {
  const M = window.MANIFEST || {};

  function key(name) {
    if (name == null) return null;
    let k = String(name).toLowerCase();
    if (k in M) return k;
    const dot = k.lastIndexOf(".");
    if (dot > 0 && k.slice(0, dot) in M) return k.slice(0, dot);
    return null;
  }

  function url(name) {
    const k = key(name);
    return k ? M[k] : null;
  }

  // LRU image cache
  const imgCache = new Map();
  const IMG_LIMIT = 48;
  function getImage(name) {
    const u = url(name);
    if (!u) return Promise.resolve(null);
    let e = imgCache.get(u);
    if (e) {
      imgCache.delete(u);
      imgCache.set(u, e);
      return e;
    }
    e = new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        if (im.decode) im.decode().then(() => res(im), () => res(im));
        else res(im);
      };
      im.onerror = () => { console.warn("image load failed", name, u); res(null); };
      im.src = u;
    });
    imgCache.set(u, e);
    while (imgCache.size > IMG_LIMIT) imgCache.delete(imgCache.keys().next().value);
    return e;
  }

  // synchronous peek (already loaded)
  const loaded = new Map();
  async function image(name) {
    const im = await getImage(name);
    if (im) loaded.set(String(name).toLowerCase(), im);
    return im;
  }

  const bufCache = new Map();
  const BUF_LIMIT = 40;
  function getAudioBuffer(ctx, name) {
    const u = url(name);
    if (!u) return Promise.resolve(null);
    let e = bufCache.get(u);
    if (e) {
      bufCache.delete(u);
      bufCache.set(u, e);
      return e;
    }
    e = fetch(u)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
      .catch((err) => { console.warn("audio load failed", name, u, err); bufCache.delete(u); return null; });
    bufCache.set(u, e);
    while (bufCache.size > BUF_LIMIT) bufCache.delete(bufCache.keys().next().value);
    return e;
  }

  window.Assets = { key, url, image, getAudioBuffer, exists: (n) => !!url(n) };
})();
