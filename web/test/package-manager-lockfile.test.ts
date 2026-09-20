import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

test("web does not keep a second package manager lockfile", () => {
    const leftover = [
        resolve(import.meta.dir, "../pnpm-lock.yaml"),
        resolve(import.meta.dir, "../package-lock.json"),
        resolve(import.meta.dir, "../yarn.lock"),
    ].filter((path) => existsSync(path));
    expect(leftover).toEqual([]);
});

test("web package.json declares Bun as the package manager", async () => {
    const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json();
    expect(manifest.packageManager).toBe("bun@1.3.9");
    expect(manifest.pnpm).toBeUndefined();
});
