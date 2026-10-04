import subprocess, re, sys, os
sys.stdout.reconfigure(encoding="utf-8")
REPO = r"C:\Users\tanzi\OneDrive\App Development\TFlex"
GIT = r"C:/Users/tanzi/AppData/Roaming/kimi-desktop/daimon-bundle/runtime/git/cmd/git.exe"
def git(*a):
    return subprocess.run([GIT,"-C",REPO,*a],capture_output=True,text=True,encoding="utf-8",errors="replace").stdout
files = [l.strip() for l in git("diff","HEAD","--name-only","--","src/renderer").splitlines() if l.strip().endswith((".ts",".tsx"))]
imp = re.compile(r"import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+[\"']lucide-react[\"']",re.S)
for path in files:
    try: t=open(os.path.join(REPO,path),encoding="utf-8").read()
    except: continue
    names=set()
    for m in imp.finditer(t):
        for raw in m.group(1).split(","):
            n=raw.strip().split(" as ")[-1].strip()
            if n and n!="LucideIcon": names.add(n)
    if not names: continue
    hits=[]
    for i,line in enumerate(t.split("\n")):
        for n in names:
            if re.search(r"<"+re.escape(n)+r"(?![A-Za-z0-9])",line) and "<Icon" not in line:
                hits.append((i+1,n,line.strip()))
    if hits:
        print(f"=== {path}")
        for ln,n,l in hits:
            print(f"   {ln}: {n}: {l[:120]}")
