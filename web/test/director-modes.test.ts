import { beforeEach, describe, expect, test } from "bun:test";

import { DIRECTOR_DEFAULT_MODE, DIRECTOR_MODES, directorModeCapabilities, resolveDirectorModeTransition, type DirectorMode } from "../src/lib/canvas/director/director-modes";
import { createDirectorScene } from "../src/lib/canvas/director/director-scene";
import { createDirectorSceneFromTemplate } from "../src/lib/canvas/director/director-templates";
import { useDirectorWorkbenchStore } from "../src/stores/canvas/use-director-workbench-store";

const ALL_MODES: DirectorMode[] = ["layout", "pose", "animate", "camera"];

describe("四模式骨架", () => {
    test("恰好四个一级模式，顺序为摆场/姿态/动画/摄影机", () => {
        expect(DIRECTOR_MODES.map((item) => item.mode)).toEqual(ALL_MODES);
        expect(DIRECTOR_MODES.map((item) => item.label)).toEqual(["摆场", "姿态", "动画", "摄影机"]);
    });

    test("默认模式是摆场", () => {
        expect(DIRECTOR_DEFAULT_MODE).toBe("layout");
        expect(useDirectorWorkbenchStore.getState().mode).toBe("layout");
    });

    test("每个模式都有可读标签与提示，保证可发现", () => {
        for (const item of DIRECTOR_MODES) {
            expect(item.label.length).toBeGreaterThan(0);
            expect(item.hint.length).toBeGreaterThan(0);
        }
    });
});

describe("能力矩阵", () => {
    test("只有动画模式显示时间轴、允许关键帧与 Auto Key", () => {
        for (const mode of ALL_MODES) {
            const capabilities = directorModeCapabilities(mode);
            expect(capabilities.timeline).toBe(mode === "animate");
            expect(capabilities.keyframes).toBe(mode === "animate");
        }
    });

    test("摆场隐藏骨骼；姿态与动画显示骨骼", () => {
        expect(directorModeCapabilities("layout").bones).toBe(false);
        expect(directorModeCapabilities("camera").bones).toBe(false);
        expect(directorModeCapabilities("pose").bones).toBe(true);
        expect(directorModeCapabilities("animate").bones).toBe(true);
    });

    test("只有摄影机模式突出 shot/camera 工具", () => {
        for (const mode of ALL_MODES) {
            expect(directorModeCapabilities(mode).cameraTools).toBe(mode === "camera");
        }
    });

    test("摆场不提供深度/法线等高级视图；摄影机模式才提供", () => {
        expect(directorModeCapabilities("layout").renderModes).toEqual(["beauty", "clay"]);
        expect(directorModeCapabilities("layout").renderModes).not.toContain("depth");
        expect(directorModeCapabilities("layout").renderModes).not.toContain("pose");
        expect(directorModeCapabilities("camera").renderModes).toContain("depth");
        expect(directorModeCapabilities("camera").renderModes).toContain("normal");
    });

    test("姿态模式提供骨骼视图", () => {
        expect(directorModeCapabilities("pose").renderModes).toContain("pose");
    });

    test("未知模式回落到默认模式的能力，不返回 undefined", () => {
        expect(directorModeCapabilities("nope" as DirectorMode)).toEqual(directorModeCapabilities("layout"));
    });
});

describe("切换清理：离开动画不得残留后台动画写入", () => {
    test("离开动画模式一定停播并关掉 Auto Key", () => {
        for (const mode of ["layout", "pose", "camera"] as DirectorMode[]) {
            const next = resolveDirectorModeTransition({ mode, playing: true, autoKey: true, renderMode: "beauty" });
            expect(next.playing).toBe(false);
            expect(next.autoKey).toBe(false);
        }
    });

    test("留在动画模式时保留播放与 Auto Key", () => {
        const next = resolveDirectorModeTransition({ mode: "animate", playing: true, autoKey: true, renderMode: "beauty" });
        expect(next.playing).toBe(true);
        expect(next.autoKey).toBe(true);
    });

    test("renderMode 被夹回目标模式允许的集合", () => {
        // 摄影机模式的深度视图不能带进摆场。
        expect(resolveDirectorModeTransition({ mode: "layout", playing: false, autoKey: false, renderMode: "depth" }).renderMode).toBe("beauty");
        // 姿态模式的骨骼视图同样不属于摆场。
        expect(resolveDirectorModeTransition({ mode: "layout", playing: false, autoKey: false, renderMode: "pose" }).renderMode).toBe("beauty");
        // 合法组合保持不变。
        expect(resolveDirectorModeTransition({ mode: "camera", playing: false, autoKey: false, renderMode: "normal" }).renderMode).toBe("normal");
        expect(resolveDirectorModeTransition({ mode: "layout", playing: false, autoKey: false, renderMode: "clay" }).renderMode).toBe("clay");
    });
});

