import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasNode } from "../src/components/canvas/canvas-node";
import { CanvasNodeType } from "../src/types/canvas";

const noop = () => {};

function renderChild(options: { selected?: boolean; opening?: boolean; closing?: boolean } = {}) {
    return renderToStaticMarkup(
        <CanvasNode
            data={{ id: "child", type: CanvasNodeType.Image, title: "子图", position: { x: 600, y: 100 }, width: 340, height: 240, metadata: { batchRootId: "root", status: "idle" } }}
            scale={1}
            isSelected={Boolean(options.selected)}
            isRelated={false}
            isFocusRelated={false}
            isConnectionTarget={false}
            showImageInfo={false}
            batchOpening={options.opening}
            batchClosing={options.closing}
            batchMotion={{ x: -566, y: -86, index: 0 }}
            onMouseDown={noop}
            onHoverStart={noop}
            onHoverEnd={noop}
            onConnectStart={noop}
            onResize={noop}
            onContentChange={noop}
            onContextMenu={noop}
        />,
    );
}

describe("图片组子图动画", () => {
    test("普通挂载与选中子图都不播放展开动画", () => {
        for (const selected of [false, true]) {
            const markup = renderChild({ selected });
            expect(markup).not.toContain("canvas-batch-child-in");
            expect(markup).not.toContain("canvas-batch-child-out");
        }
    });

    test("仅在图片组展开或收起期间播放对应动画", () => {
        expect(renderChild({ opening: true })).toContain("canvas-batch-child-in");
        expect(renderChild({ closing: true })).toContain("canvas-batch-child-out");
    });
});
