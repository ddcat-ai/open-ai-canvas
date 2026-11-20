import { describe, expect, test } from "bun:test";
import { zhCN as accountZh } from "../src/i18n/messages/areas/account/zh-CN";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { sidebarCheckinTitle, shouldShowSidebarCheckin } from "../src/lib/sidebar-checkin";

describe("sidebar checkin offer", () => {
    test("shows only when credits and a checkin bonus are enabled and today is unclaimed", () => {
        expect(shouldShowSidebarCheckin({ creditsEnabled: true, checkinBonusMicrocredits: 100_000_000, checkedInToday: false })).toBe(true);
        expect(shouldShowSidebarCheckin({ creditsEnabled: false, checkinBonusMicrocredits: 100_000_000, checkedInToday: false })).toBe(false);
        expect(shouldShowSidebarCheckin({ creditsEnabled: true, checkinBonusMicrocredits: 0, checkedInToday: false })).toBe(false);
        expect(shouldShowSidebarCheckin({ creditsEnabled: true, checkinBonusMicrocredits: 100_000_000, checkedInToday: true })).toBe(false);
    });

    test("uses the configured brand name instead of Buddy", () => {
        expect(sidebarCheckinTitle("影策")).toBe("影策加油站");
        expect(sidebarCheckinTitle(" 本地工作室 ")).toBe("本地工作室加油站");
        expect(sidebarCheckinTitle("")).toBe("影策加油站");
    });
});

describe("workspace sidebar checkin card", () => {
    test("collapsed offer uses a centered gift icon instead of a clipped text label", () => {
        const card = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-sidebar-checkin.tsx"), "utf8");
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
        const collapsed = card.slice(card.indexOf("if (collapsed)"), card.indexOf("<aside"));
        expect(collapsed).toContain("<Gift");
        expect(collapsed).toContain("<LoaderCircle");
        expect(collapsed).toContain("aria-busy={claiming}");
        expect(collapsed).not.toContain(': "领"');
        const rule = css.match(/\.app-user-workspace \.app-workspace-sidebar-checkin\.is-collapsed \{(\s*width: 48px;[^}]+)\}/)?.[1] || "";
        expect(rule).toContain("justify-content: center;");
        expect(rule).toContain("padding: 0;");
        expect(rule).toContain("box-shadow: none;");
    });
    test("sits above account storage and uses the claim card colors without a light-blue stage", () => {
        const sidebar = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-sidebar-nav.tsx"), "utf8");
        const card = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-sidebar-checkin.tsx"), "utf8");
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
        const checkinIndex = sidebar.indexOf("<WorkspaceSidebarCheckin collapsed={collapsed} />");
        const storageIndex = sidebar.indexOf("<WorkspaceSidebarStorageMeter collapsed={collapsed} />");
        const start = css.indexOf(".app-user-workspace .app-workspace-sidebar-checkin {");
        const end = css.indexOf(".app-user-workspace .app-workspace-sidebar-storage {", start);
        const block = css.slice(start, end);

        expect(checkinIndex).toBeGreaterThan(-1);
        expect(storageIndex).toBeGreaterThan(checkinIndex);
        expect(card).toContain('t("account.layout.checkin.claim")');
        expect(accountZh.layout.checkin.claim).toBe("立即领取");
        expect(card).toContain('{t("account.layout.checkin.offerBefore")}\n                    <em>{amount}</em>\n                    {t("account.layout.checkin.offerAfter")}');
        expect(accountZh.layout.checkin).toMatchObject({ offerBefore: "今日", offerAfter: "积分" });
        expect(card).toContain("checkinCredits()");
        expect(block).toContain("background: #fff;");
        expect(block).toContain("background: #171717;");
        expect(block).toContain("color: #12c8a0;");
        expect(block).not.toMatch(/#(?:dbeafe|e8f1ff|eef4ff|e6f0ff|d6e8ff)/i);
    });
});
