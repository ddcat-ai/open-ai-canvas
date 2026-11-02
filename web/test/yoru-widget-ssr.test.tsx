import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { YoruWidget } from "../src/components/layout/yoru-widget";

test("小夜在浏览器能力尚未初始化时可安全渲染工作台", () => {
    expect(
        renderToStaticMarkup(
            <MemoryRouter>
                <YoruWidget />
            </MemoryRouter>,
        ),
    ).toBe("");
});
