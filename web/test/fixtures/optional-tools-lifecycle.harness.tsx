import { afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement, lazy as reactLazy } from "react";
import { createRoot, type Root } from "react-dom/client";

const browser = new Window({ url: "http://localhost:3000" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Event", "EventTarget", "Node", "MutationObserver"]) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key as keyof Window] });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLElement;
async function mount(Component: () => any) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
        root!.render(createElement(Component));
    });
}
async function unmount() {
    if (root) {
        await act(async () => root!.unmount());
        root = undefined;
    }
    container?.remove();
}
afterEach(async () => {
    await unmount();
});

const timers = new Map<number, () => void>();
const intervals = new Map<number, () => void>();
let nextTimer = 0;
const originalTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = ((fn: () => void, delay?: number) => (delay && delay >= 1000 ? (timers.set(++nextTimer, fn), nextTimer) : originalTimeout(fn, delay))) as any;
globalThis.clearTimeout = ((id: number) => {
    timers.delete(id);
    originalClearTimeout(id);
}) as any;
globalThis.setInterval = ((fn: () => void) => {
    intervals.set(++nextTimer, fn);
    return nextTimer;
}) as any;
globalThis.clearInterval = ((id: number) => intervals.delete(id)) as any;
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function stream() {
    const track = {
        stopped: 0,
        stop() {
            this.stopped++;
        },
    };
    return { track, value: { getTracks: () => [track] } as unknown as MediaStream };
}
let permission = async () => stream().value;
Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => permission() } });
const recorders: FakeRecorder[] = [];
class FakeRecorder {
    state = "inactive";
    mimeType = "audio/ogg";
    onstop: (() => void) | null = null;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_stream: MediaStream) {
        recorders.push(this);
    }
    start() {
        this.state = "recording";
    }
    stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["sample"], { type: this.mimeType }) });
        this.onstop?.();
    }
}
Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: FakeRecorder });
Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: class {
        constructor() {
            throw new Error("unused waveform sampling started");
        }
    },
});
const { useVoiceRecording } = await import("../../src/hooks/use-voice-recording");

test("recording auto-stop returns one correctly typed sample and releases every resource", async () => {
    const source = stream();
    permission = async () => source.value;
    const results: Blob[] = [];
    let api!: ReturnType<typeof useVoiceRecording>;
    await mount(() => {
        api = useVoiceRecording({ maxDuration: 30, onComplete: (blob) => results.push(blob) });
        return null;
    });
    await act(async () => api.start());
    expect(api.state).toBe("recording");
    expect(intervals.size).toBe(1);
    await act(async () => {
        [...timers.values()][0]();
    });
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("audio/ogg");
    expect(source.track.stopped).toBe(1);
    expect(api.state).toBe("idle");
    expect(timers.size).toBe(0);
    expect(intervals.size).toBe(0);
    expect(await api.stop()).toBeNull();
    expect(results).toHaveLength(1);
});

test("permission resolving after cancellation or unmount cannot leak microphone tracks", async () => {
    for (const leave of [false, true]) {
        const source = stream();
        const gate = deferred<MediaStream>();
        permission = () => gate.promise;
        let api!: ReturnType<typeof useVoiceRecording>;
        await mount(() => {
            api = useVoiceRecording();
            return null;
        });
        let pending!: Promise<void>;
        await act(async () => {
            pending = api.start();
        });
        const before = recorders.length;
        if (leave) await unmount();
        else await act(async () => api.cancel());
        await act(async () => {
            gate.resolve(source.value);
            await pending;
        });
        expect(source.track.stopped).toBe(1);
        expect(recorders.length).toBe(before);
        await unmount();
    }
});

test("duplicate starts, cancel and device errors do not retain sampling or deliver abandoned audio", async () => {
    const source = stream();
    permission = async () => source.value;
    const results: Blob[] = [];
    let api!: ReturnType<typeof useVoiceRecording>;
    await mount(() => {
        api = useVoiceRecording({ onComplete: (blob) => results.push(blob) });
        return null;
    });
    const before = recorders.length;
    await act(async () => {
        await Promise.all([api.start(), api.start()]);
    });
    expect(recorders.length - before).toBe(1);
    await act(async () => api.cancel());
    expect(source.track.stopped).toBe(1);
    expect(results).toHaveLength(0);
    expect(timers.size).toBe(0);
    expect(intervals.size).toBe(0);
    const next = stream();
    permission = async () => next.value;
    await act(async () => api.start());
    await act(async () => recorders.at(-1)!.onerror?.());
    expect(next.track.stopped).toBe(1);
    expect(api.error).toContain("录音失败");
    expect(results).toHaveLength(0);
});

