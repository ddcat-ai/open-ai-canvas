import { configuredModelMatchesCapability, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { modelCapabilityConfigFor, type ImageCapabilityConfig } from "@/lib/model-capabilities";
import { parseImageParameters, type ImageParameter } from "@/lib/image-parameters";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

export const LAYER_DECOMPOSITION_PROTOCOL = "image-tools-layer-decomposition";
export const MAX_IMAGE_LAYERS = 32;
export const MAX_LAYER_PIXELS = 16_777_216;
export const MAX_GROUP_PIXELS = 67_108_864;
export const IMAGE_LAYER_REGION_INSTRUCTIONS =
    "若目标含 <bbox>左 上 右 下</bbox>，它是整张参考图的 0–1000 相对坐标，不是像素：像素 x=坐标×参考图宽度/1000，像素 y=坐标×参考图高度/1000。区域只用于定位本层，不能把该区域裁成新画布、居中或放大；保持原始画布和对象位置。";

export function supportsLayerDecomposition(config: AiConfig, model: string) {
    return Boolean(model) && resolveModelRequestConfig(config, model).interfaceType === LAYER_DECOMPOSITION_PROTOCOL;
}

export function supportsExperimentalLayerExtraction(config: AiConfig, model: string) {
    return Boolean(model) && configuredModelMatchesCapability(config, model, "image") && (modelCapabilityConfigFor(config, model).image?.references.maxImages || 0) >= 1;
}

export function parseExperimentalLayerTargets(text: string) {
    const targets = text
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
    if (targets.length < 2 || targets.length > 8) throw new Error("实验拆层需填写 2–8 层，每行一层；第一层为背景底图");
    if (new Set(targets).size !== targets.length) throw new Error("实验拆层目标不能重复");
    return targets;
}

export type ImageLayerGeneration = { prompt: string; background: "opaque" | "transparent" };

/** 每层只有本层提示词和透明度；模型、尺寸、质量和张数仍由用户配置及源图决定。 */
export function parseImageLayerGeneration(value: unknown, index: number): ImageLayerGeneration {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`规划第 ${index + 1} 层缺少独立生成参数，未提交拆图任务`);
    const item = value as Record<string, unknown>;
    if (typeof item.prompt !== "string" || !item.prompt.trim() || item.prompt.length > 3200) throw new Error(`规划第 ${index + 1} 层的独立提示词无效，未提交拆图任务`);
    const background = index === 0 ? "opaque" : "transparent";
    if (item.background !== background) throw new Error(`规划第 ${index + 1} 层的透明度参数与图层角色冲突，未提交拆图任务`);
    if (Object.keys(item).some((key) => key !== "prompt" && key !== "background")) throw new Error(`规划第 ${index + 1} 层包含不支持的生成参数，未提交拆图任务`);
    return { prompt: item.prompt.trim(), background };
}

export function imageLayerGenerationConfig(config: AiConfig, generation: ImageLayerGeneration, index: number): AiConfig {
    const validated = parseImageLayerGeneration(generation, index);
    const transparent = validated.background === "transparent";
    // 透明底按插件参数绑定（binding=transparentBackground）传；同名宿主控件由 config.transparentBackground 带入
    const parameter = imageLayerBackgroundParameter(modelCapabilityConfigFor(config, config.model).image);
    const parameters = parameter && parameter.name !== "transparentBackground" ? { imageParameters: JSON.stringify({ ...parseImageParameters(config.imageParameters), [parameter.name]: imageLayerBackgroundValue(parameter, transparent) }) } : {};
    return { ...config, count: "1", transparentBackground: transparent ? "true" : "false", ...parameters };
}

export function experimentalLayerPrompt(generation: ImageLayerGeneration, bbox?: [number, number, number, number]) {
    const contract =
        generation.background === "opaque"
            ? "这是完整、不透明的背景底图，每个像素必须 alpha=255。移除指定对象并补全遮挡处，保留其他环境、底色、光照、纹理和设计结构。待移除对象若是完整照片、卡片或面板，移除整块及内部内容；补全为原有底色或环境，不重新添加已移除对象，不添加不存在的物体。不要透明背景或半透明底图。"
            : "这是独立透明对象：仅保留本层目标，去除非目标内容，空白区域必须为真实 alpha=0，保留自然边缘与接地阴影。目标若为整张照片、卡片或面板，复制整块面板的全部原始内容（主体、内部场景、边框与圆角），内部保持不透明，只让面板外透明；不做面板内部主体抠图，不把面板里的主体单独放大。";
    return `本次仅输出一张独立图层。${contract}\n本层任务：${generation.prompt}${bbox ? `\n本层定位区域 <bbox>${bbox.join(" ")}</bbox>。` : ""}\n${IMAGE_LAYER_REGION_INSTRUCTIONS}保持参考图完整画布尺寸、原始位置、比例和细节，不扩图、不裁切、不居中重排。输出 PNG，不要拼版、文字标注或绘制棋盘格。`;
}

/** 插件声明里绑定透明底的参数（binding 或同名宿主控件）。 */
function imageLayerBackgroundParameter(profile: ImageCapabilityConfig | undefined) {
    const parameter = (profile?.parameters || []).find((item) => item.enabled !== false && (item.binding === "transparentBackground" || item.name === "transparentBackground"));
    if (!parameter) return undefined;
    // 能力位或插件显式绑定任一成立，即视为声明支持透明底
    return profile?.transparentBackground.supported || parameter.binding === "transparentBackground" ? parameter : undefined;
}

function imageLayerBackgroundValue(parameter: ImageParameter, transparent: boolean) {
    if (parameter.type === "boolean") return transparent;
    return transparent ? "true" : "false";
}

