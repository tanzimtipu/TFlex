import re, sys, os
sys.stdout.reconfigure(encoding="utf-8")
DIFF = r"C:\Users\tanzi\AppData\Local\Temp\paperclip-run-tfl-573-d72a5ad2-fca-uZ9Et4\opencode\phase94_renderer.diff"
TOK = {"xs":14,"sm":16,"md":18,"lg":20,"xl":22,"hero":32}

cur_file = None
rem = []  # (glyph, size_or_None, line)
add = []
def flush():
    global rem, add
    if not rem and not add:
        return
    # pair by order
    for i, (g, s, ln) in enumerate(rem):
        # find matching add glyph
        a = next(((ag, at, aln) for (ag, at, aln) in add if ag == g), None)
        if a is None:
            # glyph not re-added in this block (may be re-added elsewhere); skip
            continue
        ag, at, aln = a
        oldpx = int(s) if s and s.isdigit() else None
        newpx = TOK.get(at) if at else None
        if oldpx is not None and newpx is not None and oldpx != newpx:
            print(f"{cur_file} : {g} {oldpx} -> {at}({newpx})  | -{ln[:70]} | +{aln[:70]}")
    rem = []
    add = []

add_re = re.compile(r"<Icon\b[^>]*icon=\{([A-Za-z0-9_.]+)\}[^>]*size=\"([a-z]+)\"")
rem_re = re.compile(r"<([A-Z][A-Za-z0-9]+)\b[^>]*\bsize=\{([0-9.]+)\}")

with open(DIFF, encoding="utf-8") as f:
    for line in f:
        if line.startswith("diff --git"):
            flush()
            cur_file = line.strip().split(" b/")[-1]
            continue
        if line.startswith("@@"):
            flush()
            continue
        if line.startswith("---") or line.startswith("+++"):
            continue
        if line.startswith("-"):
            m = rem_re.search(line)
            if m:
                rem.append((m.group(1), m.group(2), line[1:].strip()))
        elif line.startswith("+"):
            m = add_re.search(line)
            if m:
                add.append((m.group(1).split(".")[-1], m.group(2), line[1:].strip()))
            else:
                # direct render addition with size (exceptions)
                m2 = re.search(r"<([A-Z][A-Za-z0-9]+)\b[^>]*\bsize=\{", line)
                if m2:
                    add.append((m2.group(1), "?", line[1:].strip()))
        else:
            flush()
    flush()
