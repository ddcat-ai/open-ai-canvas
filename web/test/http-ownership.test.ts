import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

function walkSourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkSourceFiles(path));
            continue;
        }
        if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
    }
    return files;
}

const webRoot = resolve(import.meta.dir, "..");
const srcRoot = resolve(webRoot, "src");
const sourcePath = (file: string) => relative(srcRoot, file).split(sep).join("/");

const axiosAllowed = new Set(["services/api/request.ts", "services/api/channel-transport.ts", "services/api/image-response.ts", "services/api/video-response.ts", "services/diagnostics/client-diagnostics.ts"]);

test("business API modules call http instead of axios or request(apiClient)", () => {
    const offenders = walkSourceFiles(resolve(srcRoot, "services"))
        .filter((file) => {
            const rel = sourcePath(file);
            if (axiosAllowed.has(rel)) return false;
            const source = readFileSync(file, "utf8");
            return /from ["']axios["']/.test(source) || /request\s*(?:<[^>]+>)?\s*\(\s*apiClient\./.test(source) || /const api = apiClient/.test(source);
        })
        .map((file) => sourcePath(file));
    expect(offenders).toEqual([]);
});

test("axios.create stays in the shared request client", () => {
    const offenders = walkSourceFiles(srcRoot)
        .filter((file) => {
            if (sourcePath(file) === "services/api/request.ts") return false;
            return readFileSync(file, "utf8").includes("axios.create(");
        })
        .map((file) => sourcePath(file));
    expect(offenders).toEqual([]);
});

test("copied flush Modal padding lives only in AppModal", () => {
    const banned = ['styles={{ container: { padding: 0, overflow: "hidden" }, body: { padding: 0 } }}', "styles={{ container: { padding: 0 }, body: { padding: 0 } }}"];
    const offenders = walkSourceFiles(srcRoot)
        .filter((file) => {
            if (sourcePath(file) === "components/ui/product/app-modal/app-modal.tsx") return false;
            const source = readFileSync(file, "utf8");
            return banned.some((snippet) => source.includes(snippet));
        })
        .map((file) => sourcePath(file));
    expect(offenders).toEqual([]);
});
