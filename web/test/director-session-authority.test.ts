import { describe, expect, test } from "bun:test";

import { createDirectorTransaction } from "../src/lib/canvas/director/director-gesture-transaction";
import { shouldReinitializeDirectorSession, upsertDirectorSceneById } from "../src/lib/canvas/director/director-session";
import { createDirectorScene } from "../src/lib/canvas/director/director-scene";
import type { DirectorScene } from "../src/types/director";

function scene(id: string, title = id): DirectorScene {
    return { ...createDirectorScene(title), id };
}

describe("会话初始化判定：只认 scene id（A1 回归）", () => {
    test("首次挂载会初始化", () => {
        expect(shouldReinitializeDirectorSession({ initializedSceneId: null, nextSceneId: "s1" })).toBe(true);
    });

    test("同 id 的父级镜像回流不重建会话", () => {
        expect(shouldReinitializeDirectorSession({ initializedSceneId: "s1", nextSceneId: "s1" })).toBe(false);
    });

    test("切换到不同 scene id 才重建", () => {
        expect(shouldReinitializeDirectorSession({ initializedSceneId: "s1", nextSceneId: "s2" })).toBe(true);
    });

    test("没有 scene 时不初始化", () => {
        expect(shouldReinitializeDirectorSession({ initializedSceneId: "s1", nextSceneId: null })).toBe(false);
        expect(shouldReinitializeDirectorSession({ initializedSceneId: null, nextSceneId: null })).toBe(false);
    });

    test("镜像回流序列中只有 id 变化的那一次会重建", () => {
        let initialized: string | null = null;
        const rebuilds: string[] = [];
        ["s1", "s1", "s1", "s2", "s2"].forEach((nextSceneId) => {
            if (!shouldReinitializeDirectorSession({ initializedSceneId: initialized, nextSceneId })) return;
            initialized = nextSceneId;
            rebuilds.push(nextSceneId);
        });
        expect(rebuilds).toEqual(["s1", "s2"]);
    });
});

describe("upsertDirectorSceneById：连续保存不丢 scene（A6 回归）", () => {
    test("连续保存 A/B 后两者都在", () => {
        const a = scene("a");
        const b = scene("b");
        const afterA = upsertDirectorSceneById([], a);
        const afterB = upsertDirectorSceneById(afterA, b);
        expect(afterB.map((item) => item.id)).toEqual(["a", "b"]);
    });

    test("同 id 是替换而不是追加", () => {
        const first = scene("a", "旧标题");
        const second = { ...first, title: "新标题" };
        const next = upsertDirectorSceneById([first], second);
        expect(next).toHaveLength(1);
        expect(next[0].title).toBe("新标题");
    });

    test("替换时不影响其他 scene 的顺序与内容", () => {
        const list = [scene("a"), scene("b"), scene("c")];
        const next = upsertDirectorSceneById(list, { ...list[1], title: "改过的 b" });
        expect(next.map((item) => item.id)).toEqual(["a", "b", "c"]);
        expect(next[0]).toBe(list[0]);
        expect(next[2]).toBe(list[2]);
        expect(next[1].title).toBe("改过的 b");
    });

    test("以最新数组为基准的连续保存不会用旧快照覆盖", () => {
        // 模拟缺陷：第二次保存若以「第一次之前的数组」为基准，就会丢掉 a。
        const a = scene("a");
        const b = scene("b");
        const stale: DirectorScene[] = [];
        const authoritative = upsertDirectorSceneById(stale, a);
        expect(upsertDirectorSceneById(stale, b).map((item) => item.id)).toEqual(["b"]);
        expect(upsertDirectorSceneById(authoritative, b).map((item) => item.id)).toEqual(["a", "b"]);
    });
});

