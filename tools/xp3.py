"""Minimal KiriKiri2 XP3 archive reader/extractor."""
import struct, zlib, sys, os

MAGIC = b"XP3\r\n \n\x1a\x8bg\x01"


def read_index(f):
    f.seek(0)
    if f.read(11) != MAGIC:
        raise ValueError("not xp3")
    off = struct.unpack("<Q", f.read(8))[0]
    while True:
        f.seek(off)
        flag = f.read(1)[0]
        if flag & 0x80 == 0x80 and flag & 0x7f == 0:  # version-2 continue header
            pass
        if flag == 0x80:
            f.read(8)
            off = struct.unpack("<Q", f.read(8))[0]
            continue
        if flag & 0x07 == 1:
            csize, usize = struct.unpack("<QQ", f.read(16))
            return zlib.decompress(f.read(csize))
        usize = struct.unpack("<Q", f.read(8))[0]
        return f.read(usize)


def parse(idx):
    entries = []
    p = 0
    while p < len(idx):
        tag = idx[p:p + 4]
        size = struct.unpack("<Q", idx[p + 4:p + 12])[0]
        body = idx[p + 12:p + 12 + size]
        p += 12 + size
        if tag != b"File":
            entries.append({"tag": tag, "raw": body})
            continue
        e = {"tag": tag, "segs": [], "chunks": {}}
        q = 0
        while q < len(body):
            t = body[q:q + 4]
            s = struct.unpack("<Q", body[q + 4:q + 12])[0]
            b = body[q + 12:q + 12 + s]
            q += 12 + s
            e["chunks"][t] = b
            if t == b"info":
                e["flags"] = struct.unpack("<I", b[:4])[0]
                e["usize"], e["asize"] = struct.unpack("<QQ", b[4:20])
                n = struct.unpack("<H", b[20:22])[0]
                e["name"] = b[22:22 + n * 2].decode("utf-16le")
            elif t == b"segm":
                for i in range(0, len(b), 28):
                    fl, start, us, cs = struct.unpack("<IQQQ", b[i:i + 28])
                    e["segs"].append((fl, start, us, cs))
            elif t == b"adlr":
                e["adler"] = struct.unpack("<I", b[:4])[0]
        entries.append(e)
    return entries


def read_file(f, e):
    out = bytearray()
    for fl, start, us, cs in e["segs"]:
        f.seek(start)
        d = f.read(cs)
        if fl & 7 == 1:
            d = zlib.decompress(d)
        out += d
    return bytes(out)


if __name__ == "__main__":
    path = sys.argv[1]
    with open(path, "rb") as f:
        ents = parse(read_index(f))
        files = [e for e in ents if e["tag"] == b"File"]
        others = [e["tag"] for e in ents if e["tag"] != b"File"]
        print("files", len(files), "other chunks", set(others))
        if len(sys.argv) > 2 and sys.argv[2] == "list":
            for e in files[: int(sys.argv[3]) if len(sys.argv) > 3 else None]:
                print(hex(e["flags"]), e["usize"], e["name"], [k for k in e["chunks"]])
        elif len(sys.argv) > 2 and sys.argv[2] == "x":
            outdir = sys.argv[3]
            for e in files:
                d = read_file(f, e)
                op = os.path.join(outdir, e["name"].replace("\\", "/"))
                os.makedirs(os.path.dirname(op) or outdir, exist_ok=True)
                with open(op, "wb") as o:
                    o.write(d)
