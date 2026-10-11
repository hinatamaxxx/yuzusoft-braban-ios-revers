"""Convert decrypted assets (out/ + out/names.tsv) into the web game root (game/).
images -> webp, ogg -> m4a(aac), mpg -> mp4(h264), texts -> data/*.js
Idempotent: existing outputs are skipped.  usage: build_assets.py [--only img|snd|vid|data]
"""
import os, sys, json, re, subprocess
from multiprocessing import Pool

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "out")
GAME = os.path.join(ROOT, "game")
FFMPEG = "ffmpeg"


def rows():
    for l in open(os.path.join(OUT, "names.tsv"), encoding="utf-8"):
        a, d, dn, f, n = l.rstrip("\n").split("\t")
        yield a, d, dn, f, n


def src(a, d, f):
    return os.path.join(OUT, a, d, f)


def magic(p):
    with open(p, "rb") as fp:
        return fp.read(4)


def conv_img(job):
    s, dst = job
    if os.path.exists(dst):
        return
    from PIL import Image
    im = Image.open(s)
    im.load()
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA" if "A" in im.mode or "transparency" in im.info else "RGB")
    tmp = dst + ".tmp"
    im.save(tmp, "WEBP", quality=90, method=4, alpha_quality=100)
    os.replace(tmp, dst)


def conv_snd(job):
    s, dst, kind = job
    if os.path.exists(dst):
        return
    br = ["-ac", "1", "-b:a", "64k"] if kind == "voice" else ["-b:a", "128k"]
    tmp = dst + ".tmp.m4a"
    subprocess.run([FFMPEG, "-v", "error", "-y", "-i", s, "-c:a", "aac", *br, "-movflags", "+faststart", tmp], check=True)
    os.replace(tmp, dst)


def conv_vid(job):
    s, dst = job
    if os.path.exists(dst):
        return
    tmp = dst + ".tmp.mp4"
    subprocess.run([FFMPEG, "-v", "error", "-y", "-i", s, "-c:v", "libx264", "-preset", "slow", "-crf", "21",
                    "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmp], check=True)
    os.replace(tmp, dst)


def main():
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    for sub in ("i", "s", "v", "data"):
        os.makedirs(os.path.join(GAME, sub), exist_ok=True)
    manifest = {}  # lower basename (with and without ext) -> url
    img, snd, vid = [], [], []
    texts = {}
    loops = {}
    allrows = list(rows())
    for a, d, dn, f, n in allrows:
        if n == "?":
            continue
        p = src(a, d, f)
        m = magic(p)
        base = n.lower()
        stem = base.rsplit(".", 1)[0] if "." in base else base
        short = f[:16]
        if m == b"\x89PNG":
            url = f"i/{short}.webp"
            img.append((p, os.path.join(GAME, url)))
        elif m == b"OggS":
            url = f"s/{short}.m4a"
            snd.append((p, os.path.join(GAME, url), "voice" if a == "voice" else "music"))
        elif m == b"\x00\x00\x01\xba":
            url = f"v/{short}.mp4"
            vid.append((p, os.path.join(GAME, url)))
        elif m[:2] == b"\xff\xfe" and (base.endswith(".ks") or base.endswith(".tjs")):
            texts[n] = open(p, "rb").read()[2:].decode("utf-16le")
            continue
        else:
            continue
        for k in (base, stem):
            manifest.setdefault(k, url)
    # loop info (.sli) : try "<name>.sli" for every known ogg name
    from hashlib import blake2s
    seed = "xp3hnp".encode("utf-16le")
    byhash = {f: (a, d) for a, d, dn, f, n in allrows}
    for a, d, dn, f, n in allrows:
        if n.lower().endswith(".ogg"):
            h = blake2s((n + ".sli").encode("utf-16le") + seed, digest_size=32).hexdigest()
            if h in byhash:
                t = open(src(*byhash[h], h), "rb").read().decode("utf-8", "replace")
                links = [(int(x), int(y)) for x, y in re.findall(r"From=(\d+);\s*To=(\d+);", t)]
                if links:
                    loops[n.lower().rsplit(".", 1)[0]] = links[0]
    if only in (None, "data"):
        with open(os.path.join(GAME, "data", "manifest.js"), "w", encoding="utf-8") as o:
            o.write("window.MANIFEST=" + json.dumps(manifest, ensure_ascii=False) + ";\n")
            o.write("window.LOOPS=" + json.dumps(loops, ensure_ascii=False) + ";\n")
        with open(os.path.join(GAME, "data", "scripts.js"), "w", encoding="utf-8") as o:
            o.write("window.SCRIPTS=" + json.dumps(texts, ensure_ascii=False) + ";\n")
        print("manifest", len(manifest), "texts", len(texts), "loops", len(loops), flush=True)
    with Pool(os.cpu_count()) as pool:
        if only in (None, "img"):
            for i, _ in enumerate(pool.imap_unordered(conv_img, img, chunksize=8)):
                if i % 500 == 0:
                    print("img", i, len(img), flush=True)
        if only in (None, "snd"):
            for i, _ in enumerate(pool.imap_unordered(conv_snd, snd, chunksize=8)):
                if i % 1000 == 0:
                    print("snd", i, len(snd), flush=True)
    if only in (None, "vid"):
        with Pool(4) as pool:
            for _ in pool.imap_unordered(conv_vid, vid):
                print("vid done", flush=True)
    print("ALL DONE", flush=True)


if __name__ == "__main__":
    main()
