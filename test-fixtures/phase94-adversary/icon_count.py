import subprocess, re, sys, os
sys.stdout.reconfigure(encoding="utf-8")

REPO = r"C:\Users\tanzi\OneDrive\App Development\TFlex"
GIT = r"C:/Users/tanzi/AppData/Roaming/kimi-desktop/daimon-bundle/runtime/git/cmd/git.exe"

def git(*args):
    return subprocess.run([GIT, "-C", REPO, *args], capture_output=True, text=True, encoding="utf-8", errors="replace").stdout

def changed_renderer_files():
    out = git("diff", "HEAD", "--name-only", "--", "src/renderer")
    return [l.strip() for l in out.splitlines() if l.strip().endswith((".ts", ".tsx"))]

import_re = re.compile(r"import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+[\"']lucide-react[\"']", re.S)

def lucide_names(text):
    names = set()
    for m in import_re.finditer(text):
        for raw in m.group(1).split(","):
            n = raw.strip().split(" as ")[-1].strip()
            if n and n != "LucideIcon":
                names.add(n)
    return names

def count_usage(text, n):
    lines = text.split("\n")
    c = 0
    for line in lines:
        if re.search(r"<" + re.escape(n) + r"(?![A-Za-z0-9])", line) \
           or re.search(r"(?:^|[\s{(])[iI]con:\s*" + re.escape(n) + r"\b", line) \
           or re.search(r"[iI]con=\{\s*" + re.escape(n) + r"\b", line):
            c += 1
    return c

for path in changed_renderer_files():
    head = git("show", f"HEAD:{path}")
    try:
        cur = open(os.path.join(REPO, path), encoding="utf-8").read()
    except Exception:
        continue
    if "lucide-react" not in head and "lucide-react" not in cur:
        continue
    hn = lucide_names(head)
    cn = lucide_names(cur)
    diffs = []
    for n in sorted(hn | cn):
        hc = count_usage(head, n) if head else 0
        cc = count_usage(cur, n) if n in cn else 0
        if hc != cc:
            diffs.append(f"{n}:{hc}->{cc}")
    if diffs:
        print(f"{path}: " + ", ".join(diffs))
