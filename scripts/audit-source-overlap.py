#!/usr/bin/env python3
"""Triage source overlap in tracked and non-ignored untracked working-tree files.

Exact resources and normalized line blocks need separate provenance review.
This tool does not establish ownership or independent implementation.
"""
import argparse
from collections import defaultdict
import difflib
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".css", ".mdx"}
MIN_LINES = 5
MIN_CHARACTERS = 160


def normalized_lines(name, content):
    if Path(name).suffix not in SOURCE_SUFFIXES:
        return None
    try:
        return [line.strip() for line in content.decode().splitlines()]
    except UnicodeDecodeError:
        return None


def seeds(lines):
    # Every retained block has at least one five-line seed. Do not filter short
    # seeds: a longer qualifying block can consist entirely of short lines.
    return {tuple(lines[i:i + MIN_LINES]) for i in range(len(lines) - MIN_LINES + 1)}


def matching_report(name, baseline_name, old, current):
    blocks = [
        block for block in difflib.SequenceMatcher(None, old, current, autojunk=False).get_matching_blocks()
        if block.size >= MIN_LINES and sum(map(len, old[block.a:block.a + block.size])) >= MIN_CHARACTERS
    ]
    if not blocks:
        return None
    return {
        "file": name, "baseline_file": baseline_name,
        "baseline_lines": len(old), "current_lines": len(current),
        "matched_lines": sum(block.size for block in blocks),
        "blocks": [{"baseline_start": block.a + 1, "current_start": block.b + 1, "lines": block.size} for block in blocks],
    }


def audit(baseline, current):
    by_hash = defaultdict(list)
    index = defaultdict(set)
    sources = {}
    for name, content in baseline.items():
        by_hash[hashlib.sha256(content).hexdigest()].append(name)
        lines = normalized_lines(name, content)
        if lines is not None:
            sources[name] = lines
            for seed in seeds(lines):
                index[seed].add(name)

    exact, same_path, cross_path = [], [], []
    for name, content in sorted(current.items()):
        digest = hashlib.sha256(content).hexdigest()
        if digest in by_hash:
            exact.append({"file": name, "baseline_files": sorted(by_hash[digest]), "bytes": len(content)})
        lines = normalized_lines(name, content)
        if lines is None:
            continue
        candidates = {name} if name in sources else set()
        for seed in seeds(lines):
            candidates.update(index.get(seed, ()))
        for baseline_name in sorted(candidates):
            report = matching_report(name, baseline_name, sources[baseline_name], lines)
            if report:
                (same_path if name == baseline_name else cross_path).append(report)

    order = lambda item: (-item["matched_lines"], item["file"], item["baseline_file"])
    return {
        "baseline_files": len(baseline), "working_tree_files": len(current),
        "exact": exact, "same_path_blocks": sorted(same_path, key=order),
        "cross_path_blocks": sorted(cross_path, key=order),
        "limitations": "Exact hashes and whitespace-normalized line blocks (at least 5 lines and 160 characters). Includes tracked and non-ignored untracked files; checks cross-path blocks using five-line seeds. Transformed code, shorter blocks and excluded files may be missed. Cross-path totals count file pairs and can double-count lines. Matches are candidates, not ownership conclusions.",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("archive_url")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    archive = subprocess.check_output(["curl", "--fail", "--location", "--silent", "--show-error", "--max-time", "60", args.archive_url])
    baseline = {}
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar.getmembers():
            if member.isfile():
                name = member.name.partition("/")[2]
                if name:
                    baseline[name] = tar.extractfile(member).read()
    paths = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"]).decode().split("\0")
    current = {name: Path(name).read_bytes() for name in sorted(set(paths)) if name and Path(name).is_file()}
    report = {
        "head": subprocess.check_output(["git", "rev-parse", "HEAD"]).decode().strip(),
        "archive_url": args.archive_url,
        "archive_sha256": hashlib.sha256(archive).hexdigest(),
        **audit(baseline, current),
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({
        "report": args.output, "baseline_files": len(baseline), "working_tree_files": len(current),
        "exact_files": len(report["exact"]), "same_path_candidate_files": len(report["same_path_blocks"]),
        "same_path_matched_lines": sum(item["matched_lines"] for item in report["same_path_blocks"]),
        "cross_path_candidate_pairs": len(report["cross_path_blocks"]),
        "largest_cross_path_candidates": [{key: item[key] for key in ("file", "baseline_file", "matched_lines")} for item in report["cross_path_blocks"][:15]],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
