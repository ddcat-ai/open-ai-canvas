import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { resolvePluginImageReference } from "../src/lib/plugins/plugin-media.ts";

test("参考图转 data URL 失败时，远程资源改用展示签名地址继续规划", async () => {
    const resolved = await resolvePluginImageReference(
        { title: "杯子参考图", storageKey: "resource:cup-1", mimeType: "image/png" },
        {
            resolveDataUrl: async () => { throw new TypeError("Failed to fetch"); },
            resolveDisplayUrl: async () => "https://cdn.example.test/cup.png?signature=ok",
        },
    );

    assert.equal(resolved.dataUrl, "https://cdn.example.test/cup.png?signature=ok");
    assert.equal(resolved.mimeType, "image/png");
});

test("参考图既无法读取也没有展示签名地址时，错误说明具体是哪张图", async () => {
    await assert.rejects(
        () => resolvePluginImageReference(
            { title: "已失效的杯子", storageKey: "resource:missing", mimeType: "image/png" },
            {
                resolveDataUrl: async () => { throw new TypeError("Failed to fetch"); },
                resolveDisplayUrl: async () => "",
            },
        ),
        /参考图“已失效的杯子”读取失败/,
    );
});

test("展示地址不是绝对 HTTP 地址时，不把平台相对路径交给模型", async () => {
    await assert.rejects(
        () => resolvePluginImageReference(
            { title: "本地杯子", storageKey: "resource:local", mimeType: "image/png" },
            {
                resolveDataUrl: async () => { throw new TypeError("Failed to fetch"); },
                resolveDisplayUrl: async () => "/api/public/resources/local/file?signature=test",
            },
        ),
        /参考图“本地杯子”读取失败/,
    );
});
