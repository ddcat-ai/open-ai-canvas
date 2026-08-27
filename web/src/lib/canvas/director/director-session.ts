import type { DirectorScene } from "../../../types/director";

/**
 * 打开期间本地 draft 是唯一权威：只有 scene id 变化（或首次挂载）才重建会话。
 * 同 id 的父级镜像回流绝不能重新 clone / 清历史 / 重置播放头。
 */
export function shouldReinitializeDirectorSession(input: { initializedSceneId: string | null; nextSceneId: string | null }) {
    const { initializedSceneId, nextSceneId } = input;
    if (!nextSceneId) return false;
    return initializedSceneId !== nextSceneId;
}

/** 以 id upsert，调用方必须传入「当前最新」数组，避免旧闭包覆盖并发保存。 */
export function upsertDirectorSceneById(scenes: DirectorScene[], scene: DirectorScene): DirectorScene[] {
    return scenes.some((item) => item.id === scene.id) ? scenes.map((item) => (item.id === scene.id ? scene : item)) : [...scenes, scene];
}

/**
 * 输出上传可能跨越数秒。只把生成出的预览引用合并到最新场景，绝不拿输出开始时的
 * scene 快照覆盖期间发生的标题、对象、关键帧或镜头编辑。
 */
export function mergeDirectorOutputPreview(scene: DirectorScene, input: { sceneId: string; shotId: string; previewNodeId: string }) {
    if (scene.id !== input.sceneId || !scene.shots.some((shot) => shot.id === input.shotId)) return null;
    return {
        ...scene,
        shots: scene.shots.map((shot) => (shot.id === input.shotId ? { ...shot, previewNodeId: input.previewNodeId, depthNodeId: undefined, normalNodeId: undefined } : shot)),
    };
}

/** 长截图/录制结束前，场景引用与活动镜头必须仍是操作开始时的快照。 */
export function isDirectorOutputSnapshotCurrent(scene: DirectorScene | null, expected: { scene: DirectorScene; shotId: string }) {
    if (scene !== expected.scene) return false;
    const activeShot = scene.shots.find((shot) => shot.id === scene.activeShotId) || scene.shots[0];
    return activeShot?.id === expected.shotId;
}
