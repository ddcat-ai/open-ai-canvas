import { teamIdFromPath } from "./team-query-keys";

export const workspaceTeamId = typeof window === "undefined" ? undefined : teamIdFromPath(window.location?.pathname || "");

export function workspacePath(path: string, teamId = workspaceTeamId) {
    return teamId ? `/teams/${encodeURIComponent(teamId)}${path}` : path;
}

export function workspacePagePath(pathname: string) {
    return pathname.replace(/^\/teams\/[^/]+(?=\/|$)/, "") || "/";
}

export function workspaceApiPath(path: string, teamId = workspaceTeamId, method = "get") {
    if (!teamId || /^\/(?:teams|team-invitations|auth|site-traffic|diagnostics)(?:\/|$)/.test(path)) return path;
    if (method.toLowerCase() === "get" && /^\/(?:features|(?:public\/)?appearance|model-catalog|channels\/system|announcements|settings\/prompt-templates|plugins(?:\/catalog|\/status)?|workbench\/tools)(?:\?|$)/.test(path)) return path;
    if (method.toLowerCase() === "post" && /^\/(?:model-catalog|models\/[^/]+)\/quote$/.test(path)) return path;
    if (/^\/(?:canvas-projects|creation-conversations|user-data|assets|asset-folders|resources|tasks)(?:\/|\?|$)/.test(path)) return workspacePath(`/workspace${path}`, teamId);
    throw new Error("此功能尚未在当前团队空间开放");
}

export function isSpatialWorkbenchPath(pathname: string) {
    // 画布列表属于用户工作台，只有具体画布编辑器与运营后台保留各自现有视觉契约。
    const canvasEditor = /^\/canvas\/[^/]+(?:\/|$)/.test(workspacePagePath(pathname));
    return !canvasEditor && !pathname.startsWith("/admin");
}
