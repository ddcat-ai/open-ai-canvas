import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasNode } from '@/components/canvas/canvas-node';
import { useCanvasSelectionController } from '@/pages/canvas/use-canvas-selection-controller';
import { CanvasNodeType, type CanvasNodeData } from '@/types/canvas';

const noop = () => {};
// 仅挂载内存中的测试节点，不登录、不读写用户画布或调用模型。
export function mountNodeDragHarness(host: HTMLElement, options: { locked?: boolean; readOnly?: boolean } = {}) {
    function Harness() {
        const [nodes, setNodes] = useState<CanvasNodeData[]>([{ id: 'drag-test', type: CanvasNodeType.Html, title: '分镜表测试', position: { x: 100, y: 100 }, width: 800, height: 500, metadata: { content: '<html><body style="background:#222;color:white;height:1600px"><h2>分镜表</h2><table><tr><th>切</th><th>画面</th></tr><tr><td>f1</td><td>测试画面</td></tr></table></body></html>' } }]);
        const nodesRef = useRef(nodes);
        nodesRef.current = nodes;
        const containerRef = useRef<HTMLDivElement>(null);
        const viewportRef = useRef({ x: 0, y: 0, k: 1 });
        const [selected, setSelected] = useState(new Set<string>());
        const selectedNodeIdsRef = useRef(selected);
        selectedNodeIdsRef.current = selected;
        const historyPausedRef = useRef(false);
        const ctrl = useCanvasSelectionController({ containerRef, nodesRef, viewportRef, selectedNodeIdsRef, historyPausedRef, screenToCanvas: (x, y) => ({ x, y }), setNodes, setSelectedNodeIds: setSelected, setSelectedConnectionId: noop, cancelPendingConnectionCreate: noop, onCanvasSelectionStart: noop, onNodeInteractionStart: noop, onNodeClick: noop, onDeselect: noop });
        return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }}>
            <output id="drag-position">{JSON.stringify(nodes[0].position)}</output>
            <CanvasNode data={{ ...nodes[0], metadata: { ...nodes[0].metadata, locked: options.locked } }} readOnly={options.readOnly} scale={1} isSelected={selected.has(nodes[0].id)} isRelated={false} isFocusRelated={false} isConnectionTarget={false} dragOffset={ctrl.dragPreview ?? undefined} onMouseDown={ctrl.handleNodeMouseDown} onHoverStart={noop} onHoverEnd={noop} onConnectStart={noop} onResize={noop} onTitleChange={noop} onContentChange={noop} onContextMenu={noop} />
        </div>;
    }
    const root = createRoot(host);
    root.render(<Harness />);
    return () => root.unmount();
}
