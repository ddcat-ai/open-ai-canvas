export function isIsolatedDirectorRepro(dev: boolean, pathname: string): boolean {
    return dev && pathname === "/dev/director-repro";
}
