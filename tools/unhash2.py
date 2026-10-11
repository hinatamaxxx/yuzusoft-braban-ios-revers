"""Second pass: envinit-driven candidates (voices, standing images, backgrounds). Updates out/names.tsv"""
import os, re, sys, itertools
from hashlib import blake2s
from multiprocessing import Pool

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "out")
SEED = "xp3hnp".encode("utf-16le")


def fh(s):
    return blake2s(s.encode("utf-16le") + SEED, digest_size=32).hexdigest()


def load():
    rows = [l.rstrip("\n").split("\t") for l in open(os.path.join(OUT, "names.tsv"), encoding="utf-8")]
    return rows


def voice_job(args):
    prefix, suffixes, targets = args
    hits = {}
    for i in range(1000000):
        for sfx in suffixes:
            n = "%s%06d%s.ogg" % (prefix, i, sfx)
            h = fh(n)
            if h in targets:
                hits[h] = n
    return hits


def main():
    rows = load()
    unknown = {r[3] for r in rows if r[4] == "?"}
    env = open(sys.argv[1], encoding="utf-8").read()
    found = {}
    # standing images
    for m in re.finditer(r'"image"\s*=>\s*"(\w+?)_LEVEL_DRESS_FACE".*?"dresses"\s*=>\s*%\[(.*?)\].*?"faces"\s*=>\s*%\[(.*?)\]', env, re.S):
        pre = m.group(1)
        dresses = re.findall(r'=>\s*"(\w+)"', m.group(2))
        faces = re.findall(r'=>\s*"(\w+)"', m.group(3))
        for lv, dr, fc in itertools.product(["0", "1", "2", "f", "3"], dresses + ["0", "1", "2"], faces + ["0"]):
            for ext in [".png", ""]:
                n = f"{pre}_{lv}_{dr}_{fc}{ext}"
                h = fh(n)
                if h in unknown:
                    found[h] = n
    # backgrounds
    for img in re.findall(r'"image"\s*=>\s*"(\w+?)TIME"', env):
        for t in "ABCDEFGH":
            for ext in [".png", ""]:
                n = img + t + ext
                for x in (n, n.lower()):
                    if fh(x) in unknown:
                        found[fh(x)] = x
    print("images", len(found), flush=True)
    prefixes = sorted(set(re.findall(r'"voiceFile"\s*=>\s*"(\w+?)%06d%s\.ogg"', env)))
    print("voice prefixes", prefixes, flush=True)
    with Pool(os.cpu_count()) as p:
        for hits in p.imap_unordered(voice_job, [(pf, ["", "r", "a", "b", "_"], unknown) for pf in prefixes]):
            found.update(hits)
            print("voice hits so far", len(found), flush=True)
    with open(os.path.join(OUT, "names.tsv"), "w", encoding="utf-8") as o:
        for r in rows:
            if r[4] == "?" and r[3] in found:
                r[4] = found[r[3]]
            o.write("\t".join(r) + "\n")
    from collections import Counter
    c, t = Counter(), Counter()
    for r in rows:
        t[r[0]] += 1
        c[r[0]] += r[4] != "?"
    print({k: f"{c[k]}/{t[k]}" for k in t})


if __name__ == "__main__":
    main()
