#!/usr/bin/env bun
/**
 * 推送前本地验证：按 .github/workflows/quality.yml 的口径，只检查本次改动涉及的部分，并行运行。
 *
 *   bun scripts/verify-before-push.mjs              # 按相对 origin/main 的改动自动选择 Web / 后端检查
 *   bun scripts/verify-before-push.mjs --all        # Web 与后端全部检查
 *   bun scripts/verify-before-push.mjs --only web   # 只跑 Web（迭代时用；推送前最后一次用默认范围）
 *
 * 选项：--base <ref>（默认 origin/main）、--jobs <n>（同时运行的检查数，默认 CPU 核数）、
 *       --app-shards <n>（internal/app 用例分片数，默认 4，与 CI 一致）、--skip-e2e、--only web|backend、--all。
 * 预演台 Chrome E2E 只在 web/ 下路径含 previs 的改动或 --all 时运行。
 *
 * 各检查的完整输出写入 .local/cache/verify/<检查名>.log，失败时打印末尾。任一检查失败退出码为 1。
 * 只读取 Git 状态，不修改工作区、暂存区或分支；工作区有未提交改动时，格式检查用临时提交对象覆盖它们。
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const BACKEND = path.join(ROOT, "backend");
const PI_RUNTIME = path.join(BACKEND, "agent-runtime", "pi");
const LOG_DIR = path.join(ROOT, ".local", "cache", "verify");
const TASK_TIMEOUT_MS = 25 * 60 * 1000;

const options = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
    const result = { base: "origin/main", jobs: cpus().length, appShards: 4, skipE2e: false, only: "", all: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => {
            const next = argv[++i];
            if (!next) fail(`${arg} 需要参数`);
            return next;
        };
        if (arg === "--base") result.base = value();
        else if (arg === "--jobs") result.jobs = positiveInt(arg, value());
        else if (arg === "--app-shards") result.appShards = positiveInt(arg, value());
        else if (arg === "--skip-e2e") result.skipE2e = true;
        else if (arg === "--all") result.all = true;
        else if (arg === "--only") result.only = value();
        else if (arg === "-h" || arg === "--help") {
            console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
            process.exit(0);
        } else fail(`未知参数：${arg}`);
    }
    if (result.only && !["web", "backend"].includes(result.only)) fail("--only 只支持 web 或 backend");
    return result;
}

function positiveInt(name, raw) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) fail(`${name} 必须是正整数`);
    return value;
}

function fail(message) {
    console.error(message);
    process.exit(2);
}

function git(args, env) {
    const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", env: env ? { ...process.env, ...env } : process.env, maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} 失败：${result.stderr.trim()}`);
    return result.stdout.trim();
}

function lines(text) {
    return text ? text.split("\n").filter(Boolean) : [];
}

/** 工作区快照提交：用临时索引收录已跟踪和未忽略的新文件，不改动真实暂存区和分支。 */
function snapshotCommit() {
    const index = path.join(tmpdir(), `verify-index-${process.pid}`);
    const env = { GIT_INDEX_FILE: index };
    try {
        git(["read-tree", "HEAD"], env);
        git(["add", "-A"], env);
        const tree = git(["write-tree"], env);
        return git(["commit-tree", tree, "-p", "HEAD", "-m", "verify-before-push snapshot"]);
    } finally {
        rmSync(index, { force: true });
    }
}

const base = git(["merge-base", "HEAD", options.base]);
const behind = Number(git(["rev-list", "--count", `HEAD..${options.base}`]));
const dirty = lines(git(["status", "--porcelain"]));
const changed = [...new Set([...lines(git(["diff", "--name-only", base])), ...lines(git(["ls-files", "--others", "--exclude-standard"]))])];
const workflowChanged = changed.some((file) => file.startsWith(".github/workflows/") || file.startsWith("scripts/verify-before-push"));
const wantWeb = options.only ? options.only === "web" : options.all || workflowChanged || changed.some((file) => file.startsWith("web/"));
const wantBackend = options.only ? options.only === "backend" : options.all || workflowChanged || changed.some((file) => file.startsWith("backend/") || file.startsWith(".github/scripts/"));
const formatHead = dirty.length ? snapshotCommit() : git(["rev-parse", "HEAD"]);

console.log(`基准 ${options.base} @ ${base.slice(0, 8)}，相对基准改动 ${changed.length} 个文件${dirty.length ? `（含 ${dirty.length} 个未提交改动）` : ""}`);
if (behind > 0) console.log(`⚠ 当前分支落后 ${options.base} ${behind} 个提交：先 fetch 并 rebase，再验证要推送的结果。`);
if (dirty.length) console.log("⚠ 工作区有未提交改动：本次结果包含这些改动；推送前提交后再跑一次，确认推送的内容。");

