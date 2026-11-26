import { expect, test } from "bun:test";
import { assistantCallFields, assistantCallStatus, assistantCallTitle } from "../src/pages/admin/agent-access/assistant-call-presentation";

test("常见审批展示中文动作和真实参数，不把未知操作猜成已知业务", () => {
    expect(assistantCallTitle("AdminAdjustCredits")).toBe("调整用户积分");
    expect(assistantCallTitle("FutureAdminAction")).toBe("后台管理操作");
    expect(assistantCallStatus("pending")).toBe("等待确认");
    expect(assistantCallFields('{"userId":"user-a","req":{"credits":120,"reason":"活动奖励"}}')).toEqual([
        { label: "用户 ID", value: "user-a" },
        { label: "积分", value: "120" },
        { label: "原因", value: "活动奖励" },
    ]);
});

test("大整数不以舍入值出现在关键参数中，原始详情保留完整值", () => {
    expect(assistantCallFields('{"req":{"credits":9007199254740993}}')).toEqual([]);
});

test("无效预览和未知字段保留在完整参数详情，不伪造审批对象", () => {
    expect(assistantCallFields("invalid")).toEqual([]);
    expect(assistantCallFields("[]")).toEqual([]);
    expect(assistantCallFields('{"req":{"futureField":"secret object","enabled":false},"ids":["a","b"]}')).toEqual([
        { label: "是否启用", value: "否" },
        { label: "对象 ID 列表", value: '["a","b"]' },
    ]);
});
