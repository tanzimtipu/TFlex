import subprocess, re, sys, os
sys.stdout.reconfigure(encoding="utf-8")

REPO = r"C:\Users\tanzi\OneDrive\App Development\TFlex"
GIT = r"C:/Users/tanzi/AppData/Roaming/kimi-desktop/daimon-bundle/runtime/git/cmd/git.exe"

def git(*args):
    return subprocess.run([GIT, "-C", REPO, *args], capture_output=True, text=True, encoding="utf-8", errors="replace").stdout

def changed_renderer_files():
    out = git("diff", "HEAD", "--name-only", "--", "src/renderer")
    return [l.strip() for l in out.splitlines() if l.strip().endswith((".ts", ".tsx"))]

def head_content(path):
    return git("show", f"HEAD:{path}")

def cur_content(path):
    with open(os.path.join(REPO, path), encoding="utf-8") as f:
        return f.read()

import_re = re.compile(r"import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+[\"']lucide-react[\"']", re.S)

def lucide_names(text):
    names = set()
    for m in import_re.finditer(text):
        for raw in m.group(1).split(","):
            n = raw.strip().split(" as ")[-1].strip()
            if n and n != "LucideIcon":
                names.add(n)
    return names

def usages(text, names):
    counts = {}
    lines = text.split("\n")
    for i, line in enumerate(lines):
        for n in names:
            used = bool(re.search(r"<" + re.escape(n) + r"(?![A-Za-z0-9])", line)) \
                or bool(re.search(r"(?:^|[\s{(])[iI]con:\s*" + re.escape(n) + r"\b", line)) \
                or bool(re.search(r"[iI]con=\{\s*" + re.escape(n) + r"\b", line))
            if used:
                counts.setdefault(n, []).append((i+1, line.strip()))
    return counts

for path in changed_renderer_files():
    head = head_content(path)
    cur = cur_content(path)
    if "lucide-react" not in head and "lucide-react" not in cur:
        continue
    hn = lucide_names(head)
    cn = lucide_names(cur)
    hu = usages(head, hn)
    cu = usages(cur, cn)
    dropped = []
    for n in hu:
        # glyph existed at HEAD but has no usage now (and is not even imported)
        if n not in cn:
            dropped.append((n, hu[n][0][1]))
    if dropped:
        print(f"=== {path}")
        for n, sample in dropped:
            print(f"   DROPPED GLYPH {n}: HEAD used at: {sample}")
