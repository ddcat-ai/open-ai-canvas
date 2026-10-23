import { describe, expect, test } from "bun:test";
import { resolveCloudAgentModel } from "@/lib/canvas/cloud-agent-model-restore";

describe("工作区会话模型恢复", () => {
    test("完整模型option优先，裸key只恢复唯一可用文本渠道", () => {
        const options = ["paid-channel::paid-model", "local-test::local-agent-test"];
        expect(resolveCloudAgentModel("local-test::local-agent-test", options)).toEqual({ model: "local-test::local-agent-test" });
        expect(resolveCloudAgentModel("local-agent-test", options)).toEqual({ model: "local-test::local-agent-test" });
    });
    test("同key多个渠道不能选择第一个或跳到其他收费模型", () => {
        const options = ["paid-channel::paid-model", "channel-a::shared-model", "channel-b::shared-model"];
        expect(resolveCloudAgentModel("shared-model", options)).toEqual({ model: "", problem: "ambiguous" });
        expect(resolveCloudAgentModel("channel-b::shared-model", options)).toEqual({ model: "channel-b::shared-model" });
    });
    test("模型不可用或完整旧路由已移除时不自动换渠道", () => {
        expect(resolveCloudAgentModel("missing", ["paid::model"])).toEqual({ model: "", problem: "unavailable" });
        expect(resolveCloudAgentModel("old-channel::shared", ["new-channel::shared"])).toEqual({ model: "", problem: "unavailable" });
    });
});
