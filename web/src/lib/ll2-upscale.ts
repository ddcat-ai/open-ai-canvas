import { LL2_MODEL_SPECS, ll2FormatCNY, ll2FriendlyCNY } from "@/lib/ll2-models";

/**
 * auto-hd 超分档位（后处理，不是生成模型）。
 *
 * 2026-11-19 用户口径：客户写提示词时勾选「生成后顺便超分」，再选 1K / 2K / 4K。
 * 只能往上超：目标档必须严格高于当前生成档，同档或降级一律不出现，
 * 所以 H3 768P 不会看到「超到 720P」，1080P 的模型也不会看到「超到 480P」。
 */

export type LL2UpscaleTarget = "1080p" | "2k" | "4k";

type UpscaleTargetSpec = { id: LL2UpscaleTarget; label: string; rank: number };

const UPSCALE_TARGETS: UpscaleTargetSpec[] = [
    { id: "1080p", label: "1080P", rank: 1080 },
    { id: "2k", label: "2K", rank: 1440 },
    { id: "4k", label: "4K", rank: 2160 },
];

/** 把任意档位写法（480P / 540p / 768P / 1080P / 1K / 2K / 4K）换算成像素高度。 */
export function ll2ResolutionRank(resolution: string): number {
    const text = String(resolution || "").trim().toLowerCase();
    if (!text) return 0;
    if (text.includes("4k")) return 2160;
    if (text.includes("2k")) return 1440;
    if (text.includes("1080") || text.includes("1k")) return 1080;
    if (text.includes("768")) return 768;
    if (text.includes("720")) return 720;
    if (text.includes("540")) return 540;
    if (text.includes("480")) return 480;
    return 0;
}

/** 当前生成档位能选哪些超分目标（只返回更高的档）。 */
export function ll2UpscaleTargetsFor(resolution: string): UpscaleTargetSpec[] {
    const sourceRank = ll2ResolutionRank(resolution);
    return UPSCALE_TARGETS.filter((target) => target.rank > sourceRank);
}

export function ll2UpscaleTargetLabel(target: string): string {
    return UPSCALE_TARGETS.find((item) => item.id === target)?.label || String(target || "");
}

/** auto-hd 按成片秒数计费，单价来自官网快照（元/秒）。 */
export function ll2UpscaleEstimate(seconds: number, target: string) {
    const tiers = LL2_MODEL_SPECS["auto-hd"]?.tiers || [];
    const tier = tiers.find((item) => item.label.toLowerCase() === String(target).toLowerCase()) || tiers[0];
    const perSecond = tier?.perSecond || 0;
    const duration = Math.max(1, Number(seconds) || 5);
    const amount = perSecond * duration;
    return {
        amount,
        perSecond,
        label: `约 ${ll2FriendlyCNY(amount)}`,
        basis: `${ll2UpscaleTargetLabel(target)} ¥${ll2FormatCNY(perSecond)}/秒 × ${duration} 秒（按成片秒数）`,
    };
}
