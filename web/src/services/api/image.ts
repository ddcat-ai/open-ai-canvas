import axios from "axios";

import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { dataUrlToFile } from "@/lib/image-utils";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { channelRequest } from "@/services/api/custom-channel-relay";
import { imageToDataUrl } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";
import { withOpenAIPromptCacheKey } from "@/lib/openai-prompt-cache";
import { modelCapabilityConfigFor, normalizeImageValue } from "@/lib/model-capabilities";
import { buildGeminiImageGenerationConfig, parseGeminiImageDataUrl, type GeminiImageGenerationConfig } from "@/lib/gemini-image";
import { aiApiUrl, aiHeaders, geminiApiUrl, geminiHeaders, postChannelJSON, postGeminiJSON, postVolcengineArkImage } from "@/services/api/image-transport";

const IMAGE_OUTPUT_FORMAT = "png";
import type { AiTextMessage, GeminiPart, ImageApiResponse, RequestOptions, ResponseApiPayload, ResponseFunctionTool, ResponseInputMessage, ToolChoice, ToolResponseResult } from "@/services/api/image-contracts";
import { normalizeGrokImageResolution, normalizeQuality, normalizeVolcengineArkImageSize, resolveImageRequestSize, validateImageCapability } from "@/services/api/image-validation";
import { parseGeminiImagePayload, parseImagePayload, readAxiosError } from "@/services/api/image-response";
import { toChatCompletionMessages, toChatCompletionToolChoice, toClaudeBody, toGeminiBody, toGeminiToolOptions, toResponseInput, toResponseTool, withSystemMessage } from "@/services/api/image-protocols";
import { requestGeminiStreamingResponse, requestStreamingChatCompletion, requestStreamingClaude, requestStreamingResponse } from "@/services/api/image-streaming";
export { buildBackendToolRequests } from "@/services/api/image-protocols";
export type { AiTextContentPart, AiTextMessage, ResponseFunctionTool, ResponseInputMessage, ResponseToolCall, ToolChoice, ToolResponseResult } from "@/services/api/image-contracts";

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function isToolChoiceCompatibilityError(error: unknown) {
    const message = error instanceof Error ? error.message : "";
    return /tool[_\s-]?choice|thinking\s+mode/i.test(message);
}

async function requestGeminiImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, generationConfig: GeminiImageGenerationConfig, options?: RequestOptions) {
    // 参考图先完整读取并校验一次，再复用已解析的 inlineData；不能让每个输出重新读取 storageKey，
    // 否则资源缓存瞬时未命中时会出现“偶发缺参考图”或把 storageKey 当 URL 请求的问题。
    const referenceParts = await Promise.all(
        references.map(async (image) => {
            const dataUrl = await imageToDataUrl(image);
            const inlineData = parseGeminiImageDataUrl(dataUrl);
            return { inlineData };
        }),
    );
    const requests = Array.from({ length: count }, () => requestGeminiImagesOnce(config, prompt, referenceParts, generationConfig, options));
    return (await Promise.all(requests)).flat();
}

async function requestGeminiImagesOnce(config: AiConfig, prompt: string, referenceParts: GeminiPart[], generationConfig: GeminiImageGenerationConfig, options?: RequestOptions) {
    const parts: GeminiPart[] = [{ text: prompt }, ...referenceParts];
    const response = await postGeminiJSON(
        config,
        {
            ...toGeminiBody(config, [{ role: "user", content: prompt }], { generationConfig }),
            contents: [{ role: "user", parts }],
        },
        options,
    );
    return parseGeminiImagePayload(response);
}

