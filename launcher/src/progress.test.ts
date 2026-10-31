import { expect, test } from "bun:test";
import { pollOperationProgress, progressPercent, type OperationProgress } from "./bridge";

const progress = { stage: "下载源码", percent: 42, message: "正在下载" };
test("真实进度显示百分比，未知进度不伪造百分比", () => {
  expect(progressPercent(progress)).toBe(42);
  expect(progressPercent({ ...progress, percent: 120 })).toBe(100);
  for (const percent of [0, -1, NaN, Infinity]) expect(progressPercent({ ...progress, percent })).toBeUndefined();
  expect(progressPercent(null)).toBeUndefined();
});
test("进度轮询立即读取独立接口，停止后丢弃尚未返回的数据", async () => {
  let resolve!: (value: OperationProgress | null) => void;
  let calls = 0;
  const received: unknown[] = [];
  const stop = pollOperationProgress(() => { calls++; return new Promise((done) => { resolve = done; }); }, (value) => received.push(value), (error) => received.push(error), 1);
  expect(calls).toBe(1);
  stop();
  resolve(progress);
  await Bun.sleep(10);
  expect(received).toEqual([]);
  expect(calls).toBe(1);
});
test("进度查询失败可恢复且不重叠，退出后不继续轮询", async () => {
  let calls = 0;
  const errors: unknown[] = [];
  const received: unknown[] = [];
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const stop = pollOperationProgress(async () => {
    calls++;
    if (calls === 1) throw new Error("读取失败");
    return progress;
  }, (value) => { received.push(value); finish(); }, (error) => errors.push(error), 1);
  await done;
  stop();
  await Bun.sleep(10);
  expect(errors).toHaveLength(1);
  expect(received).toEqual([progress]);
  expect(calls).toBe(2);
});
test("退出后查询异常不触发错误回调", async () => {
  let reject!: (reason: Error) => void;
  let errors = 0;
  const stop = pollOperationProgress(() => new Promise((_, fail) => { reject = fail; }), () => {}, () => { errors++; }, 1);
  stop();
  reject(new Error("晚到的异常"));
  await Bun.sleep(10);
  expect(errors).toBe(0);
});
