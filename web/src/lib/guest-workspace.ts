export function isGuestWorkspacePath(pathname: string) {
    return pathname === "/" || pathname === "/create";
}