describe("store 的 setMode", () => {
    beforeEach(() => {
        useDirectorWorkbenchStore.getState().reset();
    });

    test("切到动画再切回摆场：playing 与 autoKey 都被清掉", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().setMode("animate");
        store.getState().setPlaying(true);
        store.getState().setAutoKey(true);
        expect(store.getState().playing).toBe(true);
        expect(store.getState().autoKey).toBe(true);

        store.getState().setMode("layout");
        expect(store.getState().mode).toBe("layout");
        expect(store.getState().playing).toBe(false);
        expect(store.getState().autoKey).toBe(false);
    });

    test("切模式不影响选择状态：draft 归属由 workbench 自己管", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().setSelectedObjectId("obj-1");
        store.getState().setMode("camera");
        expect(store.getState().selectedObjectId).toBe("obj-1");
        store.getState().setMode("pose");
        expect(store.getState().selectedObjectId).toBe("obj-1");
    });

    test("切模式不重置 playhead：时间位置不因为换视图而丢", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().setMode("animate");
        store.getState().setPlayhead(2.5);
        store.getState().setMode("pose");
        expect(store.getState().playhead).toBe(2.5);
    });

    test("reset 回到默认摆场", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().setMode("animate");
        store.getState().reset();
        expect(store.getState().mode).toBe("layout");
    });

    test("摆场模式拒绝 pose/depth/normal，只接受 beauty/clay", () => {
        const store = useDirectorWorkbenchStore;
        expect(store.getState().mode).toBe("layout");

        store.getState().setRenderMode("clay");
        expect(store.getState().renderMode).toBe("clay");

        // 这三个不属于摆场：必须被拒绝，且不得把已有选择冲掉。
        for (const rejected of ["pose", "depth", "normal"] as const) {
            store.getState().setRenderMode(rejected);
            expect(store.getState().renderMode).toBe("clay");
        }
    });

    test("dock 的「骨骼视图」在摆场模式点了也无效：store 层夹住了所有路径", () => {
        const store = useDirectorWorkbenchStore;
        // dock 按钮等价于直接调 setRenderMode("pose")。
        store.getState().setRenderMode("pose");
        expect(store.getState().renderMode).toBe("beauty");
    });

    test("摄影机模式才接受 depth/normal", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().setMode("camera");
        store.getState().setRenderMode("depth");
        expect(store.getState().renderMode).toBe("depth");
        store.getState().setRenderMode("normal");
        expect(store.getState().renderMode).toBe("normal");
    });

    test("姿态模式接受骨骼视图，但仍拒绝深度视图", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().setMode("pose");
        store.getState().setRenderMode("pose");
        expect(store.getState().renderMode).toBe("pose");
        store.getState().setRenderMode("depth");
        expect(store.getState().renderMode).toBe("pose");
    });

    test("带着深度视图离开摄影机模式会被夹回 beauty，不残留非法组合", () => {
        const store = useDirectorWorkbenchStore;
        store.getState().setMode("camera");
        store.getState().setRenderMode("depth");
        expect(store.getState().renderMode).toBe("depth");

        store.getState().setMode("layout");
        expect(store.getState().renderMode).toBe("beauty");
    });
});

describe("mode 不进 DirectorScene schema", () => {
    test("兼容 factory 与模板生成的场景都没有 mode 字段", () => {
        expect(Object.keys(createDirectorScene("s"))).not.toContain("mode");
        expect(Object.keys(createDirectorSceneFromTemplate("dialogue"))).not.toContain("mode");
    });

    test("切模式不产生任何场景对象：mode 纯属工作台 UI 状态", () => {
        const store = useDirectorWorkbenchStore;
        const before = createDirectorSceneFromTemplate("monologue");
        const snapshot = JSON.stringify(before);
        store.getState().setMode("animate");
        store.getState().setMode("layout");
        expect(JSON.stringify(before)).toBe(snapshot);
    });
});
