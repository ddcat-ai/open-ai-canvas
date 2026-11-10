import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// 执行真实页面的入口回调，确认鉴权发生在上传、素材读取和画布创建之前。
function callback(file: string, name: string, scope: Record<string, unknown>) {
    const source = readFileSync(new URL(`../src/pages/create/${file}`, import.meta.url), "utf8");
    const match = source.match(new RegExp(`    const ${name} = (?:useCallback\\(\\s*)?((?:async )?\\([^\\n]*?\\) => \\{[\\s\\S]*?\\n +\\})(?:;|,\\s*\\[)`));
    if (!match) throw new Error(`Missing callback: ${name}`);
    const js = new Bun.Transpiler({ loader: "ts" }).transformSync(`const handler = ${match[1]};`);
    return new Function(...Object.keys(scope), js + "; return handler;")(...Object.values(scope));
}

function environment(user: unknown = null) {
    const events: unknown[] = [];
    const scope = {
        useUserStore: { getState: () => ({ user }) },
        setLibraryOpen: (open: boolean) => events.push(["library", open]),
        openAuth: (options: unknown) => events.push(["auth", options]),
    };
    return { events, scope, requireCreationLogin: callback("index.tsx", "requireCreationLogin", scope) };
}

test("游客打开素材库、上传、确认选择和拖入替换均进入登录且不执行后续操作", async () => {
    for (const [name, args] of [
        ["openReferenceLibrary", []],
        ["uploadLibraryAssets", [[]]],
        ["handleLibrarySelect", [[], []]],
        ["replaceReferenceFromFiles", ["reference", []]],
    ] as const) {
        const env = environment();
        const handler = callback("index.tsx", name, { ...env.scope, requireCreationLogin: env.requireCreationLogin });
        await handler(...args);
        expect(env.events).toEqual([
            ["library", false],
            ["auth", { preferDialog: true }],
        ]);
    }
});

test("已登录用户正常打开素材库", () => {
    const env = environment({ id: "user" });
    callback("index.tsx", "openReferenceLibrary", { ...env.scope, requireCreationLogin: env.requireCreationLogin })();
    expect(env.events).toEqual([["library", true]]);
});

test("游客启动 Agent 先登录，不创建画布或进入错误状态", async () => {
    const env = environment();
    await callback("creation-agent-entry.tsx", "start", { ...env.scope, lock: { current: false } })();
    expect(env.events).toEqual([["auth", { preferDialog: true }]]);
});
