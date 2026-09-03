/**
 * Storyboard Benchmark v1 — 合成测试样本
 *
 * 明确标注为 synthetic-test-fixture，不作为真实Codex benchmark结果。
 * 用于评估器单元测试。
 */

import type { BenchmarkRecording } from "./types";

// ============ 完美样本（接近满分） ============

export const perfectEmotionalRecording: BenchmarkRecording = {
    fixtureId: "emotional-convenience-store",
    mode: "storyboard-director",
    generatedAt: "2026-09-02T00:00:00.000Z",
    shots: [
        { position: 0, title: "凌晨便利店外景", description: "城市凌晨，便利店灯光在黑暗中格外醒目", shotSize: "wide", cameraMovement: "static", durationMs: 5000, beatTags: ["setup"] },
        { position: 1, title: "程序员独自吃泡面", description: "他坐在便利店角落，面前是一碗泡面", shotSize: "medium", cameraMovement: "static", durationMs: 4000, beatTags: ["setup"], continuityTags: ["same-location"] },
        { position: 2, title: "手机屏幕亮起", description: "手机屏幕突然亮起，显示女儿的头像", shotSize: "detail", cameraMovement: "static", durationMs: 2000, beatTags: ["reveal"], continuityTags: ["phone-prop"] },
        { position: 3, title: "他愣住", description: "他拿起手机，看到消息内容，手停在半空", shotSize: "close", cameraMovement: "static", durationMs: 3000, beatTags: ["reaction"], continuityTags: ["phone-prop"] },
        { position: 4, title: "眼眶泛红", description: "他的眼眶开始泛红，嘴唇微微颤抖", shotSize: "close", cameraMovement: "static", durationMs: 4000, beatTags: ["reaction", "emotional_turn"] },
        { position: 5, title: "反复听语音", description: "他把手机贴在耳边，反复播放那条语音消息", shotSize: "medium", cameraMovement: "static", durationMs: 6000, beatTags: ["emotional_turn"], continuityTags: ["phone-prop"] },
        { position: 6, title: "看向窗外", description: "他放下手机，转头看向便利店窗外", shotSize: "medium", cameraMovement: "pan_tilt", durationMs: 4000, beatTags: ["resolution"] },
        { position: 7, title: "城市灯光", description: "窗外凌晨的城市灯光，遥远而安静", shotSize: "wide", cameraMovement: "static", durationMs: 5000, beatTags: ["resolution"] },
    ],
    toolTrace: ["project_get_context", "project_create_or_update_shots", "canvas_create_storyboard_shots"],
};

// ============ Baseline样本（常见违规） ============

export const baselineEmotionalRecording: BenchmarkRecording = {
    fixtureId: "emotional-convenience-store",
    mode: "baseline",
    generatedAt: "2026-09-02T00:00:00.000Z",
    shots: [
        { position: 0, title: "便利店", description: "一个人在便利店", shotSize: "medium", cameraMovement: "dolly", durationMs: 5000 },
        { position: 1, title: "吃泡面", description: "他在吃泡面", shotSize: "medium", cameraMovement: "dolly", durationMs: 5000 },
        { position: 2, title: "手机响了", description: "手机响了", shotSize: "medium", cameraMovement: "dolly", durationMs: 5000 },
        { position: 3, title: "看手机", description: "他看手机", shotSize: "medium", cameraMovement: "dolly", durationMs: 5000 },
        { position: 4, title: "哭了", description: "他哭了", shotSize: "medium", cameraMovement: "dolly", durationMs: 5000 },
        { position: 5, title: "听语音", description: "他听语音", shotSize: "medium", cameraMovement: "dolly", durationMs: 5000 },
        { position: 6, title: "看窗外", description: "他看窗外", shotSize: "medium", cameraMovement: "dolly", durationMs: 5000 },
        { position: 7, title: "结束", description: "结束", shotSize: "medium", cameraMovement: "dolly", durationMs: 5000 },
    ],
    toolTrace: ["canvas_create_text_node", "canvas_generate_image"],
};

// ============ Director样本（比baseline好） ============

export const directorEmotionalRecording: BenchmarkRecording = {
    fixtureId: "emotional-convenience-store",
    mode: "storyboard-director",
    generatedAt: "2026-09-02T00:00:00.000Z",
    shots: [
        { position: 0, title: "凌晨便利店", description: "城市凌晨，便利店的灯光", shotSize: "wide", cameraMovement: "static", durationMs: 5000, beatTags: ["setup"] },
        { position: 1, title: "独自吃泡面", description: "程序员坐在角落吃泡面", shotSize: "medium", cameraMovement: "static", durationMs: 4000, beatTags: ["setup"], continuityTags: ["same-location"] },
        { position: 2, title: "手机亮起", description: "手机屏幕亮起，女儿的头像", shotSize: "detail", cameraMovement: "static", durationMs: 2000, beatTags: ["reveal"], continuityTags: ["phone-prop"] },
        { position: 3, title: "愣住", description: "他拿起手机愣住", shotSize: "close", cameraMovement: "static", durationMs: 3000, beatTags: ["reaction"] },
        { position: 4, title: "眼眶泛红", description: "眼眶泛红，情绪涌动", shotSize: "close", cameraMovement: "static", durationMs: 4000, beatTags: ["reaction", "emotional_turn"] },
        { position: 5, title: "反复听", description: "反复听女儿的语音", shotSize: "medium", cameraMovement: "static", durationMs: 6000, beatTags: ["emotional_turn"], continuityTags: ["phone-prop"] },
        { position: 6, title: "看向窗外", description: "看向窗外的城市", shotSize: "medium", cameraMovement: "pan_tilt", durationMs: 4000, beatTags: ["resolution"] },
        { position: 7, title: "城市灯光", description: "凌晨的城市灯光", shotSize: "wide", cameraMovement: "static", durationMs: 5000, beatTags: ["resolution"] },
    ],
    toolTrace: ["project_get_context", "project_create_or_update_shots", "canvas_create_storyboard_shots"],
};

// ============ 错误分镜数量样本 ============

export const wrongShotCountRecording: BenchmarkRecording = {
    ...perfectEmotionalRecording,
    mode: "baseline",
    shots: perfectEmotionalRecording.shots.slice(0, 5),
};

// ============ 错误工具顺序样本 ============

export const wrongToolOrderRecording: BenchmarkRecording = {
    ...perfectEmotionalRecording,
    mode: "baseline",
    toolTrace: ["canvas_create_storyboard_shots", "project_create_or_update_shots", "project_get_context"],
};

// ============ 缺少节拍样本 ============

export const missingBeatsRecording: BenchmarkRecording = {
    ...perfectEmotionalRecording,
    mode: "baseline",
    shots: perfectEmotionalRecording.shots.map((s) => ({
        ...s,
        beatTags: s.beatTags?.filter((t) => t !== "reveal" && t !== "emotional_turn"),
    })),
};
