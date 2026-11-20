import { afterEach, expect, test } from "bun:test";
import axios from "axios";

import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { createVideoGenerationTask } from "../src/services/api/video";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot } from "../src/stores/use-config-store";

const originalRequest = axios.request;
afterEach(() => {
    axios.request = originalRequest;
});

test("explicit newapi uses multipart for Seedance, preserves nine references and keeps the single-image field", async () => {
    const model = "seedance-2-5-flash-request-line-n";
    const capabilityConfig = defaultModelCapabilityConfig("newapi", model);
    expect(capabilityConfig.video!.references.maxImages).toBe(1);
    capabilityConfig.video!.references.maxImages = 9;
    capabilityConfig.video!.operations.push("reference_to_video");
    const channel = createModelChannel({
        id: "video",
        name: "Video",
        baseUrl: "https://video.example.com/v1",
        apiKey: "test",
        apiFormat: "openai",
        interfaceType: "newapi",
        models: [model],
        modelCosts: [{ model, capability: "video", protocol: "newapi", billingMode: "per_second", unitPriceMicrocredits: 1, capabilityConfig }],
    });
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], model: `video::${model}`, videoModel: `video::${model}`, videoSeconds: "5", size: "16:9", vquality: "720p" } }).config;
    const bodies: FormData[] = [];
    axios.request = (async (request) => {
        expect(request.data).toBeInstanceOf(FormData);
        bodies.push(request.data);
        return { data: { id: "video-id" } };
    }) as typeof axios.request;
    const images = Array.from({ length: 9 }, (_, index) => ({ id: `asset-${index}`, name: `${index}.png`, type: "image/png", dataUrl: "data:image/png;base64,YQ==" }));
    await createVideoGenerationTask(config, "参考图9", images, [], [], { videoEditOperation: "reference_to_video" });
    expect(bodies[0].getAll("input_reference[]").map((part) => (part as File).name)).toEqual(images.map((image) => image.name));
    await createVideoGenerationTask(config, "首帧", images.slice(0, 1));
    expect((bodies[1].get("input_reference") as File).name).toBe("0.png");
    await expect(createVideoGenerationTask(config, "首帧", images)).rejects.toThrow("最多发送 1 张图片");
    expect(bodies).toHaveLength(2);
});
