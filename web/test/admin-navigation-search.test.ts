import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { searchAdminNavigation } from "../src/pages/admin/lib/navigation-search";

const entries = [
    { path: "/admin/email-logs", label: "邮件记录", group: "运营监控", keywords: "发送 验证码" },
    { path: "/admin/settings/email", label: "邮件服务", group: "系统设置", keywords: "SMTP 邮箱" },
    { path: "/admin/channels", label: "渠道与模型", group: "模型与渠道", keywords: "API Key 定价" },
];

test("后台搜索支持名称、分类、路由及多关键词，不区分英文大小写", () => {
    expect(searchAdminNavigation(entries, "邮件")).toHaveLength(2);
    expect(searchAdminNavigation(entries, "系统 SMTP")).toEqual([entries[1]]);
    expect(searchAdminNavigation(entries, "ｓｍｔｐ")).toEqual([entries[1]]);
    expect(searchAdminNavigation(entries, "api key")).toEqual([entries[2]]);
    expect(searchAdminNavigation(entries, "/admin/channels")).toEqual([entries[2]]);
    expect(searchAdminNavigation(entries, "不存在")).toEqual([]);
    expect(searchAdminNavigation(entries, "  ")).toEqual(entries);
});

test("精确页面名优先，搜索不引入调用方未提供的入口", () => {
    expect(searchAdminNavigation([...entries, { path: "/admin/other", label: "邮件", group: "其他" }], "邮件")[0].path).toBe("/admin/other");
    expect(searchAdminNavigation(entries.slice(0, 1), "SMTP")).toEqual([]);
});

test("搜索和侧栏共用菜单，每个搜索入口都对应已注册后台路由", () => {
    const shell = readFileSync(new URL("../src/pages/admin/components/admin-shell.tsx", import.meta.url), "utf8");
    const router = readFileSync(new URL("../src/router.tsx", import.meta.url), "utf8");
    const menu = shell.slice(shell.indexOf("const adminNavigation:"), shell.indexOf("function isAdminNavigationPath"));
    const paths = [...menu.matchAll(/path: "([^"]+)"/g)].map((match) => match[1]);
    expect(paths.length).toBeGreaterThan(30);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
        if (path !== "/admin") expect(router).toContain(`path: "${path.slice("/admin/".length)}"`);
    }
    expect(shell).toContain("visibleNavigationGroups(features).flatMap");
    expect(shell).toContain("<AdminGlobalSearch entries={searchEntries} />");
});
