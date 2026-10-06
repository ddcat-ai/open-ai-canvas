import { describe, expect, test } from "bun:test";

import { previsCameraSyncKey, previsGestureIdle, reducePrevisGesture } from "../src/lib/canvas/previs/previs-animation-semantics";
import { usePrevisWorkbenchStore } from "../src/stores/canvas/use-previs-workbench-store";
import type { PrevisKeyframe } from "../src/types/previs";

function camera(keyframes: PrevisKeyframe[] = []) {
    return {
        id: "cam-1",
        transform: { position: [4, 2, 6] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
        target: [0, 1, 0] as [number, number, number],
        fov: 50,
        near: 0.05,
        far: 500,
        keyframes,
    };
}

describe("手势状态机：恰好一次提交且总能释放 transforming", () => {
    test("start 进入手势并禁用 Orbit", () => {
        const started = reducePrevisGesture(previsGestureIdle, "start");
        expect(started).toEqual({ active: true, committed: false, transforming: true });
    });

    test("成功结束恰好提交一次", () => {
        const committed = reducePrevisGesture(reducePrevisGesture(previsGestureIdle, "start"), "commit");
        expect(committed).toEqual({ active: false, committed: true, transforming: false });
    });

    test("取消不提交，并且清掉 transforming", () => {
        const cancelled = reducePrevisGesture(reducePrevisGesture(previsGestureIdle, "start"), "cancel");
        expect(cancelled).toEqual({ active: false, committed: false, transforming: false });
    });

    test("终态后重复事件不会二次提交", () => {
        const committed = reducePrevisGesture(reducePrevisGesture(previsGestureIdle, "start"), "commit");
        expect(reducePrevisGesture(committed, "commit").committed).toBe(false);
        expect(reducePrevisGesture(committed, "cancel").committed).toBe(false);
    });

    test("未开始手势时的终态事件是安全的空操作", () => {
        expect(reducePrevisGesture(previsGestureIdle, "commit")).toEqual(previsGestureIdle);
        expect(reducePrevisGesture(previsGestureIdle, "cancel")).toEqual(previsGestureIdle);
    });

    test("任意终态路径都不会让 transforming 留在 true", () => {
        (["commit", "cancel"] as const).forEach((event) => {
            expect(reducePrevisGesture(reducePrevisGesture(previsGestureIdle, "start"), event).transforming).toBe(false);
        });
    });
});

describe("previsCameraSyncKey：暂停且无关键帧时不与用户 Orbit 抢夺", () => {
    test("暂停且无关键帧时播放头变化不改变同步键", () => {
        const first = previsCameraSyncKey({ camera: camera(), playhead: 0, playing: false });
        const second = previsCameraSyncKey({ camera: camera(), playhead: 2.5, playing: false });
        expect(first).toBe(second);
    });

    test("暂停但有关键帧时拖动播放头会驱动相机", () => {
        const keyframes = [{ id: "k0", time: 0, transform: camera().transform }];
        expect(previsCameraSyncKey({ camera: camera(keyframes), playhead: 0, playing: false })).not.toBe(previsCameraSyncKey({ camera: camera(keyframes), playhead: 1, playing: false }));
    });

    test("播放中始终跟随播放头", () => {
        expect(previsCameraSyncKey({ camera: camera(), playhead: 0, playing: true })).not.toBe(previsCameraSyncKey({ camera: camera(), playhead: 1, playing: true }));
    });

    test("相机静态属性变化会强制重新同步", () => {
        const aligned = { ...camera(), transform: { ...camera().transform, position: [9, 9, 9] as [number, number, number] } };
        expect(previsCameraSyncKey({ camera: aligned, playhead: 0, playing: false })).not.toBe(previsCameraSyncKey({ camera: camera(), playhead: 0, playing: false }));
    });

    test("没有相机时不写入", () => {
        expect(previsCameraSyncKey({ camera: null, playhead: 0, playing: true })).toBeNull();
    });

    test("同一 playhead 只改关键帧 transform，同步键必须变化（#3 回归）", () => {
        const before = [{ id: "k0", time: 0, transform: camera().transform }];
        const after = [{ id: "k0", time: 0, transform: { ...camera().transform, position: [1, 2, 3] as [number, number, number] } }];
        const beforeKey = previsCameraSyncKey({ camera: camera(before), playhead: 0, playing: false });
        const afterKey = previsCameraSyncKey({ camera: camera(after), playhead: 0, playing: false });
        expect(beforeKey).not.toBe(afterKey);
    });

    test("同一 playhead 改动区间外的关键帧不影响解算值时也保持稳定", () => {
        const keyframes = [{ id: "k0", time: 0, transform: camera().transform }];
        expect(previsCameraSyncKey({ camera: camera(keyframes), playhead: 0, playing: false })).toBe(previsCameraSyncKey({ camera: camera(keyframes), playhead: 0, playing: false }));
    });

    test("同一 playhead 新增关键帧改变解算结果时同步键变化", () => {
        const single = [{ id: "k0", time: 0, transform: camera().transform }];
        const pair = [...single, { id: "k1", time: 2, transform: { ...camera().transform, position: [8, 8, 8] as [number, number, number] } }];
        expect(previsCameraSyncKey({ camera: camera(single), playhead: 1, playing: false })).not.toBe(previsCameraSyncKey({ camera: camera(pair), playhead: 1, playing: false }));
    });
});

describe("预演台会话状态：Auto Key 默认关闭", () => {
    test("初始状态与 reset 后都为关闭", () => {
        expect(usePrevisWorkbenchStore.getState().autoKey).toBe(false);
        usePrevisWorkbenchStore.getState().setAutoKey(true);
        expect(usePrevisWorkbenchStore.getState().autoKey).toBe(true);
        usePrevisWorkbenchStore.getState().reset();
        expect(usePrevisWorkbenchStore.getState().autoKey).toBe(false);
    });
});
