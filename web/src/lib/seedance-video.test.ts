import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSeedanceResolution } from "@/lib/seedance-video";

test("normalizeSeedanceResolution 常规与样片钳制", () => {
    // 常规请求按模型能力归一化
    assert.equal(normalizeSeedanceResolution("1080", "doubao-seedance-2-5-260628"), "1080p");
    assert.equal(normalizeSeedanceResolution("4k", "doubao-seedance-2-5-260628"), "2160p");
    assert.equal(normalizeSeedanceResolution("", "doubao-seedance-2-5-260628"), "720p");
    // fast 模型回落到 480p/720p
    assert.equal(normalizeSeedanceResolution("1080p", "doubao-seedance-fast"), "720p");
    // 样片模式强制 480p，其余分辨率一律钳制；关闭样片模式时不受影响。
    assert.equal(normalizeSeedanceResolution("1080p", "doubao-seedance-2-5-260628", true), "480p");
    assert.equal(normalizeSeedanceResolution("720p", "doubao-seedance-2-5-260628", true), "480p");
    assert.equal(normalizeSeedanceResolution("", "doubao-seedance-2-5-260628", true), "480p");
    assert.equal(normalizeSeedanceResolution("1080p", "doubao-seedance-2-5-260628", false), "1080p");
});