describe("预览与持久变更的发布边界（A2/A3/A4 回归）", () => {
    /** 最小 session controller：与 workbench 的接线同构，但不依赖 React 挂载。 */
    function harness(initial: DirectorScene) {
        const published: DirectorScene[] = [];
        const history: DirectorScene[] = [];
        const flushes: number[] = [];
        let draft = initial;
        const publish = () => published.push(draft);
        const staged = createDirectorTransaction<DirectorScene>({
            read: () => draft,
            restore: (snapshot) => {
                draft = snapshot;
            },
            commit: (from) => {
                history.push(from);
                publish();
            },
            setActive: () => undefined,
        });
        return {
            published,
            history,
            current: () => draft,
            /** 普通持久提交：先终结暂存手势，再发布。 */
            commit: (next: DirectorScene) => {
                staged.end("commit");
                history.push(draft);
                draft = next;
                publish();
            },
            /** 进行中预览：写草稿但不发布。 */
            stage: (next: DirectorScene) => {
                staged.begin();
                draft = next;
            },
            settle: () => staged.end("commit"),
            cancel: () => staged.end("cancel"),
            close: () => {
                staged.end("cancel");
                publish();
            },
            /** pagehide：active 由 commit 自己 publish，idle 才显式 publish，最后 flush。 */
            pagehide: () => {
                if (staged.active()) staged.end("commit");
                else publish();
                flushes.push(published.length);
            },
            flushes,
        };
    }

    test("进行中预览不发布，成功终态只发布一次", () => {
        const base = scene("s1", "起点");
        const session = harness(base);
        session.stage({ ...base, title: "拖动中 1" });
        session.stage({ ...base, title: "拖动中 2" });
        expect(session.published).toHaveLength(0);
        session.settle();
        expect(session.published).toHaveLength(1);
        expect(session.published[0].title).toBe("拖动中 2");
    });

    test("取消的预览值绝不进入已发布 canonical", () => {
        const base = scene("s1", "起点");
        const session = harness(base);
        session.stage({ ...base, title: "会被取消" });
        session.cancel();
        expect(session.published).toHaveLength(0);
        expect(session.current().title).toBe("起点");
        // 后续关闭发布的是恢复后的值。
        session.close();
        expect(session.published.map((item) => item.title)).toEqual(["起点"]);
    });

    test("关闭前先取消未结束预览，再发布恢复后的 draft", () => {
        const base = scene("s1", "起点");
        const session = harness(base);
        session.stage({ ...base, title: "未结束" });
        session.close();
        expect(session.published).toHaveLength(1);
        expect(session.published[0].title).toBe("起点");
    });

    test("普通提交前终结暂存手势，两段变更各自发布且历史不串", () => {
        const base = scene("s1", "起点");
        const session = harness(base);
        session.stage({ ...base, title: "滑杆中" });
        session.commit({ ...base, title: "另一个动作" });
        expect(session.published.map((item) => item.title)).toEqual(["滑杆中", "另一个动作"]);
        expect(session.history).toHaveLength(2);
    });

    test("离开页面且预览进行中：只发布一次（#6 回归）", () => {
        const base = scene("s1", "起点");
        const session = harness(base);
        session.stage({ ...base, title: "离开前未结算" });
        session.pagehide();
        // 缺陷版本会 commit publish 一次 + 无条件 publishDraft 再一次。
        expect(session.published).toHaveLength(1);
        expect(session.published[0].title).toBe("离开前未结算");
        // flush 必须发生在发布之后，否则会把旧快照写盘。
        expect(session.flushes).toEqual([1]);
    });

    test("离开页面且无进行中预览：显式发布一次", () => {
        const base = scene("s1", "起点");
        const session = harness(base);
        session.pagehide();
        expect(session.published).toHaveLength(1);
        expect(session.flushes).toEqual([1]);
    });

    test("离开页面后再次 pagehide 不会重复结算同一手势", () => {
        const base = scene("s1", "起点");
        const session = harness(base);
        session.stage({ ...base, title: "一次拖动" });
        session.pagehide();
        session.pagehide();
        // 第二次是 idle 分支：显式发布当前 canonical，仍然各自恰好一次。
        expect(session.published.map((item) => item.title)).toEqual(["一次拖动", "一次拖动"]);
        expect(session.history).toHaveLength(1);
        expect(session.flushes).toEqual([1, 2]);
    });
});
