import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MediaTransportFields } from "@/pages/admin/components/media-transport-fields";
import { normalizeModelCapabilityConfig, defaultModelCapabilityConfig } from "@/lib/model-capabilities";

test("reference transport controls distinguish model inheritance and result format", () => {
    const channel = renderToStaticMarkup(<MediaTransportFields />);
    const model = renderToStaticMarkup(<MediaTransportFields channel={{ image: "url", audio: "base64" }} />);
    expect(channel).toContain("参考图片发送方式");
    expect(channel).toContain("参考音频发送方式");
    expect(channel).toContain("参考视频发送方式");
    expect(channel).toContain("不影响生成结果的返回格式");
    expect(model).toContain("跟随渠道（URL）");
    expect(model).toContain("跟随渠道（Base64）");
});

test("capability normalization retains independent overrides", () => {
    const config = { ...defaultModelCapabilityConfig("openai-image"), mediaTransport: { image: "base64" as const, audio: "protocol" as const, video: "inherit" as const } };
    expect(normalizeModelCapabilityConfig(config).mediaTransport).toEqual(config.mediaTransport);
});
