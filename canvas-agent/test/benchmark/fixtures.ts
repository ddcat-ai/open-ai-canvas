/**
 * Storyboard Benchmark v1 — 5个测试用例
 *
 * 覆盖不同电影制作问题：情感、对话、动作、揭示、TVC广告。
 * 每个fixture定义结构化评估目标，不评估主观艺术质量。
 */

import type { BenchmarkFixture } from "./types";

export const BENCHMARK_FIXTURES: BenchmarkFixture[] = [
    // ============ A. EMOTIONAL ============
    {
        id: "emotional-convenience-store",
        name: "凌晨便利店的生日祝福",
        category: "emotional",
        script: `一个失业程序员凌晨独自在便利店吃泡面。
手机收到女儿发来的生日祝福语音消息。
他愣住，眼眶泛红，然后默默把手机贴在耳边反复听。
最后他看向窗外，城市的灯光在凌晨显得格外遥远。`,
        requestedShotCount: 8,
        totalDurationMs: 40000,
        expected: {
            requiredBeats: ["setup", "reveal", "reaction", "emotional_turn", "resolution"],
            minimumShotSizeCategories: 3,
            maximumRepeatedShotSizeRun: 3,
            requiresReactionShot: true,
            requiresInsertShot: true,
            movementPolicy: "restrained",
            durationPolicy: "varied",
            forbiddenGeneration: ["canvas_generate_image", "canvas_generate_video", "canvas_generate_audio", "canvas_run_generation"],
            totalDurationToleranceMs: 8000,
        },
    },

    // ============ B. DIALOGUE ============
    {
        id: "dialogue-former-partners",
        name: "咖啡馆里的前合伙人",
        category: "dialogue",
        script: `两个前合伙人在咖啡馆见面。
其中一方知道另一方曾经撒谎，但没有立刻揭穿。
对话从客套开始，逐渐暗流涌动。
知道真相的一方在关键时刻放下咖啡杯，目光变得锐利。
另一方察觉到气氛变化，开始回避眼神。
最后知道真相的一方说了一句意味深长的话，起身离开。`,
        requestedShotCount: 10,
        totalDurationMs: 60000,
        expected: {
            requiredBeats: ["setup", "tension", "escalation", "reveal", "reaction", "resolution"],
            minimumShotSizeCategories: 3,
            maximumRepeatedShotSizeRun: 2,
            requiresReactionShot: true,
            requiresInsertShot: false,
            movementPolicy: "restrained",
            durationPolicy: "varied",
            forbiddenGeneration: ["canvas_generate_image", "canvas_generate_video", "canvas_generate_audio", "canvas_run_generation"],
            totalDurationToleranceMs: 12000,
        },
    },

    // ============ C. ACTION ============
    {
        id: "action-courier-escape",
        name: "拥挤车站里的快递员逃脱",
        category: "action",
        script: `一个携带重要包裹的快递员穿过拥挤的车站。
他突然意识到有人在跟踪自己。
他加快脚步，跟踪者也加速。
他试图混入人群摆脱跟踪，在楼梯口和跟踪者擦肩而过。
他冲进即将关闭的地铁车厢，回头看到跟踪者被挡在门外。
他靠在车厢壁上，紧紧抱住包裹，大口喘气。`,
        requestedShotCount: 10,
        totalDurationMs: 45000,
        expected: {
            requiredBeats: ["setup", "realization", "pursuit", "escalation", "escape", "resolution"],
            minimumShotSizeCategories: 3,
            maximumRepeatedShotSizeRun: 3,
            requiresReactionShot: true,
            requiresInsertShot: false,
            movementPolicy: "action",
            durationPolicy: "action-readable",
            forbiddenGeneration: ["canvas_generate_image", "canvas_generate_video", "canvas_generate_audio", "canvas_run_generation"],
            totalDurationToleranceMs: 10000,
            minActionShotDurationMs: 1500,
        },
    },

    // ============ D. REVEAL ============
    {
        id: "reveal-childhood-home",
        name: "童年老屋里被剪掉的孩子",
        category: "reveal",
        script: `一个女人回到童年老屋，寻找一张旧照片。
她在积灰的抽屉里找到那张全家福。
她擦去灰尘，发现照片边缘有被刻意剪掉的痕迹。
她把照片对着光，隐约看到被剪掉的位置有另一个孩子的轮廓。
她愣住，手开始颤抖。
她翻找其他旧照片，发现每一张全家福里同一个位置都被剪掉了。
她坐在地板上，手中的照片滑落，眼神空洞。`,
        requestedShotCount: 9,
        totalDurationMs: 50000,
        expected: {
            requiredBeats: ["setup", "search", "discovery", "reveal", "reaction", "escalation", "resolution"],
            minimumShotSizeCategories: 3,
            maximumRepeatedShotSizeRun: 3,
            requiresReactionShot: true,
            requiresInsertShot: true,
            movementPolicy: "restrained",
            durationPolicy: "varied",
            forbiddenGeneration: ["canvas_generate_image", "canvas_generate_video", "canvas_generate_audio", "canvas_run_generation"],
            totalDurationToleranceMs: 10000,
        },
    },

    // ============ E. TVC ============
    {
        id: "tvc-premium-ev",
        name: "高端电动车30秒广告",
        category: "tvc",
        script: `30秒高端纯电动车广告。
强调智能驾驶和静谧座舱。
避免纯功能罗列，用故事化方式呈现产品利益点。
品牌调性：高端、克制、科技感。`,
        requestedShotCount: 8,
        totalDurationMs: 30000,
        expected: {
            requiredBeats: ["product_hero", "benefit_driving", "benefit_cabin", "lifestyle", "brand_ending"],
            minimumShotSizeCategories: 3,
            maximumRepeatedShotSizeRun: 2,
            requiresReactionShot: false,
            requiresInsertShot: true,
            movementPolicy: "motivated",
            durationPolicy: "varied",
            forbiddenGeneration: ["canvas_generate_image", "canvas_generate_video", "canvas_generate_audio", "canvas_run_generation"],
            totalDurationToleranceMs: 3000,
        },
    },
];

export function getFixtureById(id: string): BenchmarkFixture | undefined {
    return BENCHMARK_FIXTURES.find((f) => f.id === id);
}
