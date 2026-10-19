export type SpriteAction = { id: string; label: string; row: number; start: number; frames: number; fps: number; loop: boolean };
export const SPRITE_BINDING_LABELS = {
    idle: "待机",
    working: "工作",
    waiting: "等待审批 / 回答",
    failed: "失败",
    completed: "完成",
    moveLeft: "向左拖动",
    moveRight: "向右拖动",
    hover: "悬停互动",
    greeting: "问候",
    sleep: "睡觉",
    wake: "醒来",
} as const;
export type SpriteBinding = keyof typeof SPRITE_BINDING_LABELS;
export type SpritePet = {
    displayName: string;
    spritesheetPath: string;
    atlasWidth: number;
    atlasHeight: number;
    frameWidth: number;
    frameHeight: number;
    neutralFrame: number;
    lookStartFrame: number;
    lookDirections: number;
    speed: number;
    sleepAfterSeconds: number;
    author: string;
    source: string;
    license: string;
    actions: SpriteAction[];
    bindings: Record<SpriteBinding, string>;
};
export type SpriteRunState = { runId?: string; status?: string; cleanupPending?: boolean; waitingUser?: boolean; approvalPending?: boolean; connected?: boolean; completedAt?: number };

export function spriteBusinessBinding(state: SpriteRunState): SpriteBinding {
    if (state.status === "failed") return "failed";
    if (state.approvalPending || state.waitingUser || state.status === "waiting_approval" || state.status === "queued") return "waiting";
    if (state.cleanupPending || state.status === "running") return "working";
    return "idle";
}

export function spriteAction(pet: SpritePet, binding: SpriteBinding): SpriteAction {
    return pet.actions.find((a) => a.id === pet.bindings[binding]) || pet.actions.find((a) => a.id === pet.bindings.idle) || pet.actions[0];
}

export function spriteFrame(pet: SpritePet, action: SpriteAction, elapsed: number) {
    const count = Math.max(1, action.frames);
    const step = Math.max(0, Math.floor((elapsed * action.fps * pet.speed) / 1000));
    const frame = action.loop ? step % count : Math.min(step, count - 1);
    return action.row * (pet.atlasWidth / pet.frameWidth) + action.start + frame;
}

export function spriteLookFrame(pet: SpritePet, dx: number, dy: number): number {
    if (!pet.lookDirections || Math.hypot(dx, dy) < 24) return pet.neutralFrame;
    const angle = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
    const direction = Math.round(angle / ((Math.PI * 2) / pet.lookDirections)) % pet.lookDirections;
    return pet.lookStartFrame + direction;
}

export function validateSpritePet(pet: SpritePet): string {
    if (
        !pet ||
        !Number.isInteger(pet.frameWidth) ||
        !Number.isInteger(pet.frameHeight) ||
        pet.frameWidth < 8 ||
        pet.frameHeight < 8 ||
        pet.atlasWidth > 4096 ||
        pet.atlasHeight > 4096 ||
        pet.atlasWidth < pet.frameWidth ||
        pet.atlasHeight < pet.frameHeight ||
        pet.atlasWidth % pet.frameWidth ||
        pet.atlasHeight % pet.frameHeight
    )
        return "图集宽高必须能被单帧尺寸整除，最大 4096px，单帧至少 8px";
    const cols = pet.atlasWidth / pet.frameWidth,
        rows = pet.atlasHeight / pet.frameHeight;
    if (cols > 64 || rows > 64 || !pet.actions?.length || pet.actions.length > 48) return "图集最多 64 行/列，动作须为 1–48 个";
    const ids = new Set<string>();
    for (const a of pet.actions) {
        if (!/^[a-z][a-z0-9-]{0,39}$/.test(a.id) || ids.has(a.id)) return "动作标识必须唯一，使用小写字母、数字和短横线";
        ids.add(a.id);
        if (![a.row, a.start, a.frames].every(Number.isInteger) || a.row < 0 || a.row >= rows || a.start < 0 || a.frames < 1 || a.start + a.frames > cols || !Number.isFinite(a.fps) || a.fps < 1 || a.fps > 30)
            return `动作“${a.label || a.id}”的行、起始列、帧数或帧率无效`;
    }
    if (!ids.has(pet.bindings?.idle)) return "必须绑定待机动作";
    if (Object.values(pet.bindings).some((id) => id && !ids.has(id))) return "状态映射引用了不存在的动作";
    if (!Number.isFinite(pet.speed) || pet.speed < 0.25 || pet.speed > 3) return "播放倍率须为 0.25–3";
    if (!Number.isInteger(pet.neutralFrame) || pet.neutralFrame < 0 || pet.neutralFrame >= cols * rows) return "中立帧超出图集";
    if (![0, 8, 16].includes(pet.lookDirections) || (pet.lookDirections > 0 && (!Number.isInteger(pet.lookStartFrame) || pet.lookStartFrame < 0 || pet.lookStartFrame + pet.lookDirections > cols * rows))) return "注视帧配置无效";
    if (pet.sleepAfterSeconds !== 0 && (!Number.isInteger(pet.sleepAfterSeconds) || pet.sleepAfterSeconds < 60 || pet.sleepAfterSeconds > 3600 || !pet.bindings.sleep)) return "自动睡眠须绑定睡眠动作，时间为 60–3600 秒";
    return "";
}

export function spriteCompletedTransition(previous: SpriteRunState | undefined, next: SpriteRunState) {
    return Boolean(previous?.runId && previous.runId === next.runId && (previous.status !== "completed" || previous.cleanupPending) && next.status === "completed" && !next.cleanupPending && previous.connected !== false && next.connected !== false);
}
