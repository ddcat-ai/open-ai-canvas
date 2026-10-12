import { expect, test } from "bun:test";

import { creationRecordRange, removeCreationRecord } from "../src/pages/create/creation-conversations";
import type { CreationMessage } from "../src/pages/create/creation-types";

function message(id: string, role: CreationMessage["role"], extra: Partial<CreationMessage> = {}): CreationMessage {
    return { id, role, content: id, createdAt: "2026-10-12T00:00:00.000Z", ...extra };
}

// 三条记录：视频失败、文本完成、视频失败。
const records: CreationMessage[] = [
    message("u1", "user", { mode: "video" }),
    message("a1", "assistant", { mode: "video", status: "error" }),
    message("u2", "user", { mode: "text" }),
    message("a2", "assistant", { mode: "text", status: "done" }),
    message("u3", "user", { mode: "video" }),
    message("a3", "assistant", { mode: "video", status: "error" }),
];

test("记录范围覆盖用户提示与其后的结果消息", () => {
    expect(creationRecordRange(records, "u2")).toEqual({ start: 2, end: 4 });
});

test("从结果消息反查也落在同一条记录上", () => {
    expect(creationRecordRange(records, "a2")).toEqual({ start: 2, end: 4 });
});

test("删除记录只移除该记录的提示词与结果，不牵连相邻记录", () => {
    const trimmed = removeCreationRecord(records, "a2");
    expect(trimmed?.removed.map((item) => item.id)).toEqual(["u2", "a2"]);
    expect(trimmed?.messages.map((item) => item.id)).toEqual(["u1", "a1", "u3", "a3"]);
});

test("删除末尾记录不影响前面的记录", () => {
    const trimmed = removeCreationRecord(records, "u3");
    expect(trimmed?.messages.map((item) => item.id)).toEqual(["u1", "a1", "u2", "a2"]);
});

test("未知 id 不产生删除结果", () => {
    expect(creationRecordRange(records, "missing")).toBeNull();
    expect(removeCreationRecord(records, "missing")).toBeNull();
});

test("结果消息前没有用户提示时只删除它自己", () => {
    const orphan: CreationMessage[] = [
        message("a0", "assistant", { mode: "video", status: "error" }),
        message("u1", "user", { mode: "video" }),
        message("a1", "assistant", { mode: "video", status: "error" }),
    ];
    expect(removeCreationRecord(orphan, "a0")?.messages.map((item) => item.id)).toEqual(["u1", "a1"]);
});

test("删除唯一记录得到空消息列表", () => {
    const single: CreationMessage[] = [message("u1", "user", { mode: "video" }), message("a1", "assistant", { mode: "video", status: "done" })];
    expect(removeCreationRecord(single, "u1")?.messages).toEqual([]);
});
