import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
let subscriptions = 0;
let closes = 0;
let emit: (data: unknown) => void = () => {};
Object.assign(dom, {
    desktop: {
        doubaoBridgeInfo: async () => ({ baseUrl: "http://localhost:8787", adminToken: "test" }),
        doubaoBridgeStatus: async () => ({ phase: "ready" }),
        onDoubaoBridgeStatus: () => () => {},
    },
});
class FakeSource {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror = null;
    constructor() {
        subscriptions++;
        emit = (data) => this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
    }
    close() {
        closes++;
    }
}
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Event: dom.Event, EventSource: FakeSource, IS_REACT_ACT_ENVIRONMENT: true, fetch: () => new Promise(() => {}) })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { DoubaoCanvasPanel, useDoubaoCanvasTasks } = await import("../src/components/doubao/doubao-canvas-tasks");
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key);
});

test("hiding one node leaves the shared subscription and other node active", async () => {
    function Fixture() {
        const { bridge, tasksByNode, error } = useDoubaoCanvasTasks();
        return bridge
            ? [...tasksByNode].map(([node, task]) => (
                  <div key={node} data-node={node}>
                      <DoubaoCanvasPanel bridge={bridge} task={task} connectionError={error} />
                  </div>
              ))
            : null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => {
            root.render(<Fixture />);
        });
        await act(async () => {
            emit({ type: "snapshot", tasks: ["a", "b"].map((nodeId) => ({ id: nodeId, nodeId, kind: "image", status: "queued", accountId: null, attempt: 0 })) });
        });
        expect(subscriptions).toBe(1);
        await act(async () => {
            (host.querySelector('[data-node="a"] button') as HTMLButtonElement).click();
        });
        expect(host.querySelector('[data-node="a"]')?.textContent).toContain("显示豆包对话");
        expect(host.querySelector('[data-node="b"]')?.textContent).toContain("排队中");
        expect(closes).toBe(0);
        await act(async () => {
            emit({ type: "task", task: { id: "b", nodeId: "b", kind: "video", status: "processing", accountId: null, attempt: 0 } });
        });
        expect(host.querySelector('[data-node="b"]')?.textContent).toContain("生成中");
        expect(subscriptions).toBe(1);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
    expect(closes).toBe(1);
});
