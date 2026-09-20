import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

export async function checkChangedFormatting({ cwd = process.cwd(), baseSha = process.env.BASE_SHA, headSha = process.env.GITHUB_SHA || "HEAD", log = console.log } = {}) {
    const git = (args) => {
        const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
        return result.stdout;
    };
    const head = git(["rev-parse", "--verify", `${headSha}^{commit}`]).trim();
    // 新分支/tag 的 before 为全零；首次提交没有父提交，改为检查整棵树。
    const base = baseSha && !/^0+$/.test(baseSha) ? git(["rev-parse", "--verify", `${baseSha}^{commit}`]).trim() : git(["rev-list", "--parents", "-n", "1", head]).trim().split(" ")[1];
    const files = (base ? git(["diff", "--relative", "--name-only", "--diff-filter=ACMR", "-z", base, head, "--", "."]) : git(["ls-tree", "-r", "--name-only", "-z", head, "--", "."]))
        .split("\0")
        .filter((file) => /\.(css|html|json|js|jsx|md|mdx|mjs|cjs|ts|tsx|yaml|yml)$/.test(file));
    const prefix = git(["rev-parse", "--show-prefix"]).trim();
    const previousFiles = new Set(base ? git(["ls-tree", "-r", "--name-only", "-z", base, "--", "."]).split("\0") : []);
    const failures = [];
    for (const file of files) {
        const filepath = path.join(cwd, file);
        const info = await prettier.getFileInfo(filepath, { ignorePath: path.join(cwd, ".prettierignore") });
        if (info.ignored) continue;
        const options = { ...(await prettier.resolveConfig(filepath)), filepath };
        // 只允许明确的历史格式问题跳过；语法、Git、文件读取错误全部向上抛出。
        const previous = previousFiles.has(file) ? git(["show", `${base}:${prefix}${file}`]) : null;
        if (previous !== null && !(await prettier.check(previous, options))) {
            log(`Skipping legacy unformatted file: ${file}`);
            continue;
        }
        if (!(await prettier.check(await readFile(filepath, "utf8"), options))) failures.push(file);
    }
    if (failures.length) throw new Error(`Code style issues found:\n${failures.join("\n")}\nRun Prettier with --write to fix.`);
    log("Changed web files passed formatting checks.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    checkChangedFormatting().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
