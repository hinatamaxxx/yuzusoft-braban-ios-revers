"""Fast Hxv4 xp3 extractor built on GalgameReverse krkr_xp3_hxv4 (hash name style).
usage: hxv4_extract.py <xp3> <outdir>
Writes <outdir>/<dirhash>/<filehash> and <outdir>/index.tsv
"""
import os, sys, struct, mmap, zlib, binascii

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "ext", "GalgameReverse", "project", "krkr", "src"))
import krkr_xp3_hxv4 as K  # noqa: E402


def xor_rep(buf, key4):
    n = len(buf)
    if n == 0:
        return buf
    k = (key4 * (n // 4 + 1))[:n]
    return (int.from_bytes(buf, "little") ^ int.from_bytes(k, "little")).to_bytes(n, "little")


def decrypt_content(data, fk):
    buf = bytearray(data)
    hk = fk.header_key
    for i in range(min(len(buf), len(hk))):
        buf[i] ^= hk[i]
    split = fk.split_pos
    for (lo, hi), key in (((0, split), fk.span_key[0]), ((split, len(buf)), fk.span_key[1])):
        hi = min(hi, len(buf))
        if lo >= hi:
            continue
        deckey, first, positions = (key >> 8) & 0xff | ((key >> 8) & 0xff00), key & 0xff, [(key >> 48) & 0xffff, (key >> 32) & 0xffff]
        if positions[0] == positions[1]:
            positions[1] += 1
        if first == 0:
            first = 0xa5
        first *= 0x1010101
        span = bytearray(xor_rep(bytes(buf[lo:hi]), struct.pack("<I", first)))
        for kb, p in zip([deckey & 0xff, (deckey >> 8) & 0xff], positions):
            if p >= lo and p - lo < len(span):
                span[p - lo] ^= kb
        buf[lo:hi] = span
    return buf


def main(xp3, outdir):
    param = K.Hxv4Param()
    import re
    for line in open(os.path.join(ROOT, "keys", "params.txt")):
        m = re.match(r"\* (\w+)(?: \(garbro\))? : (.+)$", line.strip())
        k, v = m.group(1), m.group(2)
        if k in ("key", "nonce", "filterkey"):
            setattr(param, k, binascii.unhexlify(v))
        elif k in ("mask", "offset", "randtype"):
            setattr(param, k, int(v, 0))
        else:
            setattr(param, k.lower(), [int(x) for x in v.split(",")])
    block = open(os.path.join(ROOT, "keys", "control_block.bin"), "rb").read()

    fp = open(xp3, "rb")
    data = mmap.mmap(fp.fileno(), 0, access=mmap.ACCESS_READ)
    xp3entries = K.parse_xp3(data, show_log=False)
    fakemap = {}
    hx = None
    for i, e in enumerate(xp3entries):
        if e.sig == b"Hxv4":
            idx = K.Xp3Hxv4_t.from_buffer_copy(e.data)
            hx = K.parse_hxv4(data[idx.offset: idx.offset + idx.fsize], param.key, param.nonce, show_log=False)
        elif e.sig == b"File" and e.name:
            fakemap[e.name] = i
    s = K.HxSchme()
    s.filter_key, s.random_type, s.offset, s.mask = param.filterkey, param.randtype, param.offset, param.mask
    s.prolog_order, s.odd_branch_order, s.even_branch_order = param.prologorder, param.oddbranchorder, param.evenbranchorder
    s.control_block = [~struct.unpack_from("<I", block, i * 4)[0] for i in range(1024)]
    crypt = K.HxEncryption(s)
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, "index.tsv"), "w") as idxf:
        for n, he in enumerate(hx):
            xe = xp3entries[fakemap[he.fakename]]
            fk = crypt.create_filter_key(he.key, he.id)
            out = bytearray()
            for seg in xe.segms:
                d = data[seg.offset: seg.offset + seg.zsize]
                if seg.fsize != seg.zsize:
                    d = zlib.decompress(d)
                d = decrypt_content(d, fk)
                if len(d) > 5 and d[0] == 0xfe and d[1] == 0xfe and d[3] == 0xff and d[4] == 0xfe:
                    d = K.decrypt_text(memoryview(d)[5:], d[2])
                out += d
            dh, fh = he.dirhash.hex(), he.filehash.hex()
            os.makedirs(os.path.join(outdir, dh), exist_ok=True)
            with open(os.path.join(outdir, dh, fh), "wb") as o:
                o.write(out)
            idxf.write(f"{dh}\t{fh}\t{len(out)}\n")
            if n % 500 == 0:
                print(os.path.basename(xp3), n, len(hx), flush=True)
    print("done", xp3, len(hx), flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
