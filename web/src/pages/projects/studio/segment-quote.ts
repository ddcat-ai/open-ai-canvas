// 剧情段视频的报价检查：与 ModelPicker「当前规格无报价」同一判断（priceTiersForCurrentSelection），
// 只是把规格换成本段实际发送的时长、分辨率、声音与参考图，而不是创作端的全局参数。
import { dramaChoiceKey, dramaChoiceToModel, dramaVideoResolutionValue } from "@/lib/drama/model-choice";
import { priceTiersForCurrentSelection } from "@/lib/model-pricing";
import type { ModelRequirements } from "@/lib/model-selection";
import type { DramaModelChoice, DramaModelOption, DramaSegmentRequest } from "@/services/api/drama";
import { videoResolutionComparisonKey } from "@/lib/video-generation-options";
import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

export const SEGMENT_NO_QUOTE_HINT = "当前规格无报价，请调整时长、分辨率或更换模型";
const PLAIN_RESOLUTION = /^\d+p$/;

/**
 * 本段视频的计价规格；规格还不完整（时长、生成方式、分辨率或声音未知）时返回 undefined，
 * 不在前端拦截，交给服务端准入。changed 表示本段换了模型：request 里的画面与声音参数是按原模型算的，改用新模型的目录信息。
 */
export function dramaSegmentVideoRequirements(request: DramaSegmentRequest, option: DramaModelOption | undefined, changed: boolean, videoResolution?: string): ModelRequirements | undefined {
    if (!request.operation || request.seconds <= 0) return undefined;
    // 换了模型时服务端会按新模型重新换算分辨率；用横竖标签（如 768p竖）表达画幅的模型前端算不准，不判定。
    const resolutions = option?.videoResolutions || [];
    if (changed && !(resolutions.length && resolutions.every((value) => PLAIN_RESOLUTION.test(videoResolutionComparisonKey(value))))) return undefined;
    // 新模型给不出作品分辨率时按模型默认提交，报价也用同一个默认档，不能用旧分辨率的价格档。
    const supported = dramaVideoResolutionValue(option, videoResolution);
    const resolution = changed ? supported || option?.defaultVideoResolution || "" : request.resolution || supported || option?.defaultVideoResolution || "";
    const generateAudio = changed ? option?.generateAudio : request.generateAudio;
    if (!resolution || generateAudio === undefined) return undefined;
    // 首帧与随请求发送的参考图都按图片输入计价，口径与服务端一致。
    const imageCount = request.references.filter((reference) => reference.sent).length + (request.firstFrameResourceId || request.firstFramePending ? 1 : 0);
    return {
        capability: "video",
        input: { textCount: 1, imageCount, videoCount: 0, audioCount: 0, characterCount: 0 },
        videoOperation: request.operation,
        videoSeconds: String(request.seconds),
        options: { size: request.size || request.aspectRatio, vquality: resolution, videoGenerateAudio: generateAudio },
    };
}

/** 模型按渠道档位计价、配置了档位，但没有一档对得上本段规格时返回 true；没有报价信息或规格不完整时不判定。 */
export function dramaSegmentQuoteMissing(config: AiConfig, choice: DramaModelChoice, requirements: ModelRequirements | undefined) {
    if (!requirements) return false;
    const model = dramaChoiceToModel(config, "video", choice);
    if (!model) return false;
    const cost = resolveModelChannel(config, model).modelCosts?.find((item) => item.model === modelOptionName(model));
    const tiers = cost?.pricePolicy === "channel" ? cost.logicalPriceTiers || [] : [];
    if (!tiers.length) return false;
    return priceTiersForCurrentSelection(tiers, "video", config, requirements).length === 0;
}

/** 目录里与当前选择对应的视频模型选项。 */
export function dramaVideoOptionFor(options: DramaModelOption[] | undefined, choice: DramaModelChoice) {
    const key = dramaChoiceKey(choice);
    return key ? options?.find((option) => dramaChoiceKey(option.choice) === key) : undefined;
}
