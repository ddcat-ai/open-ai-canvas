export function isSpatialWorkbenchPath(pathname: string) {
    // 画布列表属于用户工作台，只有具体画布编辑器与运营后台保留各自现有视觉契约。
    const canvasEditor = /^\/canvas\/[^/]+(?:\/|$)/.test(pathname);
    return !canvasEditor && !pathname.startsWith("/admin");
}
