import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";

test("发布的拆层协议包与源码一致且请求 PNG，不丢失多图输出列表", () => {
    const source = JSON.parse(readFileSync(new URL("../../plugin-packages/image-tools/manifest.json", import.meta.url), "utf8"));
    const archive = unzipSync(readFileSync(new URL("../../plugin-packages/image-tools.yingce-plugin", import.meta.url)));
    const packaged = JSON.parse(strFromU8(archive["manifest.json"]));
    expect(packaged).toEqual(source);
    const provider = packaged.contributes.providers.find((item: { id: string }) => item.id === "image-tools-layer-decomposition");
    expect(provider.create.body.output_format).toBe("png");
    expect(provider.create.path).toBe("/bytedance/seedream-v5.5/layer-decomposition");
    expect(provider.response.images).toEqual({ $ref: "response.data.outputs" });
    expect(packaged.version).toBe("1.0.2");
});
