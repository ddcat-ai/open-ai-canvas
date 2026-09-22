import { expect, test } from "bun:test";
import { parseSync } from "@babel/core";
import { readFileSync } from "node:fs";
import type { AgentRun } from "../src/services/api/agent";

// Run the actual production handlers with deferred transport calls. Parse their
// declarations by syntax rather than duplicating the guards or matching text.
const source = readFileSync(new URL("../src/components/canvas/canvas-cloud-agent-panel.tsx", import.meta.url), "utf8");
const ast = parseSync(source, { filename: "panel.tsx", configFile: false, babelrc: false, parserOpts: { plugins: ["typescript", "jsx"] } });
const panel = ast?.program.body.find((entry: any) => entry.type === "ExportNamedDeclaration" && entry.declaration?.id?.name === "CanvasCloudAgentPanel") as any;
const names = ["restoreResult", "submit"];
const declarations = names.map((name) => {
    const declaration = panel?.declaration.body.body.flatMap((entry: any) => entry.type === "VariableDeclaration" ? entry.declarations : []).find((entry: any) => entry.id.name === name);
    if (!declaration?.init) throw new Error(`Production handler missing: ${name}`);
    return `const ${name} = ${source.slice(declaration.init.start, declaration.init.end)};`;
}).join("\n");
const executable = new Bun.Transpiler({ loader: "tsx" }).transformSync(declarations);
const createHandlers = new Function("environment", `with (environment) { ${executable}\nreturn { restoreResult, submit }; }`) as (environment: Record<string, any>) => {
    restoreResult: (taskId: string) => Promise<void>;
    submit: (prompt?: string) => Promise<void>;
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

function harness() {
    const saved = deferred<void>();
    const capabilities = deferred<{ permissionModes: string[] }>();
    const calls = { save: 0, restore: 0, capabilities: 0 };
    const oldRun: AgentRun = { id: "old-run", canvasId: "canvas", status: "completed", permissionMode: "auto", createdAt: "", updatedAt: "" };
    const environment: Record<string, any> = {
        run: oldRun,
        canvasId: "canvas",
        running: false,
        busy: false,
        prompt: "继续",
        conversationScope: "canvas:conversation",
        currentScope: { current: "canvas:conversation" },
        submissionRequestRef: { current: false },
        restoreRequestRef: { current: false },
        connectionStatus: "connected",
        historyHydrated: true,
        pendingHydrated: true,
        pendingSubmission: { current: null },
        profileLoading: false,
        profileView: { revision: "profile" },
        profileError: undefined,
        setBusy: () => {}, // React's captured render state remains unchanged until a rerender.
        setRestoring: () => {},
        setMessages: () => {},
        setRun: (update: (current: AgentRun) => AgentRun) => { environment.run = update(environment.run); },
        onFocusNode: () => {},
        saveRemoteUserDataNow: () => { calls.save++; return saved.promise; },
        restoreAgentResult: async () => { calls.restore++; return { nodeId: "restored-node", restored: true }; },
        refreshCanvasAfterAgent: async () => {},
        getAgentRun: async () => ({ run: oldRun }),
        getAgentCapabilities: () => { calls.capabilities++; return capabilities.promise; },
    };
    return { ...createHandlers(environment), environment, calls, saved, capabilities };
}

test("a pending restore blocks a new turn and duplicate restore before React rerenders", async () => {
    const h = harness();
    const pending = h.restoreResult("task");
    await h.submit("继续剩余项");
    await h.restoreResult("task");
    expect(h.calls).toEqual({ save: 1, restore: 0, capabilities: 0 });
    h.saved.resolve();
    await pending;
    expect(h.calls.restore).toBe(1);
    expect(h.environment.restoreRequestRef.current).toBe(false);
});

test("a pending new turn blocks restoration even before busy state rerenders", async () => {
    const h = harness();
    const pending = h.submit("继续剩余项");
    await h.restoreResult("task");
    expect(h.calls).toEqual({ save: 0, restore: 0, capabilities: 1 });
    h.environment.currentScope.current = "canvas:other-conversation";
    h.capabilities.resolve({ permissionModes: ["auto"] });
    await pending;
    expect(h.environment.submissionRequestRef.current).toBe(false);
});

test("an old restore response cannot replace a newer current run", async () => {
    const h = harness();
    const pending = h.restoreResult("task");
    const newerRun = { ...h.environment.run, id: "new-run", status: "running" };
    h.environment.run = newerRun;
    h.saved.resolve();
    await pending;
    expect(h.calls.restore).toBe(1);
    expect(h.environment.run).toBe(newerRun);
});

test("switching conversations before local save completes cancels the pending restore", async () => {
    const h = harness();
    const pending = h.restoreResult("task");
    h.environment.currentScope.current = "canvas:other-conversation";
    h.saved.resolve();
    await pending;
    expect(h.calls.restore).toBe(0);
    expect(h.environment.restoreRequestRef.current).toBe(false);
});
