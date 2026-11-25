import { describe, expect, test } from "bun:test";
import {
    newRequestProtocol,
    nextProtocolVersion,
    parseProtocolManifest,
    protocolExampleRequest,
    protocolExampleResponse,
    requestExpressionSource,
    requestSourceExpression,
    responseExpressionPaths,
    responsePathExpression,
    shortReleaseDigest,
    updateProtocolProvider,
} from "@/pages/admin/request-protocols/protocol-form";

describe("后台请求协议配置", () => {
    test("参考素材发送地址列表，保留高级表达式", () => {
        const expression = requestSourceExpression("images");
        expect(expression).toEqual({ $omitEmpty: { $map: { from: { $ref: "request.images" }, as: "media", in: { $ref: "media.value" } } } });
        expect(requestExpressionSource(expression)).toBe("images");
        expect(requestExpressionSource({ $merge: [{ custom: true }] })).toBe("advanced");
    });

    test("嵌套作品地址可配置多个候选路径", () => {
        const value = responsePathExpression("data.data.video_url，video_url");
        expect(value).toEqual({ $coalesce: [{ $ref: "response.data.data.video_url" }, { $ref: "response.video_url" }] });
        expect(responseExpressionPaths(value)).toBe("data.data.video_url, video_url");
        expect(responseExpressionPaths({ $map: { from: { $ref: "response.data" } } })).toBeNull();
    });

    test("表单修改接口时保留未知字段、鉴权、权限和结果规则", () => {
        const manifest = newRequestProtocol();
        expect(manifest.permissions).toEqual(["generation.run", "media.read"]);
        const provider = manifest.contributes.providers[0];
        provider.create.headers = { Accept: "application/json" };
        provider.create.query = { version: "v2" };
        const changed = updateProtocolProvider(manifest, { create: { ...provider.create, path: "/v1/video/generations" } });
        expect(changed.permissions).toEqual(["generation.run", "media.read"]);
        expect(changed.contributes.providers[0].create.query).toEqual({ version: "v2" });
        expect(changed.contributes.providers[0].response).toEqual(provider.response);
        expect(manifest.contributes.providers[0].create.path).toBe("/v1/tasks");
    });

    test("高级 JSON 只接受一个请求定义，避免表单丢弃其他定义", () => {
        const manifest = newRequestProtocol();
        expect(parseProtocolManifest(JSON.stringify(manifest)).contributes.providers).toHaveLength(1);
        manifest.contributes.providers.push(manifest.contributes.providers[0]);
        expect(() => parseProtocolManifest(JSON.stringify(manifest))).toThrow();
    });

    test("示例数据表达统一字段，不携带真实凭据", () => {
        expect(protocolExampleRequest()).toMatchObject({ output: { duration: 10, aspectRatio: "16:9" }, images: [{ url: "https://example.com/reference.png" }] });
        expect(protocolExampleResponse("video")).toMatchObject({ status: "succeeded", video_url: "https://example.com/result.mp4" });
        expect(protocolExampleResponse("image")).toMatchObject({ image_url: "https://example.com/result.png" });
        expect(protocolExampleResponse("audio")).toMatchObject({ audio_url: "https://example.com/result.mp3" });
        expect(protocolExampleResponse("text")).toMatchObject({ text: "示例文本" });
    });

    test("版本号按归档发行版主版本号递增并展示摘要前缀", () => {
        expect(nextProtocolVersion()).toBe("1.0.0");
        expect(nextProtocolVersion([])).toBe("1.0.0");
        expect(nextProtocolVersion([{ version: "1.0.0" }])).toBe("2.0.0");
        expect(nextProtocolVersion([{ version: "2.1.0" }, { version: "1.0.0" }])).toBe("3.0.0");
        expect(shortReleaseDigest("abcdef0123456789abcdef")).toBe("abcdef012345");
        expect(shortReleaseDigest("")).toBe("");
    });

    test("空路径不会写入无效引用，复杂解析仍走高级模式", () => {
        expect(responsePathExpression("  ")).toBeUndefined();
        expect(responseExpressionPaths(undefined)).toBe("");
        expect(responseExpressionPaths("固定文本")).toBeNull();
        expect(responseExpressionPaths({ $coalesce: [{ $ref: "response.url" }, { $map: {} }] })).toBeNull();
        expect(requestSourceExpression("output.duration")).toEqual({ $ref: "request.output.duration" });
    });

    test("高级 JSON 拒绝缺少请求或响应的结构", () => {
        for (const value of [null, {}, { ...newRequestProtocol(), contributes: { providers: [{}] } }]) {
            expect(() => parseProtocolManifest(JSON.stringify(value))).toThrow();
        }
    });
});
