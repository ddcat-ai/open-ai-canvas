export function isIsolatedPrevisRepro(dev: boolean, pathname: string): boolean {
    return dev && pathname === "/dev/previs-repro";
}
