import { ART_CRITIQUE_PLUGIN_ID } from "@/lib/art-critique/contracts";
import { MEDIA_CONVERSION_PLUGIN_ID } from "@/lib/plugins/builtin/media-conversion";
import { EAGLE_PLUGIN_ID } from "@/lib/plugins/builtin/eagle";
import { PROMPT_OPTIMIZER_PLUGIN_ID } from "@/lib/plugins/builtin/prompt-optimizer";
import { COMFYUI_PLUGIN_ID, RUNNINGHUB_PLUGIN_ID } from "@/lib/plugins/builtin/workflows";
import { PORTRAIT_CLEARANCE_PLUGIN_ID } from "@/lib/portrait-clearance/contracts";

import { EDITOR_SHELL_PLUGIN_ID } from "./builtin/editor/editor-shell";

/**
 * 官方“应用型”插件清单：这些插件在管理页按用户自主启停处理，而不是系统协议。
 *
 * 之前管理页、用户插件页和后端各自维护一份清单，管理页漏掉 AI 审美分析和剪辑
 * 工作台，导致二者被误判为系统协议并在管理页显示“已停用”。这里收敛为唯一来源。
 */
export const OFFICIAL_APPLICATION_PLUGIN_IDS = [
    RUNNINGHUB_PLUGIN_ID,
    COMFYUI_PLUGIN_ID,
    EAGLE_PLUGIN_ID,
    PROMPT_OPTIMIZER_PLUGIN_ID,
    PORTRAIT_CLEARANCE_PLUGIN_ID,
    ART_CRITIQUE_PLUGIN_ID,
    MEDIA_CONVERSION_PLUGIN_ID,
    EDITOR_SHELL_PLUGIN_ID,
] as const;

const officialApplicationIdSet = new Set<string>(OFFICIAL_APPLICATION_PLUGIN_IDS);

/** 判断插件是否为官方应用型插件（用户可在插件页自主启停）。 */
export function isOfficialApplicationPluginId(pluginId: string) {
    return officialApplicationIdSet.has(pluginId);
}
