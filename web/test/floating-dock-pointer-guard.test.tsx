import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { FloatingDock } from "../src/components/ui/aceternity/floating-dock";

// 指针能力探测是纯增强：`window` 存在不代表 `matchMedia` 存在（SSR 垫片、嵌入式 webview、
// 部分 DOM polyfill 下它是 undefined），而 FloatingDock 在**渲染期**就取
// `window.matchMedia("(pointer: coarse)")`，取不到会直接抛 TypeError 让整个 dock 渲染失败。
// 仓库里同一模式已有先例：canvas-workspace-tool-panel.tsx 用 `typeof window.matchMedia === "function"` 守卫。
describe("floating dock pointer capability probe", () => {
    const source = readFileSync(new URL("../src/components/ui/aceternity/floating-dock.tsx", import.meta.url), "utf8");

    test("probes matchMedia through a guarded helper", () => {
        expect(source).toContain('typeof window.matchMedia !== "function"');
        expect(source).toContain("function coarsePointerQuery()");
        // 不允许再出现"直接取用 matchMedia 结果"的写法（初始化与 useEffect 都不得裸取）
        expect(source).not.toMatch(/window\.matchMedia\("\(pointer: coarse\)"\)\.matches/);
        expect(source).not.toMatch(/const media = window\.matchMedia/);
    });

    test("renders the real dock with a window shim lacking matchMedia", () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, "window");
        try {
            Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
            const markup = renderToStaticMarkup(<FloatingDock items={[{ id: "probe", label: "操作", icon: <span>+</span> }]} />);
            expect(markup).toContain("操作");
            expect(markup).toContain("button");
        } finally {
            if (original) Object.defineProperty(globalThis, "window", original);
            else Reflect.deleteProperty(globalThis, "window");
        }
    });
});
