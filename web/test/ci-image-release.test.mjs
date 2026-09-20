import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scripts = fileURLToPath(new URL("../../.github/scripts/", import.meta.url));
const temporaryDirectories = [];
const sha = "a".repeat(40);
const digest = "b".repeat(64);
afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(overrides = {}) {
    const root = mkdtempSync(path.join(os.tmpdir(), "canvas-ci-image-"));
    temporaryDirectories.push(root);
    const bin = path.join(root, "bin");
    const digests = path.join(root, "digests");
    mkdirSync(bin);
    mkdirSync(digests);
    writeFileSync(path.join(digests, digest), "");
    writeFileSync(path.join(bin, "docker"), '#!/bin/sh\nif [ "$3" = inspect ]; then\n  if [ -n "$MOCK_ERROR" ]; then printf "%s\\n" "$MOCK_ERROR" >&2; exit 1; fi\n  printf "%s\\n" "$MOCK_DIGEST"\nelse\n  printf "%s\\n" "$@" > "$MOCK_CALL"\nfi\n', {
        mode: 0o755,
    });
    writeFileSync(path.join(bin, "gh"), '#!/bin/sh\nif [ -n "$MOCK_GH_ERROR" ]; then exit 1; fi\nprintf "%s\\n" "$MOCK_MAIN"\n', { mode: 0o755 });
    const output = path.join(root, "output");
    writeFileSync(output, "");
    const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_OUTPUT: output,
        GITHUB_SHA: sha,
        GITHUB_REF: "refs/heads/main",
        GITHUB_REPOSITORY: "fixture/repo",
        IMAGE: "ghcr.io/fixture/image",
        VERSION_TAG: "1.5.5",
        EXPECTED_DIGESTS: "1",
        DIGEST_DIR: digests,
        MOCK_DIGEST: `sha256:${digest}`,
        MOCK_ERROR: "",
        MOCK_GH_ERROR: "",
        MOCK_MAIN: sha,
        MOCK_CALL: path.join(root, "docker-call"),
        ...overrides,
    };
    return {
        run: (script, ...args) => spawnSync("bash", [path.join(scripts, script), ...args], { env, encoding: "utf8" }),
        output: () => readFileSync(output, "utf8"),
        call: () => (existsSync(env.MOCK_CALL) ? readFileSync(env.MOCK_CALL, "utf8") : ""),
    };
}

describe("commit image reuse", () => {
    test("reuses the exact existing digest", () => {
        const repo = fixture();
        expect(repo.run("resolve-image.sh", "ghcr.io/fixture/image:sha-test").status).toBe(0);
        expect(repo.output()).toBe(`found=true\ndigest=sha256:${digest}\n`);
    });
    test("only a missing manifest permits a rebuild", () => {
        const repo = fixture({ MOCK_ERROR: "ERROR: ghcr.io/fixture/image:sha-test: not found" });
        expect(repo.run("resolve-image.sh", "ghcr.io/fixture/image:sha-test").status).toBe(0);
        expect(repo.output()).toBe("found=false\n");
    });
    for (const error of ["ERROR: unauthorized", "ERROR: 429 Too Many Requests", "ERROR: dial tcp: i/o timeout", "ERROR: certificate file: not found: authentication failed"]) {
        test(`fails closed on ${error}`, () => {
            const repo = fixture({ MOCK_ERROR: error });
            expect(repo.run("resolve-image.sh", "ghcr.io/fixture/image:sha-test").status).not.toBe(0);
            expect(repo.output()).toBe("");
        });
    }
    test("rejects malformed successful responses", () => {
        const repo = fixture({ MOCK_DIGEST: "<html>error</html>" });
        expect(repo.run("resolve-image.sh", "ghcr.io/fixture/image:sha-test").status).not.toBe(0);
    });
});

describe("digest promotion", () => {
    test("current main promotes latest and SHA tags using digests", () => {
        const repo = fixture();
        expect(repo.run("promote-image.sh").status).toBe(0);
        expect(repo.call()).toContain("ghcr.io/fixture/image:latest");
        expect(repo.call()).toContain(`ghcr.io/fixture/image@sha256:${digest}`);
        expect(repo.call()).toContain(`ghcr.io/fixture/image:sha-${sha}`);
        expect(repo.call()).not.toContain("ghcr.io/fixture/image:1.5.5");
    });
    test("stale main cannot roll latest back", () => {
        const repo = fixture({ MOCK_MAIN: "c".repeat(40) });
        expect(repo.run("promote-image.sh").status).toBe(0);
        expect(repo.call()).not.toContain(":latest");
    });
    test("tag release promotes the exact version without touching latest", () => {
        const repo = fixture({ GITHUB_REF: "refs/tags/v1.5.5" });
        expect(repo.run("promote-image.sh").status).toBe(0);
        expect(repo.call()).toContain("ghcr.io/fixture/image:1.5.5");
        expect(repo.call()).not.toContain(":latest");
    });
    test("missing architecture blocks every tag update", () => {
        const repo = fixture({ EXPECTED_DIGESTS: "2" });
        expect(repo.run("promote-image.sh").status).not.toBe(0);
        expect(repo.call()).toBe("");
    });
    test("failure to resolve main blocks promotion", () => {
        const repo = fixture({ MOCK_GH_ERROR: "1" });
        expect(repo.run("promote-image.sh").status).not.toBe(0);
        expect(repo.call()).toBe("");
    });
});
