import test from "node:test";
import assert from "node:assert/strict";
import { inspectCommerceImageAsset } from "../src/pages/ecommerce/quality.ts";

test("checks a materialized image without claiming visual compliance", () => {
    const valid = { kind: "image", data: { width: 900, height: 1600, bytes: 420000, mimeType: "image/png" } };
    assert.deepEqual(inspectCommerceImageAsset(valid, "9:16"), []);
    assert.deepEqual(inspectCommerceImageAsset(valid, "1:1"), ["比例与设定 1:1 不符"]);
    assert.deepEqual(inspectCommerceImageAsset({ ...valid, data: { ...valid.data, width: 0 } }, "9:16"), ["图片尺寸不可读取"]);
    assert.deepEqual(inspectCommerceImageAsset({ kind: "video" }, "9:16"), ["生成资产不是图片"]);
});
