import { describe, expect, test } from "bun:test";
import { generationErrorMessage, redactUpstreamAddress } from "../src/lib/generation-error";

describe("upstream address redaction", () => {
    test("hides the upstream host but keeps the failure cause", () => {
        const raw = `Post "https://www.kccai.ai/v1/images/generations": http2: server sent GOAWAY and closed the connection`;
        expect(redactUpstreamAddress(raw)).toBe(`Post "[链接已隐藏]": http2: server sent GOAWAY and closed the connection`);
    });

    test("hides network operation addresses", () => {
        expect(redactUpstreamAddress("调用上游失败：dial tcp 10.12.0.7:443: connect: connection refused")).toBe(
            "调用上游失败：dial tcp [地址已隐藏]: connect: connection refused",
        );
    });

    test("redaction helper keeps non-address text for diagnostics", () => {
        const note = `模型服务暂时不可用（HTTP 503）；上游：execution mode "sync" is not supported`;
        expect(redactUpstreamAddress(note)).toBe(note);
    });

    test("user message removes upstream tail and task id", () => {
        const message = generationErrorMessage("任务失败（任务 task_abc123）；上游：https://private.test");
        expect(message).not.toContain("task_abc123");
        expect(message).not.toContain("上游");
        expect(message).not.toContain("private.test");
    });

    test("canvas failure text never renders the upstream host", () => {
        const message = generationErrorMessage(`Post "https://www.kccai.ai/v1/images/generations": http2: server sent GOAWAY`);
        expect(message).not.toContain("kccai.ai");
    });
});
