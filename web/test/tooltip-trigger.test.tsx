import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Plus } from "lucide-react";

import { IconButton } from "../src/components/ui/base/buttons";
import { Tooltip } from "../src/components/ui/base/tooltip";

test("tooltip gives native and custom controls one real focus target", () => {
    for (const child of [<button aria-label="新增">+</button>, <IconButton icon={Plus} aria-label="新增" />]) {
        const markup = renderToStaticMarkup(<Tooltip title="新增节点">{child}</Tooltip>);
        expect(markup).toMatch(/<button[^>]*tabindex="0"/);
        expect(markup).not.toMatch(/<span[^>]*tabindex=/);
    }
});

test("tooltip preserves explicit tab order and disabled controls", () => {
    const excluded = renderToStaticMarkup(
        <Tooltip title="说明">
            <button tabIndex={-1}>操作</button>
        </Tooltip>,
    );
    expect(excluded).toMatch(/<button[^>]*tabindex="-1"/);
    const disabled = renderToStaticMarkup(
        <Tooltip title="不可操作">
            <button disabled>操作</button>
        </Tooltip>,
    );
    expect(disabled).toMatch(/<button[^>]*disabled/);
    expect(disabled).not.toContain('tabindex="0"');
});
