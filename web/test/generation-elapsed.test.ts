import { expect, test } from "bun:test";

import { formatTaskElapsed } from "@/lib/canvas/task-ticker";

const createdAt = "2026-10-19T10:00:00.000Z";
const startMs = Date.parse(createdAt);

test("运行中按实时 now 递增", () => {
    expect(formatTaskElapsed(createdAt, startMs + 30_000)).toBe("30秒");
    expect(formatTaskElapsed(createdAt, startMs + 90_000)).toBe("1分30秒");
    expect(formatTaskElapsed(createdAt, startMs + 68 * 60_000)).toBe("1时8分");
});

test("终态以 completedAt 冻结，不随 now 增长", () => {
    const completedAt = new Date(startMs + 68 * 60_000).toISOString();
    expect(formatTaskElapsed(createdAt, startMs + 68 * 60_000, completedAt)).toBe("1时8分");
    expect(formatTaskElapsed(createdAt, startMs + 600 * 60_000, completedAt)).toBe("1时8分");
});

test("completedAt 早于 createdAt 时不显示负值", () => {
    const completedAt = new Date(startMs - 5_000).toISOString();
    expect(formatTaskElapsed(createdAt, startMs, completedAt)).toBe("0秒");
});

test("缺少 createdAt 或时间戳无效时显示刚刚", () => {
    expect(formatTaskElapsed(undefined, startMs)).toBe("刚刚");
    expect(formatTaskElapsed("not-a-date", startMs)).toBe("刚刚");
    expect(formatTaskElapsed("not-a-date", startMs, "also-not-a-date")).toBe("刚刚");
});
