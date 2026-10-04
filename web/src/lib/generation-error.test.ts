import assert from "node:assert/strict";
import test from "node:test";
import { generationErrorMessage } from "./generation-error";

test("把模型能力错误转换成用户可执行的提示", () => {
    assert.equal(generationErrorMessage({ reason: "model_capability_not_supported", message: "所选模型不支持当前请求：不支持操作 reference_to_video" }), "所选模型不支持当前生成方式或输入，请切换模型或调整输入后重试。");
});

test("按稳定 reason 显示积分不足和渠道不可用", () => {
    assert.equal(generationErrorMessage({ reason: "quota_exceeded", message: "余额不足" }), "积分或额度不足，请充值后再试。");
    assert.equal(generationErrorMessage({ reason: "model_route_unavailable", message: "没有可用供应线路" }), "当前模型暂时没有可用渠道，请稍后重试或换用其他模型。");
});

test("不把供应商内部英文错误原样展示", () => {
    assert.equal(generationErrorMessage("provider request failed: invalid_request_error"), "模型服务处理失败，请稍后重试或换用其他模型。");
    assert.equal(generationErrorMessage("图片尺寸不支持"), "图片尺寸不支持");
});

test("保留安全的上游原因并归一化基础设施错误", () => {
    assert.equal(generationErrorMessage("模型服务暂时不可用（HTTP 500）；上游：Upstream gateway error"), "模型服务暂时不可用（HTTP 500）；上游：Upstream gateway error");
    assert.equal(generationErrorMessage("HTTP 502 Bad Gateway"), "网络异常。");
    assert.equal(generationErrorMessage("HTTP 429"), "服务当前繁忙，请稍后重试。");
});