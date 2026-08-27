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
