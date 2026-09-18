import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { accountStorageMeter } from "../src/lib/account-storage-usage";

const GB = 1024 ** 3;

describe("account storage meter", () => {
    test("exposes remaining capacity and total capacity", () => {
        const meter = accountStorageMeter({ usedBytes: 2 * GB, totalBytes: 10 * GB });

        expect(meter.usedLabel).toBe("2.0 GB");
        expect(meter.remainingLabel).toBe("8.0 GB");
        expect(meter.totalLabel).toBe("10 GB");
        expect(meter.percent).toBe(20);
        expect(meter.tone).toBe("ok");
        expect(meter.full).toBe(false);
    });

    test("warns when usage reaches seventy percent", () => {
        const meter = accountStorageMeter({ usedBytes: 7 * GB, totalBytes: 10 * GB });

        expect(meter.percent).toBe(70);
        expect(meter.tone).toBe("warn");
        expect(meter.remainingLabel).toBe("3.0 GB");
    });

    test("marks full accounts as critical with zero remaining", () => {
        const meter = accountStorageMeter({ usedBytes: 10 * GB, totalBytes: 10 * GB });

        expect(meter.full).toBe(true);
        expect(meter.tone).toBe("critical");
        expect(meter.remainingBytes).toBe(0);
        expect(meter.remainingLabel).toBe("0 B");
        expect(meter.percent).toBe(100);
    });

    test("treats missing usage as empty instead of overflowing", () => {
        const meter = accountStorageMeter();

        expect(meter.percent).toBe(0);
        expect(meter.remainingLabel).toBe("0 B");
        expect(meter.totalLabel).toBe("0 B");
        expect(meter.tone).toBe("ok");
        expect(meter.full).toBe(false);
    });
});

describe("workspace sidebar storage meter", () => {
    test("sits above the signed-in profile and shows used, remaining and total", () => {
        const sidebar = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-sidebar-nav.tsx"), "utf8");
        const meter = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-sidebar-storage-meter.tsx"), "utf8");
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

        expect(sidebar).toContain("<WorkspaceSidebarStorageMeter collapsed={collapsed} />");
        expect(sidebar.indexOf("WorkspaceSidebarStorageMeter")).toBeLessThan(sidebar.indexOf("app-workspace-sidebar-profile-row"));
        expect(meter).toContain("HardDrive");
        expect(meter).toContain("app-workspace-sidebar-storage-icon");
        expect(meter).toContain("已用 ${meter.usedLabel}");
        expect(meter).toContain("剩余 ${meter.remainingLabel}");
        expect(meter).toContain("共 ${meter.totalLabel}");
        expect(meter).toContain('to="/assets"');
        expect(css).toContain(".app-workspace-sidebar-storage-icon");
        expect(css).toMatch(/\.app-workspace-sidebar-storage-used\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
        expect(css).toContain(".app-workspace-sidebar-storage.is-warn");
        expect(css).toContain(".app-workspace-sidebar-storage.is-critical");
    });
});
