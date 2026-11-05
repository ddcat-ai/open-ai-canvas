import { isTextWire, type TextWire } from "@/lib/model-protocols";
import { loadUserProtocolCatalog } from "@/services/api/plugin-catalog";

// 内置协议本身就定义了请求格式；插件协议（deepseek-chat、kimi-chat 等）的格式由后端按
// 插件 create 路径识别，系统渠道随模型目录下发，自定义渠道从插件目录查找。
const BUILTIN_TEXT_WIRES: Record<string, TextWire> = {
    "chat-completion": "chat-completion",
    "openai-response": "responses",
    "claude-api": "claude-api",
};

type TextWireConfig = { textWire?: string; interfaceType?: string; channelId?: string };
type ProtocolCatalogLoader = () => Promise<Array<{ value: string; textWire?: TextWire }>>;

/**
 * 解析浏览器直连文本接口时使用的请求格式。返回 undefined 表示协议不是宿主已知格式
 * （或插件目录暂时取不到），调用方保持原有的兜底路径。
 */
export async function resolveTextWire(config: TextWireConfig, loadCatalog: ProtocolCatalogLoader = loadUserProtocolCatalog): Promise<TextWire | undefined> {
    if (isTextWire(config.textWire)) return config.textWire;
    const protocol = config.interfaceType?.trim();
    if (!protocol) return undefined;
    const builtin = BUILTIN_TEXT_WIRES[protocol];
    // 系统渠道的格式只来自模型目录；目录没有给出时不再额外请求插件目录。
    if (builtin || config.channelId) return builtin;
    try {
        const wire = (await loadCatalog()).find((item) => item.value === protocol)?.textWire;
        return isTextWire(wire) ? wire : undefined;
    } catch (error) {
        // 插件目录只用于选择接口路径；取不到时按原有兜底发送，由上游返回真实错误。
        console.warn("插件目录读取失败，文本请求按默认格式发送", error);
        return undefined;
    }
}