/** @type {Array<{name: string, cwd: string, cmd: string, args?: string[], env?: Record<string,string>, weight: number, after?: string, check?: (output: string) => string, build?: () => {args: string[]} }>} */
const tasks = [];
const skipped = [];
const notCovered = ["Payment plugin artifacts（需要 Docker 双架构构建，由 CI 检查）"];

if (wantWeb) {
    const leftovers = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"].filter((file) => existsSync(path.join(WEB, file)));
    if (leftovers.length) {
        console.error(`✗ web 只能使用 bun.lock，发现：${leftovers.join(", ")}`);
        process.exit(1);
    }
    tasks.push(
        { name: "web:format", cwd: WEB, cmd: "bun", args: ["scripts/check-changed-formatting.mjs"], env: { BASE_SHA: base, GITHUB_SHA: formatHead }, weight: 10 },
        { name: "web:typecheck", cwd: WEB, cmd: "bun", args: ["run", "typecheck"], weight: 60 },
        { name: "web:lint", cwd: WEB, cmd: "bun", args: ["run", "lint"], weight: 50 },
        // bun run test 会先跑 pretest，与 CI 一致；直接 bun test 会跳过它。
        { name: "web:test", cwd: WEB, cmd: "bun", args: ["run", "test"], weight: 120 },
    );
    // 预演台 E2E 启动 Vite 与真实 Chrome，耗时且对机器负载敏感：只在预演相关改动或 --all 时运行。
    const previsChanged = changed.some((file) => file.startsWith("web/") && /previs/i.test(file));
    if (options.skipE2e) skipped.push("web:e2e（--skip-e2e）");
    else if (options.all || previsChanged) tasks.push({ name: "web:e2e", cwd: WEB, cmd: "bun", args: ["run", "test:previs:e2e"], weight: 90 });
    else skipped.push("web:e2e（没有预演台相关改动；--all 可强制运行）");
} else skipped.push("Web 检查（没有 web/ 改动）");

if (wantBackend) {
    if (spawnSync("go", ["version"]).status !== 0) {
        console.error("✗ 有后端改动，但本机没有可用的 go；请安装 backend/go.mod 要求的 Go 版本。");
        process.exit(1);
    }
    tasks.push({ name: "backend:pi-runtime", cwd: PI_RUNTIME, cmd: "node", args: ["--test", ...readdirSync(PI_RUNTIME).filter((file) => file.endsWith(".test.mjs")).sort()], weight: 50 });
    tasks.push({
        name: "backend:gofmt",
        cwd: BACKEND,
        cmd: "gofmt",
        args: ["-l", "."],
        weight: 5,
        check: (output) => (output.trim() ? `以下文件需要 gofmt -w：\n${output.trim()}` : ""),
    });
    if (spawnSync("golangci-lint", ["--version"], { encoding: "utf8" }).status === 0) {
        tasks.push({ name: "backend:agent-lint", cwd: BACKEND, cmd: "golangci-lint", args: ["run", "--config=.golangci.yml", "./internal/agent/..."], weight: 60 });
    } else notCovered.push("Agent 静态检查 golangci-lint v2.5.0（本机未安装；Agent 架构测试已包含在 backend:test-rest）");
    const appPackage = "yingce/backend/internal/app";
    const otherPackages = lines(spawnSync("go", ["list", "./..."], { cwd: BACKEND, encoding: "utf8" }).stdout).filter((pkg) => pkg !== appPackage);
    tasks.push({ name: "backend:test-rest", cwd: BACKEND, cmd: "go", args: ["test", "-timeout=20m", ...otherPackages], weight: 100 });
    // 与 CI 相同：internal/app 的顶层用例按名字排序后轮转分片，子用例跟随顶层用例。
    tasks.push({ name: "backend:list-app", cwd: BACKEND, cmd: "go", args: ["test", "-list", ".", "./internal/app"], weight: 200 });
    for (let shard = 1; shard <= options.appShards; shard++) {
        tasks.push({
            name: `backend:test-app-${shard}`,
            cwd: BACKEND,
            cmd: "go",
            after: "backend:list-app",
            weight: 150,
            build: () => {
                const names = lines(outputs.get("backend:list-app"))
                    .filter((line) => /^(Test|Example|Fuzz)[A-Za-z0-9_]*$/.test(line))
                    .sort()
                    .filter((_, index) => index % options.appShards === shard - 1);
                if (!names.length) throw new Error(`分片 ${shard} 没有用例`);
                return { args: ["test", "-timeout=20m", "-run", `^(${names.join("|")})$`, "./internal/app"] };
            },
        });
    }
    if (!process.env.CANVAS_TEST_POSTGRES_DSN || spawnSync("redis-server", ["--version"]).status !== 0) notCovered.push("依赖 PostgreSQL / redis-server 的 5 个后端用例（本机缺少服务时会跳过，由 CI 检查）");
} else skipped.push("后端检查（没有 backend/ 改动）");

