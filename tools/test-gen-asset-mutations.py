#!/usr/bin/env python3
"""Step 1b guard mutations; use the same cached Go/Node environment as the repro."""
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
env = dict(os.environ, CANVAS_TEST_GENERATION_BROWSER_RUNNER=str(root / "tools/test-gen-asset-browser.cjs"))


def check(name, scenario, evidence, extra=None):
    result = subprocess.run(
        ["go", "-C", "backend", "test", "./internal/app", "-run", f"^TestGeneratedAssetBrowserIdentity/{scenario}$", "-count=1", "-v"],
        cwd=root, env=dict(env, **(extra or {})), text=True, capture_output=True, timeout=120,
    )
    output = result.stdout + result.stderr
    if result.returncode == 0 or evidence not in output:
        raise AssertionError(f"{name}: mutation survived or failed for an unrelated reason\n{output}")
    print(f"KILLED {name}: {evidence}", flush=True)


for name, scenario, evidence in [
    ("adoption", "agent-live", "生成素材尚未加载"),
    ("managed", "agent-without-id", "Missing expected rejection"),
    ("repair", "agent-without-id", "修复不能为受管产物建立随机素材"),
    ("lookup", "reopen-edited", "browser PUT count"),
    ("skipPut", "reopen-edited", "browser PUT count"),
    ("lookupFailure", "remote-unavailable", "Missing expected rejection"),
    ("dropLocal", "edit-before-get", "local edit must survive sync and retry"),
    ("dropRemote", "edit-disjoint", "field merge must preserve the remote-only edit"),
    ("ignoreConflict", "edit-conflict", "both edited must surface the normal asset conflict"),
    ("dropRemote", "reopen-edited", "browser PUT count"),
    ("retryDropsLocal", "edit-during-get", "local edit must survive sync and retry"),
    ("staleGet", "edit-during-get", "GET edit must stop stale adoption"),
    ("categoryDefault", "edit-category", "generated category must be material"),
    ("stableMedia", "edit-display-url", "素材远端版本已变化"),
    ("clientMetadata", "edit-metadata", "素材远端版本已变化"),
    ("storedMetadata", "edit-before-get", "stored metadata must survive: clientContext"),
    ("storedMetadata", "edit-category", "stored metadata must survive: clientContext"),
    ("localContext", "edit-disjoint", "stored metadata must survive: clientContext"),
]:
    check(name, scenario, evidence, {"CANVAS_TEST_GENERATION_GUARD_MUTATION": name})

# Go mutation is restored even on failure; never run this alongside another Go test.
file = root / "backend/internal/app/cloud_agent_media.go"
original = file.read_bytes()
needle = b'meta["assetId"] = assetID'
assert original.count(needle) == 1
try:
    file.write_bytes(original.replace(needle, b'// mutation: omit the registered asset identity'))
    check("writeback", "agent-reopen", "Agent writeback identity")
finally:
    file.write_bytes(original)

file = root / "backend/internal/app/task_media_assets.go"
original = file.read_bytes()
for name, needle, replacement, scenario, evidence in [
    ("imageTitle", '"image": "生成图片"', '"image": "生成作品"', "edit-before-get", "backend/frontend title defaults must agree"),
    ("videoTitle", '"video": "生成视频"', '"video": "生成作品"', "edit-video", "backend/frontend title defaults must agree"),
    ("audioTitle", '"audio": "生成音频"', '"audio": "生成作品"', "edit-audio", "backend/frontend title defaults must agree"),
    ("sourceDefault", '"source": "生成任务", ', '', "edit-source", "backend/frontend source defaults must agree"),
]:
    needle, replacement = needle.encode(), replacement.encode()
    assert original.count(needle) == 1
    try:
        file.write_bytes(original.replace(needle, replacement))
        check(name, scenario, evidence)
    finally:
        file.write_bytes(original)
