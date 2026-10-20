import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasBatchTableNodeContent } from "@/components/canvas/canvas-batch-table-node";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { canvasThemes } from "@/lib/canvas-theme";
import { CanvasNodeType } from "@/types/canvas";
import { batchRowInputSignature, BATCH_ROW_HEIGHT } from "@/lib/canvas/canvas-batch-references";

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
        expect(editable).toContain("在任务 1 下方插入");
        expect(editable).toContain("放大编辑任务 1 提示词");
        expect(editable).toContain("各行分别填写");
        expect(editable).not.toContain("行级覆盖");
        const readOnly = render(true);
        expect(readOnly).not.toContain('aria-label="减少一组参考图"');
        for (const textarea of readOnly.match(/<textarea\b[^>]*>/g) || []) expect(textarea).toContain('readOnly=""');
        expect(readOnly).not.toContain("创建视频脚本");
        expect(readOnly).not.toContain("在任务 1 下方插入");
        expect(readOnly).not.toContain("放大编辑任务");
        expect(readOnly).toContain("放大查看任务 1 提示词");
        expect(readOnly).toContain("已编辑内容");
    });
}

test("cell endpoints keep stable row/column identity and stale results remain visibly stale", () => {
    const source = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { content: "image-original.png" });
    const output = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { content: "result.png" });
    const table = { operation: "creative" as const, concurrency: 1, referenceColumns: [{ id: "stable-column", label: "服装" }], rows: [{ id: "stable-row", enabled: true, inputNodeIds: [source.id], prompt: "原任务", outputNodeId: output.id, generatedInputSignature: "" }] };
    table.rows[0].generatedInputSignature = batchRowInputSignature(table, table.rows[0], new Map([[source.id, source]]));
    const node = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 }, { batchTable: table });
    const render = (readOnly = false) => renderToStaticMarkup(<CanvasBatchTableNodeContent node={node} nodes={[node, source, output]} connections={[]} theme={canvasThemes.light} readOnly={readOnly} onPatchTable={noop} onAddRow={noop} onRemoveRow={noop} onUpdateRow={noop} onFillRows={noop} onGenerate={noop} onRetryItem={noop} onAddReferenceColumn={noop} onConnectStart={noop} onPickReference={noop} onRemoveReference={noop} />);
    const initial = render();
    expect(initial).toContain(`data-target-node-id="${node.id}"`);
    expect(initial).toContain('data-row-id="stable-row"');
    expect(initial).toContain('data-column-id="stable-column"');
    expect(initial).toContain('aria-label="任务 1 · 参考图 1"');
    expect(initial).toContain('aria-label="任务 1 · 参考图 1连接点"');
    expect(initial).toContain('aria-label="清除任务 1 · 参考图 1引用"');
    expect(initial).toContain(`height:${BATCH_ROW_HEIGHT}px`);
    expect(initial).toContain("按列填充");
    expect(initial).not.toContain('type="file"');
    expect(initial).not.toContain("输入已变更");
    const changedSource = { ...source, metadata: { ...source.metadata, content: "image-rotated.png" } };
    const changed = renderToStaticMarkup(<CanvasBatchTableNodeContent node={node} nodes={[node, changedSource, output]} connections={[]} theme={canvasThemes.light} onPatchTable={noop} onAddRow={noop} onRemoveRow={noop} onUpdateRow={noop} onFillRows={noop} onGenerate={noop} onRetryItem={noop} onAddReferenceColumn={noop} onConnectStart={noop} />);
    expect(changed).toContain("输入已变更");
    const readOnly = render(true);
    expect(readOnly).not.toContain('aria-label="清除任务 1 · 参考图 1引用"');
    expect(readOnly).not.toContain('aria-label="任务 1 · 参考图 1连接点"');
});
