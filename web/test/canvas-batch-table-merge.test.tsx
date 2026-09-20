import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasBatchTableNodeContent } from "@/components/canvas/canvas-batch-table-node";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { canvasThemes } from "@/lib/canvas-theme";
import { CanvasNodeType } from "@/types/canvas";

const noop = () => {};

for (const mode of ["light", "dark"] as const) {
    test(`merged batch table keeps local controls and dynamic cells in ${mode} mode`, () => {
        const output = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { content: "data:image/png;base64,AA==" });
        const node = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 }, {
            batchTable: {
                operation: "creative", concurrency: 1, aiGenerated: true, contentKind: "storyboard",
                textColumns: [{ id: "detail", label: "画面细节" }],
                referenceColumns: [{ id: "reference-1", label: "参考图 1" }, { id: "reference-2", label: "参考图 2" }],
                rows: [{ id: "row", enabled: true, inputNodeIds: [], prompt: "@参考图1 保留提示", cells: { detail: "已编辑内容" }, outputNodeId: output.id }],
            },
        });
        const render = (readOnly = false) => renderToStaticMarkup(<CanvasBatchTableNodeContent
            node={node} nodes={[node, output]} connections={[]} theme={canvasThemes[mode]} readOnly={readOnly}
            onPatchTable={noop} onAddRow={noop} onRemoveRow={noop} onUpdateRow={noop} onFillRows={noop}
            onGenerate={noop} onCreateStoryboard={noop} onRetryItem={noop} onAddReferenceColumn={noop}
            onRemoveReferenceColumn={noop} onFocusOutput={noop} onConnectStart={noop}
        />);
        const editable = render();
        expect(editable).toContain('aria-label="减少一组参考图"');
        expect(editable).toContain('aria-label="任务 1 提示词"');
        expect(editable).toContain("点击定位到画布节点");
        expect(editable).toContain("画面细节");
        expect(editable).toContain("已编辑内容");
        expect(editable).toContain("创建视频脚本");
        const readOnly = render(true);
        expect(readOnly).not.toContain('aria-label="减少一组参考图"');
        for (const textarea of readOnly.match(/<textarea\b[^>]*>/g) || []) expect(textarea).toContain('readOnly=""');
        expect(readOnly).not.toContain("创建视频脚本");
        expect(readOnly).toContain("已编辑内容");
    });
}
