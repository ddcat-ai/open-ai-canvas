from pathlib import Path

ROOT = Path.cwd()
TEXT_EXTENSIONS = {".ts", ".tsx", ".go", ".mjs", ".json", ".css", ".md", ".mdx", ".yaml", ".yml", ".html", ".glsl", ".txt"}
SCAN_ROOTS = [
    ROOT / "web" / "src",
    ROOT / "web" / "test",
    ROOT / "web" / "scripts",
    ROOT / "backend" / "internal",
    ROOT / "web" / "package.json",
    ROOT / "README.md",
    ROOT / "docs",
]


def iter_files():
    for root in SCAN_ROOTS:
        if root.is_file():
            yield root
            continue
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.is_file() and path.suffix in TEXT_EXTENSIONS:
                yield path


def rewrite_text(text: str) -> str:
    replacements = [
        ("director-desk", "previs"),
        ("Director", "Previs"),
        ("DIRECTOR", "PREVIS"),
        ("director", "previs"),
        ("导演台", "预演台"),
    ]
    for old, new in replacements:
        text = text.replace(old, new)
    return text


files = list(iter_files())
for path in files:
    try:
        before = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    after = rewrite_text(before)
    if after != before:
        path.write_text(after, encoding="utf-8")

rename_targets = []
for root in [ROOT / "web" / "src", ROOT / "web" / "scripts", ROOT / "backend" / "internal", ROOT / "web" / "public"]:
    if not root.exists():
        continue
    for path in root.rglob("*"):
        if path.is_file() and "director" in path.name.lower():
            rename_targets.append(path)

for path in sorted(rename_targets, key=lambda item: len(item.parts), reverse=True):
    new_name = path.name.replace("director", "previs").replace("Director", "Previs").replace("DIRECTOR", "PREVIS")
    target = path.with_name(new_name)
    if target != path:
        target.parent.mkdir(parents=True, exist_ok=True)
        path.rename(target)

for path in [ROOT / "web" / "src" / "components" / "canvas" / "director", ROOT / "web" / "src" / "lib" / "canvas" / "director"]:
    if path.exists():
        target = path.with_name("previs")
        if not target.exists():
            path.rename(target)

print(f"rewritten={len(files)} renamed={len(rename_targets)}")
