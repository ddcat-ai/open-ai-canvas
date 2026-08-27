import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 生产接线回归：领域函数正确不代表用户能删到关键帧。
 * 这里锁住「时间轴入口 -> workbench -> 领域函数」这条链路真的接上了。
 */
const dock = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/director-viewport-dock.tsx"), "utf8");
const workbench = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/canvas-director-workbench.tsx"), "utf8");
const sequencer = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/director-sequencer.tsx"), "utf8");
const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

function slice(source: string, from: string, to: string) {
    const start = source.indexOf(from);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(to, start + from.length);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe("workbench 接入时间轴关键帧删除", () => {
    test("DirectorSequencer 拿到的是 deleteKeyframe，而不是空实现", () => {
        const element = slice(workbench, "<DirectorSequencer", "/>");
        expect(element).toContain("onDeleteKeyframe={deleteKeyframe}");
        expect(element).not.toContain("onDeleteKeyframe={() =>");
    });

    test("缓动更新通过 workbench commit 接入，未命中不制造历史", () => {
        const element = slice(workbench, "<DirectorSequencer", "/>");
        expect(element).toContain("onSetKeyframeEasing={setKeyframeEasing}");
        const handler = slice(workbench, "const setKeyframeEasing = useCallback", "* 快捷键执行器");
        expect(handler).toContain("setDirectorSceneKeyframeEasing(current, target, easing) === current");
        expect(handler).toContain("commit((scene) => setDirectorSceneKeyframeEasing(scene, target, easing));");
    });

    test("deleteKeyframe 未命中时不进 commit：不记历史、不产生修订", () => {
        const handler = slice(workbench, "const deleteKeyframe = useCallback", "* 快捷键执行器");
        expect(handler).toContain("removeDirectorSceneKeyframe(current, target) === current) return;");
        expect(handler).toContain("commit((scene) => removeDirectorSceneKeyframe(scene, target));");
    });

    test("删除走 commit，因此进历史、可撤销、并触发 canonical 保存", () => {
        // commit 自身的语义：入历史 + writeAndPublish（coordinator 保存 + 镜像项目）。
        const commit = slice(workbench, "const commit = useCallback", "/** 暂存型手势");
        expect(commit).toContain("setHistory((items) => [...items.slice(-49), structuredClone(current)]);");
        expect(commit).toContain("writeAndPublish(touchDirectorScene(updater(current)));");
    });
});

describe("workbench 快捷键接线", () => {
    const effect = slice(workbench, "// 导演台是全屏浮层，快捷键挂在 window", "/** 对象 transform 编辑的唯一入口");

    test("监听挂在 window keydown，并随 open 装卸", () => {
        expect(effect).toContain("if (!open) return;");
        expect(effect).toContain('window.addEventListener("keydown", onKeyDown);');
        expect(effect).toContain('window.removeEventListener("keydown", onKeyDown);');
    });

    test("交互控件语境由 blocksDirectorShortcut 判定后交给解析器", () => {
        expect(effect).toContain("isInteractiveTarget: blocksDirectorShortcut(event.target),");
        // 旧的 text-only 判定不得残留：它放过 BUTTON/A/role 型控件。
        expect(workbench).not.toContain("isDirectorTextEntryTarget");
    });

    test("只有动作真的执行了才 preventDefault", () => {
        expect(effect).toContain("if (runShortcutRef.current(action)) event.preventDefault();");
        // 不得无条件吞掉按键。
        expect(effect).not.toContain("event.preventDefault();\n            if (!action)");
    });

    test("每个动作都落到已存在的真实执行路径", () => {
        const runner = slice(workbench, "const runShortcut = (action: DirectorShortcutAction)", "const runShortcutRef");
        expect(runner).toContain("setTransformMode(action.mode);");
        expect(runner).toContain("removeObject(selectedObject.id);");
        expect(runner).toContain("removeLight(selectedLight.id);");
        expect(runner).toContain("updateObject(selectedObject.id, { visible: !selectedObject.visible });");
        expect(runner).toContain("setPlaying(!playing);");
        expect(runner).toContain("undo();");
        expect(runner).toContain("redo();");
    });

    test("没有可操作对象/历史时返回 false，把按键交还浏览器", () => {
        const runner = slice(workbench, "const runShortcut = (action: DirectorShortcutAction)", "const runShortcutRef");
        expect(runner).toContain("if (!history.length) return false;");
        expect(runner).toContain("if (!future.length) return false;");
        expect(runner).toContain("if (!selectedObject) return false;");
        expect(runner).toContain("if (!selectedObjectId && !selectedLightId && !selectedBone) return false;");
    });

    test("dock 与场景列表点选后释放焦点：否则点完就再按不动 W/E/R/Delete", () => {
        // 全局快捷键是本轮新增的，交互控件守卫会吃掉聚焦按钮上的按键。
        // dock 承载 W/E/R 变换工具；场景列表承载「点选对象 -> 按 Delete」主流程。
        const dockButton = slice(dock, "function DockButton(", "function DockDivider(");
        expect(dockButton).toContain("releaseDirectorFocusAfterPointer(event)");
        const sceneRow = slice(workbench, "function SceneRow(", "function AddMenuButton(");
        expect(sceneRow).toContain("releaseDirectorFocusAfterPointer(event)");
    });

    test("焦点释放规则集中在共享 helper，各按钮不自写 blur", () => {
        // 判据（keyboard detail === 0 保留焦点）必须只有一处，否则迟早走偏。
        const dockButton = slice(dock, "function DockButton(", "function DockDivider(");
        expect(dockButton).not.toContain("event.currentTarget.blur()");
        expect(workbench).not.toContain("if (event.detail !== 0) event.currentTarget.blur();");
    });

    test("时间轴轨道行点选后也释放焦点：与场景列表同源的 select-then-Delete 流程", () => {
        const row = slice(sequencer, "function SequencerRow(", "* 关键帧渲染为真实 button");
        expect(row).toContain("releaseDirectorFocusAfterPointer(event)");
    });

    test("关键帧按钮绝不释放焦点：它自己拥有 Enter/Space/Delete/Backspace", () => {
        // 关键帧 blur 掉焦点会让键盘连续删除失效，且与它的 stopPropagation 设计冲突。
        const trackKeys = slice(sequencer, "function TrackKeys(", "function TrackBar(");
        expect(trackKeys).not.toContain("releaseDirectorFocusAfterPointer");
    });
});

describe("时间轴关键帧入口可见、可选择、可键盘删除", () => {
    const trackKeys = slice(sequencer, "function TrackKeys(", "function TrackBar(");

    test("可编辑关键帧是真实 button，不是惰性 span", () => {
        expect(trackKeys).toContain('type="button"');
        expect(trackKeys).toContain("director-sequencer-key is-actionable");
        expect(trackKeys).toContain('aria-label={`选择 ${key.label ?? "关键帧"} ${key.time.toFixed(2)}s 的关键帧`}');
        expect(trackKeys).toContain("aria-pressed=");
    });

    test("普通点击与 Enter/Space 只选择定位，Delete/Backspace 才删除，且都不冒泡", () => {
        expect(trackKeys).toContain('if (!["Enter", " ", "Delete", "Backspace"].includes(event.key)) return;');
        expect(trackKeys).toContain("event.preventDefault();");
        expect(trackKeys).toContain("event.stopPropagation();");
        expect(trackKeys).toContain('if (event.key === "Delete" || event.key === "Backspace") onDeleteKey(target);');
        expect(trackKeys).toContain("else onSelectKey?.(key);");
        expect(trackKeys).toContain("onSelectKey?.(key);");
    });

    test("没有 target 的轨道保持只读，不渲染删除按钮", () => {
        expect(trackKeys).toContain("const target = onDeleteKey && key.target;");
        expect(trackKeys).toContain("if (!target) {");
    });

    test("命中区扩大且有 focus-visible 焦点环", () => {
        expect(styles).toContain(".director-sequencer-key.is-actionable");
        expect(styles).toContain(".director-sequencer-key.is-actionable::after");
        expect(styles).toContain(".director-sequencer-key.is-actionable:focus-visible");
        expect(styles).toContain(".director-sequencer-key.is-actionable.is-selected");
    });

    test("hover/focus 只用语义 token，不新增硬编码颜色", () => {
        const block = slice(styles, "/* 可删除关键帧：", ".director-sequencer-clip {");
        expect(block).toContain("outline: var(--stroke-2) solid var(--control-focus-ring);");
        expect(block).toContain("color-mix(in srgb, var(--control-focus-ring) 55%, transparent)");
        // rgba / 十六进制字面值一律不允许出现在新增块里。
        expect(block).not.toMatch(/rgba?\(/);
        expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    });
});

describe("三类轨道都有删除入口，概览轨保持只读", () => {
    test("摄影机行可删除，Camera Cut 概览轨只读", () => {
        const cameraCut = slice(sequencer, 'label="Camera Cut"', "</SequencerRow>");
        expect(cameraCut).toContain("<TrackKeys duration={duration} keys={cameraKeys} />");
        expect(cameraCut).not.toContain("onDeleteKey");

        const cameraRow = slice(sequencer, "{camera ? <SequencerRow label={camera.name}", "</SequencerRow> : null}");
        expect(cameraRow).toContain("onDeleteKey={deleteTrackKey}");
    });

    test("摄影机关键帧带 camera 删除目标", () => {
        expect(sequencer).toContain('target: { track: "camera", cameraId: camera.id, keyframeId: key.id }');
    });

    test("对象 transform 与骨骼帧各自带正确目标", () => {
        expect(sequencer).toContain('target: { track: "object-transform" as const, objectId: object.id, keyframeId: key.id }');
        expect(sequencer).toContain('target: { track: "object-bone" as const, objectId: object.id, bone: track.bone, keyframeId: key.id }');
    });

    test("折叠状态下的对象汇总轨也可删除，否则收起后就删不掉", () => {
        const summaryRow = slice(sequencer, "<SequencerRow label={object.name} icon={isExpanded", "</SequencerRow>");
        expect(summaryRow).toContain("keys={[...transformKeys, ...boneTrackKeys]}");
        expect(summaryRow).toContain("onDeleteKey={deleteTrackKey}");
    });

    test("展开后的 Transform 子轨与骨骼子轨都可删除", () => {
        const transformRow = slice(sequencer, 'label="Transform" icon="◇"', "</SequencerRow>");
        expect(transformRow).toContain("onDeleteKey={deleteTrackKey}");
        const boneRow = slice(sequencer, "label={directorBoneLabel(track.bone)}", "</SequencerRow>");
        expect(boneRow).toContain("onDeleteKey={deleteTrackKey}");
    });

    test("非演员对象（立方体/模型/立牌）的 transform 轨同样可删除", () => {
        const plainRow = slice(sequencer, 'icon="□"', "</SequencerRow>");
        expect(plainRow).toContain("onDeleteKey={deleteTrackKey}");
        expect(sequencer).toContain('target: { track: "object-transform", objectId: object.id, keyframeId: key.id }');
    });

    test("所选关键帧提供 step/linear/smooth 缓动切换与显式删除按钮", () => {
        expect(sequencer).toContain('aria-label="关键帧缓动"');
        expect(sequencer).toContain('<option value="step">保持</option>');
        expect(sequencer).toContain('<option value="linear">线性</option>');
        expect(sequencer).toContain('<option value="smooth">平滑</option>');
        expect(sequencer).toContain('aria-label="删除所选关键帧"');
    });

    test("切换摄影机或外部删帧后清除陈旧选择，顶部控件不能误改不可见轨道", () => {
        expect(sequencer).toContain("directorKeyframeTargetExists(selectedKey.target, camera, objects)");
        expect(sequencer).toContain("setSelectedKey((current) => current?.target && !directorKeyframeTargetExists(current.target, camera, objects) ? null : current);");
        expect(sequencer).toContain("camera?.id === target.cameraId && camera.keyframes.some");
        expect(sequencer).toContain("object.boneTracks?.some");
    });
});