export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    const selectedModel = config.model || config.imageModel;
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const imageProfile = modelCapabilityConfigFor(config, selectedModel).image!;
    validateImageCapability(imageProfile, []);
    const normalizedImage = normalizeImageValue(imageProfile, config);
    const n = Number(normalizedImage.count);
    if (requestConfig.interfaceType === "gemini-image") {
        try {
            return await requestGeminiImages(requestConfig, prompt, [], n, buildGeminiImageGenerationConfig(normalizedImage.size, normalizedImage.quality), options);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    if (requestConfig.interfaceType === "grok-image") {
        try {
            const size = normalizedImage.size && normalizedImage.size !== "auto" ? normalizedImage.size : undefined;
            const aspectRatio = size?.includes(":") ? size : undefined;
            const resolution = normalizeGrokImageResolution(normalizedImage.quality);
            const responseData = await postChannelJSON<ImageApiResponse>(
                requestConfig,
                aiApiUrl(requestConfig, "/images/generations"),
                {
                    model: requestConfig.model,
                    prompt: withSystemPrompt(requestConfig, prompt),
                    n,
                    response_format: "url",
                    ...(size ? { size } : {}),
                    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
                    ...(resolution ? { resolution } : {}),
                },
                options,
            );
            return parseImagePayload(responseData);
        } catch (error) {
            throw new Error(readAxiosError(error, "Grok 图片生成失败"));
        }
    }
    const quality = imageProfile.quality.supported && normalizedImage.quality !== "auto" ? normalizeQuality(normalizedImage.quality) || normalizedImage.quality : undefined;
    const requestSize = resolveImageRequestSize(imageProfile, quality, normalizedImage.size);
    const isVolcengineArk = requestConfig.interfaceType === "volcengine-ark-image";
    const normalizedRequestSize = requestSize?.parameter === "size" && isVolcengineArk ? { ...requestSize, value: normalizeVolcengineArkImageSize(requestSize.value)! } : requestSize;
    try {
        const payload = isVolcengineArk
            ? {
                  model: requestConfig.model,
                  prompt: withSystemPrompt(requestConfig, prompt),
                  n,
                  response_format: "b64_json",
                  watermark: false,
                  ...(normalizedRequestSize ? { [normalizedRequestSize.parameter]: normalizedRequestSize.value } : {}),
              }
            : {
                  model: requestConfig.model,
                  prompt: withSystemPrompt(requestConfig, prompt),
                  n,
                  ...(quality ? { quality } : {}),
                  ...(requestSize ? { [requestSize.parameter]: requestSize.value } : {}),
                  ...(imageProfile.responseFormat.supported ? { response_format: "b64_json" } : {}),
                  ...(imageProfile.outputFormat.supported ? { output_format: IMAGE_OUTPUT_FORMAT } : {}),
                  ...(imageProfile.transparentBackground.supported && normalizedImage.transparentBackground === "true" ? { background: "transparent" } : {}),
              };
        const responseData = isVolcengineArk ? await postVolcengineArkImage(requestConfig, payload, options) : await postChannelJSON<ImageApiResponse>(requestConfig, aiApiUrl(requestConfig, "/images/generations"), payload, options);
        const images = parseImagePayload(responseData);
        return images;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

async function grokImageInputURL(image: ReferenceImage) {
    const candidate = image.url?.trim() || "";
    if (/^https?:\/\//i.test(candidate)) return candidate;
    return imageToDataUrl(image);
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions) {
    const selectedModel = config.model || config.imageModel;
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const imageProfile = modelCapabilityConfigFor(config, selectedModel).image!;
    validateImageCapability(imageProfile, references, mask);
    const normalizedImage = normalizeImageValue(imageProfile, config);
    const n = Number(normalizedImage.count);
    const requestPrompt = buildImageReferencePromptText(prompt, references);
    if (requestConfig.interfaceType === "gemini-image") {
        if (mask) throw new Error("Gemini 调用格式暂不支持蒙版编辑");
        try {
            return await requestGeminiImages(requestConfig, requestPrompt, references, n, buildGeminiImageGenerationConfig(normalizedImage.size, normalizedImage.quality), options);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    if (requestConfig.interfaceType === "grok-image") {
        if (mask) throw new Error("Grok 图片协议不支持蒙版编辑，请移除蒙版后重试");
        if (references.length !== 1) throw new Error("Grok 图片编辑必须提供且仅支持 1 张参考图");
        try {
            const imageUrl = await grokImageInputURL(references[0]);
            const size = normalizedImage.size && normalizedImage.size !== "auto" ? normalizedImage.size : undefined;
            const aspectRatio = size?.includes(":") ? size : undefined;
            const resolution = normalizeGrokImageResolution(normalizedImage.quality);
            const response = await postChannelJSON<ImageApiResponse>(
                requestConfig,
                aiApiUrl(requestConfig, "/images/edits"),
                {
                    model: requestConfig.model,
                    prompt: withSystemPrompt(requestConfig, requestPrompt),
                    image: { url: imageUrl },
                    n,
                    response_format: "url",
                    ...(size ? { size } : {}),
                    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
                    ...(resolution ? { resolution } : {}),
                },
                options,
            );
            return parseImagePayload(response);
        } catch (error) {
            throw new Error(readAxiosError(error, "Grok 图片编辑失败"));
        }
    }
    if (requestConfig.interfaceType === "volcengine-ark-image") {
        if (mask) throw new Error("火山方舟图片协议不支持蒙版编辑，请移除蒙版后重试");
        const quality = imageProfile.quality.supported && normalizedImage.quality !== "auto" ? normalizeQuality(normalizedImage.quality) || normalizedImage.quality : undefined;
        const sizeRequest = resolveImageRequestSize(imageProfile, quality, normalizedImage.size);
        const requestSize = sizeRequest?.parameter === "size" ? { ...sizeRequest, value: normalizeVolcengineArkImageSize(sizeRequest.value)! } : sizeRequest;
        try {
            const images = await Promise.all(references.map((image) => imageToDataUrl(image)));
            const response = await postVolcengineArkImage(
                requestConfig,
                {
                    model: requestConfig.model,
                    prompt: withSystemPrompt(requestConfig, requestPrompt),
                    n,
                    response_format: "b64_json",
                    watermark: false,
                    ...(requestSize ? { [requestSize.parameter]: requestSize.value } : {}),
                    ...(images.length === 1 ? { image: images[0] } : images.length > 1 ? { image: images } : {}),
                },
                options,
            );
            return parseImagePayload(response);
        } catch (error) {
            throw new Error(readAxiosError(error, "火山方舟图片生成失败"));
        }
    }
    const quality = imageProfile.quality.supported && normalizedImage.quality !== "auto" ? normalizeQuality(normalizedImage.quality) || normalizedImage.quality : undefined;
    const requestSize = resolveImageRequestSize(imageProfile, quality, normalizedImage.size);
    const formData = new FormData();
    formData.set("model", requestConfig.model);
    formData.set("prompt", withSystemPrompt(requestConfig, requestPrompt));
    formData.set("n", String(n));
    if (imageProfile.responseFormat.supported) formData.set("response_format", "b64_json");
    if (imageProfile.outputFormat.supported) formData.set("output_format", IMAGE_OUTPUT_FORMAT);
    if (imageProfile.transparentBackground.supported && normalizedImage.transparentBackground === "true") {
        formData.set("background", "transparent");
    }
    if (quality) {
        formData.set("quality", quality);
    }
    if (requestSize) {
        formData.set(requestSize.parameter, requestSize.value);
    }
    const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => formData.append("image", file));
    if (mask) formData.set("mask", dataUrlToFile(mask));

    try {
        const request = channelRequest(requestConfig, aiApiUrl(requestConfig, "/images/edits"), aiHeaders(requestConfig));
        const response = await axios.post<ImageApiResponse>(request.url, formData, { headers: request.headers, withCredentials: request.credentials === "include", signal: options?.signal });
        const images = parseImagePayload(response.data);
        return images;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    try {
        if (requestConfig.apiFormat === "gemini") {
            const answer = (await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages), onDelta, options)).content || "没有返回内容";
            if (answer === "没有返回内容") onDelta(answer);
            return answer;
        }
        if (requestConfig.interfaceType === "claude-api") {
            const answer = (await requestStreamingClaude(requestConfig, toClaudeBody(requestConfig, messages), onDelta, options)).content || "没有返回内容";
            if (answer === "没有返回内容") onDelta(answer);
            return answer;
        }
        if (requestConfig.interfaceType === "chat-completion" || !requestConfig.interfaceType) {
            const answer =
                (
                    await requestStreamingChatCompletion(
                        requestConfig,
                        {
                            model: requestConfig.model,
                            messages: toChatCompletionMessages(withSystemMessage(requestConfig, messages)),
                        },
                        onDelta,
                        options,
                    )
                ).content || "没有返回内容";
            if (answer === "没有返回内容") onDelta(answer);
            return answer;
        }
        const answer =
            (
                await requestStreamingResponse(
                    requestConfig,
                    {
                        model: requestConfig.model,
                        input: toResponseInput(withSystemMessage(requestConfig, messages)),
                    },
                    onDelta,
                    options,
                )
            ).content || "没有返回内容";
        if (answer === "没有返回内容") onDelta(answer);
        return answer;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function requestToolResponse(config: AiConfig, messages: ResponseInputMessage[], tools: ResponseFunctionTool[], toolChoice: ToolChoice = "auto", onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    try {
        if (requestConfig.apiFormat === "gemini") {
            return await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages, toGeminiToolOptions(tools, toolChoice)), onDelta, options);
        }
        if (requestConfig.interfaceType === "claude-api") return await requestStreamingClaude(requestConfig, toClaudeBody(requestConfig, messages, tools), onDelta, options);
        if (requestConfig.interfaceType === "chat-completion" || !requestConfig.interfaceType) {
            const chatPayload: Record<string, unknown> = {
                model: requestConfig.model,
                messages: toChatCompletionMessages(withSystemMessage(requestConfig, messages)),
                tools,
                tool_choice: toChatCompletionToolChoice(toolChoice),
                parallel_tool_calls: false,
            };
            try {
                return await requestStreamingChatCompletion(requestConfig, chatPayload, onDelta, options);
            } catch (error) {
                if (!isToolChoiceCompatibilityError(error)) throw error;

                // 部分 OpenAI 兼容上游仅支持 auto，思考模式则可能要求完全省略该字段。
                if (toolChoice !== "auto") {
                    try {
                        return await requestStreamingChatCompletion(requestConfig, { ...chatPayload, tool_choice: toChatCompletionToolChoice("auto") }, onDelta, options);
                    } catch (autoError) {
                        if (!isToolChoiceCompatibilityError(autoError)) throw autoError;
                    }
                }
                const { tool_choice: _ignored, ...withoutToolChoice } = chatPayload;
                void _ignored;
                return await requestStreamingChatCompletion(requestConfig, withoutToolChoice, onDelta, options);
            }
        }
        return await requestStreamingResponse(
            requestConfig,
            withOpenAIPromptCacheKey(
                {
                    model: requestConfig.model,
                    input: toResponseInput(withSystemMessage(requestConfig, messages)),
                    tools: tools.map(toResponseTool),
                    tool_choice: toolChoice,
                    parallel_tool_calls: false,
                },
                options?.promptCacheKey,
            ),
            onDelta,
            options,
        );
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export { fetchChannelModels, fetchImageModels } from "@/services/api/image-models";
export type { ChannelModelFetchResult } from "@/services/api/image-models";