if (!tasks.length) {
    console.log("没有需要运行的检查。");
    process.exit(0);
}

mkdirSync(LOG_DIR, { recursive: true });
const outputs = new Map();
const results = new Map();
const running = new Map();
const pending = [...tasks].sort((a, b) => b.weight - a.weight);
const started = Date.now();
let interrupted = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        interrupted = true;
        for (const child of running.values()) killTree(child);
        process.exit(130);
    });
}

function killTree(child) {
    // pid 必须是真实子进程：process.kill(-0) 会向本脚本所在的进程组发信号。
    if (!child?.pid) return;
    try {
        process.kill(-child.pid, "SIGTERM");
    } catch {
        // 进程组已经退出。
    }
}

function seconds(ms) {
    return `${(ms / 1000).toFixed(1)}s`;
}

function runTask(task) {
    return new Promise((resolve) => {
        const logPath = path.join(LOG_DIR, `${task.name.replace(/[:/]/g, "-")}.log`);
        let args = task.args || [];
        try {
            if (task.build) args = task.build().args;
        } catch (error) {
            resolve({ ok: false, ms: 0, logPath, reason: error.message });
            return;
        }
        const log = createWriteStream(logPath);
        let output = "";
        const startedAt = Date.now();
        // 独立进程组：超时或中断时能结束 vite、chrome、go 子进程。
        const child = spawn(task.cmd, args, { cwd: task.cwd, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...task.env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
        running.set(task.name, child);
        const collect = (chunk) => {
            output += chunk;
            log.write(chunk);
        };
        child.stdout.on("data", collect);
        child.stderr.on("data", collect);
        const timer = setTimeout(() => {
            collect(`\n[verify] 超过 ${TASK_TIMEOUT_MS / 60000} 分钟，已终止\n`);
            killTree(child);
        }, TASK_TIMEOUT_MS);
        child.on("error", (error) => collect(`\n[verify] 无法启动 ${task.cmd}：${error.message}\n`));
        child.on("close", (code) => {
            clearTimeout(timer);
            running.delete(task.name);
            log.end();
            outputs.set(task.name, output);
            const reason = code !== 0 ? `退出码 ${code}` : task.check ? task.check(output) : "";
            resolve({ ok: !reason, ms: Date.now() - startedAt, logPath, reason, output });
        });
    });
}

let active = 0;
await new Promise((done) => {
    const schedule = () => {
        if (interrupted) return;
        for (let index = 0; index < pending.length && active < options.jobs; index++) {
            const task = pending[index];
            if (task.after && !results.has(task.after)) continue;
            pending.splice(index--, 1);
            if (task.after && !results.get(task.after).ok) {
                results.set(task.name, { ok: false, ms: 0, reason: `依赖 ${task.after} 失败` });
                continue;
            }
            console.log(`▶ ${task.name}`);
            active++;
            runTask(task).then((result) => {
                active--;
                results.set(task.name, result);
                console.log(`${result.ok ? "✓" : "✗"} ${task.name} ${seconds(result.ms)}${result.ok ? "" : `（${result.reason}）`}`);
                schedule();
            });
        }
        if (!pending.length && !active) done();
    };
    schedule();
});

const failed = tasks.filter((task) => !results.get(task.name)?.ok);
for (const task of failed) {
    const result = results.get(task.name);
    console.log(`\n────── ${task.name} 失败：${result.reason}${result.logPath ? `（完整输出 ${path.relative(ROOT, result.logPath)}）` : ""}`);
    if (result.output) console.log(lines(result.output).slice(-40).join("\n"));
}

console.log(`\n共 ${tasks.length} 项，失败 ${failed.length} 项，用时 ${seconds(Date.now() - started)}（并行 ${options.jobs}）`);
for (const item of skipped) console.log(`  跳过：${item}`);
for (const item of notCovered) console.log(`  本地未覆盖：${item}`);
process.exit(failed.length ? 1 : 0);
