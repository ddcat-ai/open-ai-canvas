import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    Element: dom.Element,
    Node: dom.Node,
    NodeFilter: dom.NodeFilter,
    SVGElement: dom.SVGElement,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    ResizeObserver: dom.ResizeObserver,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanvasResourceMentionTextarea } = await import("../../src/components/canvas/canvas-resource-mention-textarea");
const { serializeEditableValue } = await import("../../src/components/canvas/canvas-mention-editable");
const references = [{ id: "text-ref", nodeId: "source", kind: "text" as const, label: "文本1", title: "reference", active: true }];

function compositionEnd(data: string) {
    const event = new dom.CompositionEvent("compositionend", { bubbles: true });
    // happy-dom's CompositionEvent currently omits the native data property.
    Object.defineProperty(event, "data", { value: data });
    return event;
}

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("an open composing prompt adopts cloud text after lock rejection without publishing stale DOM", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const changes: string[] = [];
    const render = async (value: string, readOnly: boolean) => {
        await act(async () =>
            root.render(
                <CanvasResourceMentionTextarea
                    value={value}
                    references={references}
                    readOnly={readOnly}
                    onChange={(text) => {
                        changes.push(text);
                    }}
                />,
            ),
        );
    };
    try {
        await render("baseline", false);
        const editor = host.querySelector<HTMLElement>("[role=textbox]")!;
        editor.focus();
        await act(async () => {
            editor.dispatchEvent(new dom.CompositionEvent("compositionstart", { bubbles: true }));
        });
        editor.textContent = "B unfinished composition";
        await render("A cloud winner", true);
        expect(serializeEditableValue(editor)).toBe("A cloud winner");
        await act(async () => {
            editor.dispatchEvent(compositionEnd("B unfinished composition"));
        });
        await render("A cloud winner", false);
        expect(host.querySelector("[role=textbox]")).toBe(editor);
        expect(serializeEditableValue(editor)).toBe("A cloud winner");
        expect(changes).toEqual([]);
        editor.textContent = "A cloud winnerB unfinished composition";
        await act(async () => {
            editor.dispatchEvent(new dom.InputEvent("input", { bubbles: true, inputType: "insertText", data: "B unfinished composition" }));
        });
        expect(serializeEditableValue(editor)).toBe("A cloud winner");
        expect(changes).toEqual([]);
        await act(async () => {
            editor.dispatchEvent(new dom.KeyboardEvent("keydown", { bubbles: true, key: "n" }));
        });
        editor.textContent = `${serializeEditableValue(editor)} new input`;
        await act(async () => {
            editor.dispatchEvent(new dom.InputEvent("input", { bubbles: true }));
        });
        expect(changes).toEqual(["A cloud winner new input"]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

for (const rich of [false, true]) {
    test(`focused ${rich ? "mention" : "plain"} input receives cloud changes without blur`, async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        const changes: string[] = [];
        const render = async (value: string, readOnly: boolean) => {
            await act(async () =>
                root.render(
                    <CanvasResourceMentionTextarea
                        value={value}
                        references={rich ? references : []}
                        readOnly={readOnly}
                        onChange={(text) => {
                            changes.push(text);
                        }}
                    />,
                ),
            );
        };
        try {
            await render("baseline", false);
            const editor = host.querySelector<HTMLElement>(rich ? "[role=textbox]" : "textarea")!;
            editor.focus();
            await render("A cloud winner", true);
            expect(rich ? serializeEditableValue(editor) : (editor as HTMLTextAreaElement).value).toBe("A cloud winner");
            await render("A final value", false);
            expect(host.querySelector(rich ? "[role=textbox]" : "textarea")).toBe(editor);
            expect(document.activeElement).toBe(editor);
            expect(rich ? serializeEditableValue(editor) : (editor as HTMLTextAreaElement).value).toBe("A final value");
            expect(changes).toEqual([]);
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });
}

test("ordinary Chinese composition publishes once while unrelated rerenders do not clear it", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const changes: string[] = [];
    const render = async () => {
        await act(async () =>
            root.render(
                <CanvasResourceMentionTextarea
                    value="baseline"
                    references={[...references]}
                    onChange={(text) => {
                        changes.push(text);
                    }}
                />,
            ),
        );
    };
    try {
        await render();
        const editor = host.querySelector<HTMLElement>("[role=textbox]")!;
        editor.focus();
        await act(async () => {
            editor.dispatchEvent(new dom.CompositionEvent("compositionstart", { bubbles: true }));
        });
        editor.textContent = "正常中文输入";
        await render();
        expect(serializeEditableValue(editor)).toBe("正常中文输入");
        await act(async () => {
            editor.dispatchEvent(new dom.InputEvent("input", { bubbles: true, isComposing: true }));
        });
        expect(changes).toEqual([]);
        await act(async () => {
            editor.dispatchEvent(compositionEnd("正常中文输入"));
        });
        expect(changes).toEqual(["正常中文输入"]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("a plain prompt discards composition across lock and unlock without remounting", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const changes: string[] = [];
    const render = async (value: string, readOnly: boolean) => {
        await act(async () =>
            root.render(
                <CanvasResourceMentionTextarea
                    value={value}
                    references={[]}
                    readOnly={readOnly}
                    onChange={(text) => {
                        changes.push(text);
                    }}
                />,
            ),
        );
    };
    try {
        await render("baseline", false);
        const editor = host.querySelector("textarea")!;
        editor.focus();
        await act(async () => {
            editor.dispatchEvent(new dom.CompositionEvent("compositionstart", { bubbles: true }));
        });
        editor.value = "B unfinished";
        await render("cloud", true);
        expect(editor.value).toBe("cloud");
        await render("cloud", false);
        editor.value = "cloudB unfinished";
        await act(async () => {
            editor.dispatchEvent(compositionEnd("B unfinished"));
        });
        expect(host.querySelector("textarea")).toBe(editor);
        expect(editor.value).toBe("cloud");
        expect(changes).toEqual([]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("cloud change arriving during composition is applied on composition end even without a lock rerender", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const changes: string[] = [];
    const render = async (value: string) => {
        await act(async () =>
            root.render(
                <CanvasResourceMentionTextarea
                    value={value}
                    references={references}
                    onChange={(text) => {
                        changes.push(text);
                    }}
                />,
            ),
        );
    };
    try {
        await render("baseline");
        const editor = host.querySelector<HTMLElement>("[role=textbox]")!;
        await act(async () => {
            editor.dispatchEvent(new dom.CompositionEvent("compositionstart", { bubbles: true }));
        });
        editor.textContent = "stale local";
        await render("cloud replacement");
        await act(async () => {
            editor.dispatchEvent(compositionEnd("stale local"));
        });
        expect(serializeEditableValue(editor)).toBe("cloud replacement");
        expect(changes).toEqual([]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

for (const composing of [false, true]) {
    test(`the mounted generation prompt panel replaces ${composing ? "composing" : "ordinary"} input after lock rejection`, async () => {
        const { CanvasNodePromptPanel } = await import("../../src/components/canvas/canvas-node-prompt-panel");
        const { CanvasNodeType } = await import("../../src/types/canvas");
        const { canvasEditLeases } = await import("../../src/services/canvas-edit-leases");
        const { App } = await import("antd");
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        const changes: string[] = [];
        const render = async (prompt: string) => {
            await act(async () =>
                root.render(
                    <App>
                        <CanvasNodePromptPanel
                            projectId="canvas"
                            node={{ id: "target", type: CanvasNodeType.Image, title: "image", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { prompt, composerContent: prompt } }}
                            isRunning={false}
                            mentionReferences={references}
                            workspaceMode="simple"
                            onPromptChange={(_id, value) => {
                                changes.push(value);
                            }}
                            onConfigChange={() => {}}
                            onGenerate={() => {
                                throw new Error("must not generate");
                            }}
                        />
                    </App>,
                ),
            );
        };
        try {
            await render("baseline");
            const editor = host.querySelector<HTMLElement>("[role=textbox]")!;
            editor.focus();
            if (composing)
                await act(async () => {
                    editor.dispatchEvent(new dom.CompositionEvent("compositionstart", { bubbles: true }));
                });
            editor.textContent = "B stale prompt";
            if (!composing) {
                await act(async () => {
                    editor.dispatchEvent(new dom.InputEvent("input", { bubbles: true, inputType: "insertText", data: " prompt" }));
                });
                await render("B stale prompt");
                expect(changes).toEqual(["B stale prompt"]);
            }
            await act(async () => canvasEditLeases.status("canvas", { revision: 2, serverTime: new Date().toISOString(), leases: [{ nodeId: "target", sessionId: "A-session", expiresAt: new Date(Date.now() + 30000).toISOString() }] }));
            await render("A saved prompt");
            if (composing)
                await act(async () => {
                    editor.dispatchEvent(compositionEnd("B stale prompt"));
                });
            await act(async () => canvasEditLeases.status("canvas", { revision: 2, serverTime: new Date().toISOString(), leases: [] }));
            expect(host.querySelector("[role=textbox]")).toBe(editor);
            expect(serializeEditableValue(editor)).toBe("A saved prompt");
            expect(changes).toEqual(composing ? [] : ["B stale prompt"]);
            editor.textContent = "A saved prompt next";
            await act(async () => {
                editor.dispatchEvent(new dom.InputEvent("input", { bubbles: true, inputType: "insertText", data: " next" }));
            });
            expect(changes).toEqual(composing ? ["A saved prompt next"] : ["B stale prompt", "A saved prompt next"]);
        } finally {
            await act(async () => {
                root.unmount();
                canvasEditLeases.reset();
            });
            host.remove();
        }
    });
}

test("pasting after a rejected composition starts from cloud text", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const changes: string[] = [];
    const render = async (value: string, readOnly: boolean) => {
        await act(async () =>
            root.render(
                <CanvasResourceMentionTextarea
                    value={value}
                    references={references}
                    readOnly={readOnly}
                    onChange={(text) => {
                        changes.push(text);
                    }}
                />,
            ),
        );
    };
    try {
        await render("baseline", false);
        const editor = host.querySelector<HTMLElement>("[role=textbox]")!;
        editor.focus();
        await act(async () => {
            editor.dispatchEvent(new dom.CompositionEvent("compositionstart", { bubbles: true }));
        });
        editor.textContent = "discarded";
        await render("cloud", true);
        await act(async () => {
            editor.dispatchEvent(compositionEnd("discarded"));
        });
        await render("cloud", false);
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        const clipboardData = new dom.DataTransfer();
        clipboardData.setData("text/plain", " pasted");
        await act(async () => {
            editor.dispatchEvent(new dom.ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
        });
        expect(changes).toEqual(["cloud pasted"]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
