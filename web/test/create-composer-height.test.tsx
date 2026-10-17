import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasResourceMentionTextarea } from "../src/components/canvas/canvas-resource-mention-textarea";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { CreationComposer } from "../src/pages/create/creation-workspace";
import { defaultConfig } from "../src/stores/use-config-store";

const noop = () => {};
const profile = defaultModelCapabilityConfig();
const imageReference = { id: "image", nodeId: "image", kind: "image" as const, label: "参考图", title: "参考图", active: true };
const props: ComponentProps<typeof CreationComposer> = {
    variant: "empty", mode: "image", prompt: "长提示词分镜内容\n".repeat(100), setPrompt: noop,
    busy: false, generationActive: false, referenceReplacementBusy: false,
    attachments: [], maxReferences: 9, references: [], onRemoveAttachment: noop,
    onClearAttachments: noop, onClearComposer: noop, onReorderAttachments: noop,
    onReplaceAttachment: noop, onReplaceReferenceFiles: noop, onOpenLibrary: noop,
    onModeChange: noop, model: "", modelRequirements: {},
    videoProfile: profile.video!, imageProfile: profile.image!, config: defaultConfig,
    onModelChange: noop, ratio: "1:1", setRatio: noop, seconds: "6", setSeconds: noop,
    quality: "auto", setQuality: noop, imageResolution: "1k", setImageResolution: noop,
    setImageParameters: noop, setTransparentBackground: noop,
    videoQuality: "720p", setVideoQuality: noop, count: "1", setCount: noop,
    textStreaming: true, setTextStreaming: noop, textThinking: false, setTextThinking: noop,
    promptOptimizerProvider: null, composerFocusRef: createRef<HTMLTextAreaElement>(),
    onPromptFocus: noop, onSubmit: noop,
};

for (const variant of ["empty", "thread"] as const) {
    for (const references of [[], [imageReference]]) {
        test(`${variant} 长提示词${references.length ? "带引用" : "无引用"}保持高度上限和内部滚动`, () => {
            const window = new Window();
            try {
                window.document.body.innerHTML = renderToStaticMarkup(<CreationComposer {...props} variant={variant} references={references} />);
                const editor = window.document.querySelector<HTMLElement>(references.length ? '[contenteditable="true"]' : "textarea")!;
                expect(editor).not.toBeNull();
                expect(editor.style.height).toBe("auto");
                expect(editor.style.maxHeight).toBe("min(320px, 35dvh)");
                expect(editor.style.overflowY).toBe("auto");
                expect(window.document.querySelector('[aria-label="发送"]')).not.toBeNull();
            } finally {
                window.close();
            }
        });
    }
}

test("画布未指定高度的引用输入仍填充固定容器", () => {
    const window = new Window();
    try {
        for (const references of [[], [imageReference]]) {
            window.document.body.innerHTML = renderToStaticMarkup(<CanvasResourceMentionTextarea value="提示词" references={references} onChange={noop} />);
            const editor = window.document.querySelector<HTMLElement>(references.length ? '[contenteditable="true"]' : "textarea")!;
            expect(editor.style.height).toBe("100%");
            expect(editor.style.maxHeight).toBe("100%");
            expect(editor.style.overflowY).toBe("auto");
        }
    } finally {
        window.close();
    }
});
