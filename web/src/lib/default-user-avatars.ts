export const DEFAULT_USER_AVATARS = [
    { id: "person", label: "默认人像" },
    { id: "director", label: "导演" },
    { id: "camera", label: "摄影师" },
    { id: "cat", label: "小猫" },
    { id: "rabbit", label: "小兔" },
    { id: "robot", label: "机器人" },
    { id: "rocket", label: "探索者" },
    { id: "sparkles", label: "灵感" },
] as const;

export type DefaultUserAvatarID = (typeof DEFAULT_USER_AVATARS)[number]["id"];

export function isDefaultUserAvatarID(value: unknown): value is DefaultUserAvatarID {
    return DEFAULT_USER_AVATARS.some((avatar) => avatar.id === value);
}