const recognitions: FakeRecognition[] = [];
class FakeRecognition {
    lang = "";
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onresult: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    aborted = 0;
    constructor() {
        recognitions.push(this);
    }
    start() {
        this.onstart?.();
    }
    stop() {
        /* Browser stop may wait for a final event. */
    }
    abort() {
        this.aborted++;
    }
}
(browser as any).SpeechRecognition = FakeRecognition;
const { useSpeechRecognition } = await import("../../src/hooks/use-speech-recognition");

test("speech cumulative results are not appended twice and repeated stops settle together", async () => {
    let api!: ReturnType<typeof useSpeechRecognition>;
    await mount(() => {
        api = useSpeechRecognition();
        return null;
    });
    await act(async () => api.start());
    const recognition = recognitions.at(-1)!;
    await act(async () => {
        recognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: "first" } }] });
        recognition.onresult?.({
            results: [
                { isFinal: true, 0: { transcript: "first" } },
                { isFinal: true, 0: { transcript: "second" } },
            ],
        });
    });
    const one = api.stop();
    const two = api.stop();
    expect(one).toBe(two);
    await act(async () => recognition.onend?.());
    expect(await one).toBe("first second");
    expect(await two).toBe("first second");
    expect(timers.size).toBe(0);
});

test("speech cancellation and unmount settle waiting stop promises and detach callbacks", async () => {
    let api!: ReturnType<typeof useSpeechRecognition>;
    await mount(() => {
        api = useSpeechRecognition();
        return null;
    });
    await act(async () => api.start());
    const first = recognitions.at(-1)!;
    const waiting = api.stop();
    await act(async () => api.cancel());
    expect(await waiting).toBe("");
    expect(first.aborted).toBe(1);
    expect(first.onresult).toBeNull();
    expect(timers.size).toBe(0);
    await act(async () => api.start());
    const second = recognitions.at(-1)!;
    const next = api.stop();
    await unmount();
    expect(await next).toBe("");
    expect(second.aborted).toBe(1);
    expect(timers.size).toBe(0);
});

// The route itself is real; transport/query identity and the heavy editor boundary are controlled.
let query: any = { isPending: true };
let user: any = { id: "owner", role: "user" };
let editorLoads = 0;
const react = await import("react");
const originalLazy = reactLazy;
mock.module("react", () => ({
    ...react,
    lazy: (factory: () => Promise<any>) =>
        originalLazy(() => {
            editorLoads++;
            return factory();
        }),
}));
mock.module("@tanstack/react-query", () => ({ useQuery: () => query }));
mock.module("react-router", () => ({ useParams: () => ({ skillId: "skill" }), useNavigate: () => () => {}, Navigate: ({ to }: { to: string }) => <div data-target={to} /> }));
mock.module("../../src/stores/use-user-store", () => ({ useUserStore: (selector: any) => selector({ user }) }));
mock.module("../../src/services/api/skills", () => ({ getSkill: async () => ({ skill: { isOwner: true } }) }));
mock.module("antd", () => ({ Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button> }));
mock.module("../../src/components/layout/workspace-state", () => ({
    WorkspaceLoadingState: () => <p>loading</p>,
    WorkspaceErrorState: ({ description }: any) => <p>{description}</p>,
    WorkspaceForbiddenState: ({ description }: any) => <p>{description}</p>,
}));
mock.module("../../src/pages/skills/workbench", () => ({ default: () => <div>author-editor</div> }));
const { default: SkillWorkbenchRoute } = await import("../../src/pages/skills/skill-workbench-route");

test("ordinary users, loading and failed authorization never load the skill IDE", async () => {
    for (const state of [{ isPending: true }, { isError: true, error: new Error("denied") }, { data: { skill: { isOwner: false } } }]) {
        query = state;
        await mount(SkillWorkbenchRoute);
        expect(editorLoads).toBe(0);
        expect(container.textContent).not.toContain("author-editor");
        await unmount();
    }
});

test("admins use admin authorization route and authors may load the IDE", async () => {
    user = { id: "admin", role: "admin" };
    query = { data: { skill: { isOwner: false } } };
    await mount(SkillWorkbenchRoute);
    expect(container.querySelector("[data-target]")?.getAttribute("data-target")).toBe("/admin/skills/skill/edit");
    expect(editorLoads).toBe(0);
    await unmount();
    user = { id: "owner", role: "user" };
    query = { data: { skill: { isOwner: true } } };
    await mount(SkillWorkbenchRoute);
    await act(async () => {
        await Promise.resolve();
    });
    expect(editorLoads).toBe(1);
    expect(container.textContent).toContain("author-editor");
});
