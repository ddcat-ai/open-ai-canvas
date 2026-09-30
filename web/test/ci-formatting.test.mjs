import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkChangedFormatting } from "../scripts/check-changed-formatting.mjs";

const temporaryDirectories = [];
afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(initialFiles = {}) {
    const root = mkdtempSync(path.join(os.tmpdir(), "canvas-ci-format-"));
    temporaryDirectories.push(root);
    const cwd = path.join(root, "web");
    mkdirSync(cwd);
    const git = (...args) => {
        const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
        if (result.status !== 0) throw new Error(result.stderr);
        return result.stdout.trim();
    };
    const write = (name, content) => writeFileSync(path.join(cwd, name), content);
    git("init", "-q");
    git("config", "user.email", "ci-test@example.invalid");
    git("config", "user.name", "CI fixture");
    write(".prettierrc.json", '{ "printWidth": 80 }\n');
    write(".prettierignore", "ignored.js\n");
    for (const [name, content] of Object.entries(initialFiles)) write(name, content);
    const commit = () => {
        git("add", ".");
        git("-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
        return git("rev-parse", "HEAD");
    };
    const baseSha = commit();
    const messages = [];
    return { cwd, git, write, commit, baseSha, messages, check: (options = {}) => checkChangedFormatting({ cwd, baseSha, headSha: "HEAD", log: (message) => messages.push(message), ...options }) };
}

describe("changed-file formatting gate", () => {
    test("checks files relative to web, supports spaces, and rejects a new formatting regression", async () => {
        const repo = fixture({ "has space.ts": "const value = 1;\n" });
        repo.write("has space.ts", "const value=2;\n");
        repo.commit();
        await expect(repo.check()).rejects.toThrow("has space.ts");
    });

    test("skips legacy formatting without creating a broken pipe", async () => {
        const repo = fixture({ "legacy.ts": "const value=1;\n" });
        repo.write("legacy.ts", "const value=2;\n");
        repo.commit();
        await repo.check();
        expect(repo.messages).toContain("Skipping legacy unformatted file: legacy.ts");
    });

    test("checks added files and respects prettierignore", async () => {
        const repo = fixture();
        repo.write("ignored.js", "const invalid = ;");
        repo.write("added.ts", "const value=1;\n");
        repo.commit();
        await expect(repo.check()).rejects.toThrow("added.ts");
        repo.write("added.ts", "const value = 1;\n");
        await repo.check();
    });

    test("syntax errors are failures, not legacy-format skips", async () => {
        const repo = fixture({ "broken.ts": "const value = ;\n" });
        repo.write("broken.ts", "const value = 1;\n");
        repo.commit();
        await expect(repo.check()).rejects.toThrow();
        expect(repo.messages).toEqual([]);
    });

    test("unavailable explicit base SHA falls back to the head parent", async () => {
        const repo = fixture();
        repo.write("changed.ts", "const value=1;\n");
        repo.commit();
        await expect(repo.check({ baseSha: "f".repeat(40) })).rejects.toThrow("changed.ts");
        expect(repo.messages).toContain(`Base SHA ${"f".repeat(40)} is unavailable; checking against the head parent instead.`);
    });

    test("malformed explicit base SHA fails closed", async () => {
        const repo = fixture();
        await expect(repo.check({ baseSha: "not-a-sha" })).rejects.toThrow("Invalid base SHA");
    });

    test("zero before SHA compares the parent commit", async () => {
        const repo = fixture({ "existing.ts": "const value = 1;\n" });
        repo.write("existing.ts", "const value=2;\n");
        repo.commit();
        await expect(repo.check({ baseSha: "0".repeat(40) })).rejects.toThrow("existing.ts");
    });

    test("an initial commit checks the whole tree", async () => {
        const repo = fixture({ "new.ts": "const value=1;\n" });
        await expect(repo.check({ baseSha: "0".repeat(40) })).rejects.toThrow("new.ts");
    });

    test("deletions do not attempt to read missing files", async () => {
        const repo = fixture({ "deleted.ts": "const value = 1;\n" });
        repo.git("rm", "web/deleted.ts");
        repo.commit();
        await repo.check();
    });
});
