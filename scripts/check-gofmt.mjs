#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.join(root, "backend");
const tempParent = path.resolve(tmpdir());
const tempRoot = mkdtempSync(path.join(tempParent, "yingce-gofmt-"));

function copyGoFiles(sourceRoot, destinationRoot) {
    for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".local") continue;
        const source = path.join(sourceRoot, entry.name);
        const destination = path.join(destinationRoot, entry.name);
        if (entry.isDirectory()) {
            copyGoFiles(source, destination);
        } else if (entry.isFile() && entry.name.endsWith(".go")) {
            mkdirSync(path.dirname(destination), { recursive: true });
            const content = readFileSync(source, "utf8").replace(/\r\n/g, "\n");
            writeFileSync(destination, content);
        }
    }
}

try {
    if (!tempRoot.startsWith(`${tempParent}${path.sep}`)) throw new Error("Go format temp path escaped the system temp directory");
    copyGoFiles(backend, tempRoot);
    const result = spawnSync("gofmt", ["-l", "."], {
        cwd: tempRoot,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        process.stderr.write(result.stderr || `gofmt exited with ${result.status}\n`);
        process.exitCode = result.status || 1;
    } else if (result.stdout.trim()) {
        process.stdout.write(result.stdout.trim().split(/\r?\n/).map((file) => `backend/${file}`).join("\n") + "\n");
        process.exitCode = 1;
    }
} finally {
    rmSync(tempRoot, { recursive: true, force: true });
}
