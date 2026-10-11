#!/usr/bin/env python3
"""Post-build step (run in WSL): drop the duplicate Game/ copy inside the SwiftPM resource bundle
of xtool/Braban.app and repackage it with the skill's verified package_app().
usage: dedup_package.py <project> <output.ipa>"""
import json, shutil, sys
from pathlib import Path

sys.path.insert(0, "/mnt/c/Users/hikage/.claude/skills/wsl-swift-ipa/scripts")
import build_ipa  # noqa: E402

project, out = Path(sys.argv[1]).expanduser(), Path(sys.argv[2]).expanduser()
app = project / "xtool" / "Braban.app"
dup = app / "Braban_Braban.bundle" / "Game"
root_game = app / "Game"
assert (root_game / "index.html").is_file(), "root Game/ missing"
if dup.is_dir():
    shutil.rmtree(dup)
out.parent.mkdir(parents=True, exist_ok=True)
report = build_ipa.package_app(app, out, "local.braban.player")
print(json.dumps(report, indent=2))
