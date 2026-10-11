"""Recover Hxv4 hashed names: collect string tokens from decrypted text/bytecode,
hash candidate names (blake2s file / siphash dir, seed xp3hnp), write out/names.tsv"""
import os, re, sys, json
from hashlib import blake2s
from siphash import SipHash_2_4

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "out")
SEED = "xp3hnp".encode("utf-16le")
ARCS = ["scenario", "data", "bgimage", "fgimage", "voice", "video"]


def fh(s):
    return blake2s(s.encode("utf-16le") + SEED, digest_size=32).hexdigest()


def dh(s):
    h = SipHash_2_4(b"\0" * 16)
    h.update(s.encode("utf-16le") + SEED)
    return h.digest().hex()


def texts():
    for a in ARCS:
        for d in os.listdir(os.path.join(OUT, a)):
            p = os.path.join(OUT, a, d)
            if not os.path.isdir(p):
                continue
            for f in os.listdir(p):
                b = open(os.path.join(p, f), "rb").read()
                if b[:2] == b"\xff\xfe":
                    yield b[2:].decode("utf-16le", "ignore")
                elif b[:4] == b"TJS2":
                    yield b.decode("utf-16le", "ignore")
                    yield b[1:].decode("utf-16le", "ignore")
                elif b[:4] == b"#2.0" or b[:4] == b"TVP ":
                    yield b.decode("utf-8", "ignore")
                    yield b.decode("cp932", "ignore")


def main():
    files = {}  # filehash -> (arc, dirhash)
    dirs = {}
    for a in ARCS:
        for line in open(os.path.join(OUT, a, "index.tsv")):
            d, f, _ = line.split("\t")
            files[f] = (a, d)
            dirs[d] = a
    tokens = set()
    tokre = re.compile(r"[^\s\"'\[\]=,;:|<>()*{}\\/\t\r\n%&+!?#@$^`~]+")
    for t in texts():
        for tok in tokre.findall(t):
            if 0 < len(tok) < 64:
                tokens.add(tok)
                tokens.add(tok.lower())
        for tok in re.findall(r"[\w./-]+", t):
            if len(tok) < 80:
                tokens.add(tok)
                tokens.add(os.path.basename(tok))
    exts = ["", ".png", ".tlg", ".jpg", ".bmp", ".ogg", ".wav", ".ks", ".tjs", ".txt", ".csv", ".mpg",
            ".wmv", ".ttf", ".otf", ".tft", ".asd", ".sli", ".pbd", ".func", ".map", ".ini", ".dll", ".psd", ".stand", ".mtn", ".scn", ".lst", ".cur", ".ico", ".rpg"]
    found = {}
    stems = set()
    for tok in tokens:
        stem = tok.rsplit(".", 1)[0] if "." in tok else tok
        stems.add(stem)
        stems.add(tok)
    # numeric/pattern guesses
    for i in range(0, 1000000) if "--deep" in sys.argv else []:
        stems.add(str(i))
    for s in stems:
        for e in exts:
            for n in {s + e, (s + e).lower()}:
                h = fh(n)
                if h in files:
                    found[h] = n
    dnames = {}
    cand = set()
    for t in tokens:
        for x in {t, t.lower()}:
            cand.add(x + "/")
            cand.add(x)
    cand |= {"", "/", "./"}
    for c in cand:
        h = dh(c)
        if h in dirs:
            dnames[h] = c
    with open(os.path.join(OUT, "names.tsv"), "w", encoding="utf-8") as o:
        for f, (a, d) in sorted(files.items(), key=lambda x: x[1]):
            o.write(f"{a}\t{d}\t{dnames.get(d, '?')}\t{f}\t{found.get(f, '?')}\n")
    for a in ARCS:
        tot = sum(1 for v in files.values() if v[0] == a)
        ok = sum(1 for f, v in files.items() if v[0] == a and f in found)
        print(a, ok, "/", tot)
    print("dirs", {d: dnames.get(d, "?") for d in dirs})


main()