/** OpenAI Images 的 false 默认可能仍是 auto；拆层底图明确请求 opaque。 */
export function imageLayerProviderMetadata(config: AiConfig, index: number) {
    const protocol = resolveModelRequestConfig(config, config.model).interfaceType;
    // 作者内置 openai-image 的行为保持不变：仍由 providerOptions.background 控制透明底。
    if (protocol === "openai-image") return { providerOptions: { [protocol]: { background: index === 0 ? "opaque" : "transparent" } } };
    // 声明式插件模型改读能力声明的透明底参数绑定，不再只给 openai-image 写 providerOptions
    if (!imageLayerBackgroundParameter(modelCapabilityConfigFor(config, config.model).image)) return {};
    return { transparentBackground: index === 0 ? "false" : "true" };
}

export function experimentalLayerSignature(root: CanvasNodeData, nodes: CanvasNodeData[]) {
    return JSON.stringify(
        root.metadata?.experimentalLayerPlan?.requests.map((request) => {
            const child = nodes.find((node) => node.id === request.nodeId);
            return [request.nodeId, request.target, child?.metadata?.status, child?.metadata?.layerExtraction?.phase, child?.metadata?.storageKey || child?.metadata?.content];
        }),
    );
}

export function layerDecompositionConfig(config: AiConfig, model: string, parameters?: Partial<Pick<AiConfig, "size" | "quality">>): AiConfig {
    return { ...config, ...parameters, model, imageModel: model, count: "1", taskWorkflowProvider: "model" };
}

export type LayerRasterInfo = { width: number; height: number; transparent: boolean; nonempty: boolean; opaque?: boolean; transparentPixels?: number };

export function inspectLayerAlpha(width: number, height: number, rgba: Uint8ClampedArray): LayerRasterInfo {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > MAX_LAYER_PIXELS || rgba.length !== width * height * 4) {
        throw new Error("图层尺寸无效或超过处理上限");
    }
    let transparent = false;
    let nonempty = false;
    let opaque = true;
    let transparentPixels = 0;
    for (let index = 3; index < rgba.length; index += 4) {
        if (rgba[index] === 0) {
            transparent = true;
            transparentPixels += 1;
        }
        if (rgba[index] > 0) nonempty = true;
        if (rgba[index] !== 255) opaque = false;
    }
    return { width, height, transparent, nonempty, opaque, transparentPixels };
}

export function hasUsableLayerTransparency(info: LayerRasterInfo) {
    return info.transparent && (info.transparentPixels === undefined || info.transparentPixels >= Math.max(1, Math.ceil(info.width * info.height * 0.001)));
}

/** 最终产出保留原始 alpha；透明度只决定是否走既有去背景流程，不阻止显示和合成。 */
export function validateImageLayerOutput(info: LayerRasterInfo) {
    if (!info.nonempty) throw new Error("提取结果是完全透明的空图层");
}

/** 原图底板修补的输入仍要求完整不透明，避免改变区域外原像素。 */
export function validateImageLayerRole(info: LayerRasterInfo, index: number) {
    if (!info.nonempty) throw new Error("提取结果是完全透明的空图层");
    if (index === 0 && info.opaque !== true) throw new Error("背景底图仍含透明或半透明像素，未形成完整不透明场景；请单独重新生成背景，不会自动付费重试");
    if (index > 0 && !hasUsableLayerTransparency(info)) throw new Error("对象图层未返回有效的真实透明背景，棋盘格、纯色或零散透明像素不能作为去背景结果");
}

/** 最终图层只按资源、尺寸和数量验收，保留其真实 alpha。 */
export function validateLayerRasters(layers: LayerRasterInfo[]) {
    if (layers.length < 2) throw new Error("拆层至少需要两张独立图片，单张拼版图不能作为图层结果");
    if (layers.length > MAX_IMAGE_LAYERS) throw new Error(`图层数量超过 ${MAX_IMAGE_LAYERS} 层处理上限`);
    const { width, height } = layers[0];
    if (layers.some((layer) => !layer.nonempty)) throw new Error("拆层结果包含完全透明的空图层");
    if (layers.some((layer) => layer.width !== width || layer.height !== height)) throw new Error("图层尺寸不一致，无法确定合成坐标；请使用同尺寸透明图层输出");
    if (width * height > MAX_LAYER_PIXELS || width * height * layers.length > MAX_GROUP_PIXELS) throw new Error("图层总像素量超过处理上限");
    const opaque = layers.flatMap((layer, index) => (layer.transparent ? [] : [index]));
    // 只有唯一候选底图时沿用置底规则；多张候选不猜角色，保留模型输出顺序。
    if (opaque.length !== 1) return layers.map((_, index) => index);
    return [...opaque, ...layers.flatMap((layer, index) => (layer.transparent ? [index] : []))];
}

export function imageLayerCompositeSignature(group: NonNullable<CanvasNodeMetadata["imageLayerGroup"]>, nodes: CanvasNodeData[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return JSON.stringify([
        group.width,
        group.height,
        group.layers.map((layer) => {
            const node = byId.get(layer.nodeId);
            return [layer.nodeId, layer.x, layer.y, layer.visible, node?.metadata?.storageKey || node?.metadata?.content || "", node?.metadata?.naturalWidth, node?.metadata?.naturalHeight];
        }),
    ]);
}

export function copyImageLayerSources(source: CanvasNodeData, nodes: CanvasNodeData[]) {
    if (!source.metadata?.imageLayerGroup) return [source];
    const ids = new Set(source.metadata.imageLayerGroup.layers.map((layer) => layer.nodeId));
    return [source, ...nodes.filter((node) => ids.has(node.id))];
}
