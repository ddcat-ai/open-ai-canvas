import assert from "node:assert/strict";
import { test } from "node:test";
import type { DramaCast, DramaSegment, DramaShot } from "@/services/api/drama";
import { buildDramaAssetUsage } from "./asset-usage";

function cast(id: string, patch: Partial<DramaCast> = {}): DramaCast {
    return {
        id,
        projectId: "project",
        kind: "character",
        name: id,
        aliasesJson: "[]",
        role: "",
        description: "",
        appearance: "",
        voiceInstructions: "",
        importance: 0,
        imageResourceId: `image-${id}`,
        imageStatus: "ready",
        imageVersion: 1,
        locked: false,
        position: 0,
        ...patch,
    };
}

function shot(id: string, patch: Partial<DramaShot> = {}): DramaShot {
    return {
        id,
        projectId: "project",
        episodeId: "episode",
        position: 0,
        segmentIndex: 0,
        segmentTitle: "",
        scene: "",
        castIdsJson: "[]",
        lookCastIdsJson: "[]",
        propIdsJson: "[]",
        speaker: "",
        dialogue: "",
        action: "",
        shotSize: "",
        camera: "",
        transition: "",
        durationMs: 3000,
        imagePrompt: "",
        videoPrompt: "",
        sourceQuote: "",
        ...patch,
    };
}

function segment(shotIds: string[], references: DramaSegment["request"]["references"] = []): DramaSegment {
    return {
        id: "segment",
        revision: 1,
        index: 0,
        title: "开场",
        shotIds,
        durationMs: 9000,
        videoPrompt: "",
        generated: "",
        custom: false,
        promptStatus: "ready",
        videoStatus: "draft",
        videoModel: { channelId: "", modelKey: "" },
        referenceMode: "auto",
        audioReferenceMode: "auto",
        request: { operation: "reference_to_video", seconds: 9, maxVideoSeconds: 15, aspectRatio: "16:9", generateAudio: true, firstFramePending: false, references, referenceCapacity: 4, modelMaxImages: 4, header: "" },
    };
}

test("按镜头使用的造型替代人物本体，并对重复出镜去重计数", () => {
    const assets = [cast("hero"), cast("look", { name: "hero", parentId: "hero", lookName: "雨衣" }), cast("room", { kind: "scene" }), cast("key", { kind: "prop" })];
    const first = shot("one", { castIdsJson: '["hero","hero"]', lookCastIdsJson: '["look"]', propIdsJson: '["key"]', sceneCastId: "room" });
    const second = shot("two", { position: 1, castIdsJson: '["hero"]', lookCastIdsJson: '["look"]' });
    const result = buildDramaAssetUsage({ shots: [first, second], segments: [segment(["one", "two"], [{ castId: "look", kind: "character", name: "hero · 雨衣", label: "参考图1", resourceId: "image-look", sent: true }])] }, assets);
    assert.deepEqual(result.counts, { character: 1, scene: 1, prop: 1, image: 0 });
    assert.equal(result.assetCount, 3);
    assert.deepEqual(result.segments[0].assets.find((item) => item.castId === "look")?.shotIds, ["one", "two"]);
    assert.equal(
        result.segments[0].assets.some((item) => item.castId === "hero"),
        false,
    );
    assert.equal(result.segments[0].shots[1].assets[0].reference?.sent, true);
});

test("核对手动参考与分镜资产，区分缺图、未选用和未附图", () => {
    const assets = [cast("hero"), cast("prop", { kind: "prop", imageResourceId: undefined }), cast("other")];
    const frame = shot("one", { castIdsJson: '["hero"]', propIdsJson: '["prop"]' });
    const result = buildDramaAssetUsage(
        {
            shots: [frame],
            segments: [
                segment(
                    ["one"],
                    [
                        { castId: "other", kind: "character", name: "other", label: "参考图1", resourceId: "other-old", sent: false },
                        { castId: "", kind: "image", name: "构图", label: "参考图2", resourceId: "composition", sent: true },
                    ],
                ),
            ],
        },
        assets,
    );
    const entries = new Map(result.segments[0].assets.map((asset) => [asset.key, asset]));
    assert.equal(entries.get("cast:hero")?.issue, "not-selected");
    assert.equal(entries.get("cast:prop")?.issue, "missing-image");
    assert.equal(entries.get("cast:other")?.issue, "not-sent");
    assert.equal(entries.get("cast:other")?.resourceId, "other-old");
    assert.deepEqual(entries.get("cast:other")?.shotIds, []);
    assert.equal(entries.get("image:composition")?.issue, undefined);
    assert.equal(result.segments[0].issueCount, 3);
});

test("参考请求省略资源 ID 时复用项目图片，并保留实际未附图状态", () => {
    const result = buildDramaAssetUsage({ shots: [], segments: [segment([], [{ castId: "hero", kind: "character", name: "hero", label: "参考图1", sent: false }])] }, [cast("hero")]);
    assert.equal(result.segments[0].assets[0].resourceId, "image-hero");
    assert.equal(result.segments[0].assets[0].issue, "not-sent");
});

test("缺失资产与无法解析的字段显式报告，不当作核查通过", () => {
    const frame = shot("one", { castIdsJson: '["removed"]', lookCastIdsJson: "bad-json", propIdsJson: "[42]" });
    const result = buildDramaAssetUsage({ shots: [frame], segments: [segment(["one", "missing-shot"])] }, []);
    assert.equal(result.segments[0].assets[0].issue, "missing-asset");
    assert.equal(result.segments[0].assets[0].castId, undefined);
    assert.equal(result.warnings.length, 3);
    assert.match(result.warnings[0], /造型配置无法读取/);
    assert.match(result.warnings[2], /无法读取的镜头/);
});

test("保留尚未分段的镜头，避免没有段时隐藏已有配置", () => {
    const result = buildDramaAssetUsage({ shots: [shot("orphan", { sceneCastId: "room" })], segments: [] }, [cast("room", { kind: "scene" })]);
    assert.equal(result.unassignedShots.length, 1);
    assert.equal(result.unassignedShots[0].assets[0].name, "room");
    assert.equal(result.unassignedShots[0].assets[0].issue, undefined);
    assert.equal(result.counts.scene, 1);
    assert.equal(result.segments.length, 0);
});

test("同一素材跨段复用只计一个资产，但每段保留自己的发送状态", () => {
    const first = segment([], [{ castId: "", kind: "image", name: "构图", label: "参考图1", resourceId: "shared", sent: true }]);
    const second = { ...segment([], [{ castId: "", kind: "image", name: "构图", label: "参考图2", resourceId: "shared", sent: false }]), id: "second", index: 1 };
    const result = buildDramaAssetUsage({ shots: [], segments: [first, second] }, []);
    assert.equal(result.counts.image, 1);
    assert.equal(result.segments[0].issueCount, 0);
    assert.equal(result.segments[1].issueCount, 1);
});
