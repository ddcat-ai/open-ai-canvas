// SupDance 兼容层适配器与上游补丁注册表。
//
// 所有对上游核心源码的不可避免接触点、路由扩展、插件能力映射均在此登记，
// 以便每次上游升级时自动化测试与同步脚本能够精确定位耦合点。

import type { RouteObject } from "react-router";
import type { PluginHostContext, PluginManifest, PluginManifestV2, RegisteredPlugin } from "@/lib/plugins/plugin-types";
import { getRegisteredPlugin, registerPlugin, unregisterPlugin } from "@/lib/plugins/plugin-registry";

export const SUPDANCE_HOST_VERSION = "1.7.1" as const;

export type UpstreamPatchRecord = {
    id: string;
    upstreamBaseline: string;
    feature: string;
    coupledUpstreamFiles: readonly string[];
    files: readonly string[];
    reason: string;
    upgradeRisk: "LOW" | "MEDIUM" | "HIGH";
};

/**
 * 当前已登记的不可避免上游核心文件补丁清单。
 * 新增核心文件修改时必须同步登记，并由架构回归测试与 baseline.json 对齐校验。
 */
export const SUPDANCE_UPSTREAM_PATCH_REGISTRY: readonly UpstreamPatchRecord[] = [
    {
        id: "supdance-codex-agent-connector",
        upstreamBaseline: "v1.7.1",
        feature: "本机 SupDance Canvas Agent (Codex) 连接器发现、配对、SSE 与对话转发",
        coupledUpstreamFiles: ["web/src/components/canvas/canvas-cloud-agent-connectors.css", "web/src/components/canvas/canvas-cloud-agent-connectors.tsx", "web/src/components/canvas/canvas-cloud-agent-panel.tsx"],
        files: [
            "web/src/components/canvas/canvas-cloud-agent-connectors.css",
            "web/src/components/canvas/canvas-cloud-agent-connectors.tsx",
            "web/src/components/canvas/canvas-cloud-agent-panel.tsx",
            "web/src/components/canvas/use-codex-connector.ts",
            "web/src/services/api/codex-connector.ts",
        ],
        reason: "在画布底部 Agent 连接器栏挂载本机 Codex 协作入口与状态机，同时保留上游云端 Agent 撤回插话、后台标签页不轮询等原生行为。",
        upgradeRisk: "MEDIUM",
    },
    {
        id: "supdance-workspace-governance",
        upstreamBaseline: "v1.7.1",
        feature: "SupDance 二开文档放行规则与 AI 编程工作区索引入口",
        coupledUpstreamFiles: [".gitignore", "AGENTS.md"],
        files: [".gitignore", "AGENTS.md"],
        reason: "上游 .gitignore 默认忽略 docs/*，需最小化放行 !docs/supdance/ 并在 AGENTS.md 末尾追加文档入口指针。",
        upgradeRisk: "LOW",
    },
    {
        id: "supdance-i18n-plugin",
        upstreamBaseline: "v1.7.1",
        feature: "站点多语言插件 (supdance-i18n)：右上角六国语言切换图标、响应式词条引擎、后台语言管理设置与在线字段修改页面",
        coupledUpstreamFiles: [
            "backend/internal/app/plugin_management.go",
            "backend/internal/handler/api.go",
            "web/src/lib/plugins/builtin/index.ts",
            "web/src/components/layout/app-changelog-dialog.tsx",
            "web/src/components/layout/app-changelog-modal.tsx",
            "web/src/components/layout/app-providers.tsx",
            "web/src/components/layout/site-compliance-footer.tsx",
            "web/src/components/layout/system-announcement-center.tsx",
            "web/src/components/layout/user-oss-settings-form.tsx",
            "web/src/components/layout/workspace-account-card.tsx",
            "web/src/components/layout/workspace-account-menu.tsx",
            "web/src/components/layout/workspace-sidebar-footer.tsx",
            "web/src/components/layout/workspace-sidebar-nav.tsx",
            "web/src/components/layout/workspace-top-bar.tsx",
            "web/src/components/layout/workspace-wallet-modal.tsx",
            "web/src/components/layout/workspace-wallet-topup.tsx",
            "web/src/pages/auth/auth-scene.tsx",
            "web/src/pages/auth/login.tsx",
            "web/src/pages/canvas/canvas-project-top-bar.tsx",
            "web/src/pages/admin/components/admin-shell.tsx",
            "web/src/pages/admin/plugins/plugins-page.tsx",
            "web/src/pages/settings/index.tsx",
            "web/src/pages/settings/model-default-grid.tsx",
            "web/src/pages/settings/profile-pane.tsx",
            "web/src/router.tsx",
        ],
        files: [
            "supdance/plugins/supdance-i18n/manifest.json",
            "backend/internal/supdance/i18n/types.go",
            "backend/internal/supdance/i18n/defaults.go",
            "backend/internal/supdance/i18n/manager.go",
            "backend/internal/app/supdance_i18n_plugin.go",
            "backend/internal/service/aliases_supdance.go",
            "backend/internal/handler/supdance_i18n.go",
            "web/src/supdance/plugins/i18n/index.ts",
            "web/src/supdance/plugins/i18n/types.ts",
            "web/src/supdance/plugins/i18n/api.ts",
            "web/src/supdance/plugins/i18n/store.ts",
            "web/src/supdance/plugins/i18n/locales/index.ts",
            "web/src/supdance/plugins/i18n/engine/translator.ts",
            "web/src/supdance/plugins/i18n/engine/dom-observer.ts",
            "web/src/supdance/plugins/i18n/engine/antd-locale.ts",
            "web/src/supdance/plugins/i18n/components/topbar-language-switcher.tsx",
            "web/src/supdance/plugins/i18n/components/i18n-runtime-host.tsx",
            "web/src/supdance/plugins/i18n/admin/i18n-settings-page.tsx",
            "web/src/supdance/plugins/i18n/admin/i18n-entries-page.tsx",
        ],
        reason: "以可热插拔插件形式挂载右上角语言切换器、AntD 动态 Locale 与后台语言管理/词条修改路由，所有业务逻辑位于独立 supdance/i18n 扩展包内。",
        upgradeRisk: "LOW",
    },
] as const;

export const SUPDANCE_RESERVED_PLUGIN_PREFIX = "supdance-" as const;

export type SupDancePluginManifest = (PluginManifest | PluginManifestV2) & {
    minHostVersion?: string;
};

export type SupDancePluginCompatibilityReport = {
    compatible: boolean;
    pluginId: string;
    version: string;
    apiVersion: string;
    minHostVersion?: string;
    errors: string[];
};

const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function compareSemVer(a: string, b: string): number {
    const parse = (v: string) => {
        const cleaned = v.trim().replace(/^v/, "");
        const [core = "", pre = ""] = cleaned.split("-", 2);
        const nums = core.split(".").map((n) => Number.parseInt(n, 10) || 0);
        while (nums.length < 4) nums.push(0);
        return { nums, pre };
    };
    const pa = parse(a);
    const pb = parse(b);
    for (let i = 0; i < 4; i++) {
        if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i] ? 1 : -1;
    }
    if (!pa.pre && pb.pre) return 1;
    if (pa.pre && !pb.pre) return -1;
    return pa.pre.localeCompare(pb.pre);
}

/**
 * 校验 SupDance 自定义插件清单是否满足宿主契约、最低兼容宿主版本与命名空间隔离规则。
 */
export function validateSupDancePluginManifest(manifest: SupDancePluginManifest, existingIds: ReadonlySet<string> = new Set(), hostVersion: string = SUPDANCE_HOST_VERSION): SupDancePluginCompatibilityReport {
    const errors: string[] = [];
    if (!manifest.id.startsWith(SUPDANCE_RESERVED_PLUGIN_PREFIX)) {
        errors.push(`SupDance 自定义插件 ID 必须以 "${SUPDANCE_RESERVED_PLUGIN_PREFIX}" 开头（当前：${manifest.id}）`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) {
        errors.push("插件 ID 必须符合小写 kebab-case 规范");
    }
    if (existingIds.has(manifest.id)) {
        errors.push(`插件 ID "${manifest.id}" 与现有插件冲突`);
    }
    const rawApiVersion = String((manifest as { apiVersion?: unknown }).apiVersion ?? "");
    if (rawApiVersion !== "yingce.plugin/v1" && rawApiVersion !== "yingce.plugin/v2") {
        errors.push(`不支持的宿主 apiVersion：${rawApiVersion}`);
    }
    if (!SEMVER_REGEX.test(manifest.version)) {
        errors.push(`插件版本号 "${manifest.version}" 必须遵循 SemVer`);
    }
    if (manifest.minHostVersion !== undefined) {
        const cleanedMin = manifest.minHostVersion.trim().replace(/^v/, "");
        if (!SEMVER_REGEX.test(cleanedMin)) {
            errors.push(`最低宿主版本声明 "${manifest.minHostVersion}" 必须遵循 SemVer`);
        } else if (compareSemVer(hostVersion, cleanedMin) < 0) {
            errors.push(`当前宿主版本 (${hostVersion}) 低于插件要求的最低兼容版本 (${manifest.minHostVersion})`);
        }
    }
    if (new Set(manifest.permissions).size !== manifest.permissions.length) {
        errors.push("插件权限声明包含重复项");
    }
    return {
        compatible: errors.length === 0,
        pluginId: manifest.id,
        version: manifest.version,
        apiVersion: manifest.apiVersion,
        minHostVersion: manifest.minHostVersion,
        errors,
    };
}

/**
 * 安全注册 SupDance 插件：先做命名空间与兼容性校验，再委托给宿主 registerPlugin。
 */
export function registerSupDancePlugin(plugin: RegisteredPlugin, hostVersion: string = SUPDANCE_HOST_VERSION): void {
    const existing = getRegisteredPlugin(plugin.manifest.id);
    const conflictSet = new Set<string>();
    if (existing && existing.manifest.version !== plugin.manifest.version) {
        conflictSet.add(plugin.manifest.id);
    }
    const report = validateSupDancePluginManifest(plugin.manifest as SupDancePluginManifest, conflictSet, hostVersion);
    if (!report.compatible) {
        throw new Error(`SupDance 插件兼容性校验失败（${plugin.manifest.id}）：${report.errors.join("；")}`);
    }
    registerPlugin(plugin);
}

/**
 * 安全升级已注册的 SupDance 插件：校验新版本 > 旧版本，清理旧注册项后挂载新版本。
 */
export async function upgradeSupDancePlugin(nextPlugin: RegisteredPlugin, options: { context?: PluginHostContext; hostVersion?: string } = {}): Promise<{ previousVersion: string | null; currentVersion: string }> {
    const report = validateSupDancePluginManifest(nextPlugin.manifest as SupDancePluginManifest, new Set(), options.hostVersion ?? SUPDANCE_HOST_VERSION);
    if (!report.compatible) {
        throw new Error(`SupDance 插件升级校验失败（${nextPlugin.manifest.id}）：${report.errors.join("；")}`);
    }
    const existing = getRegisteredPlugin(nextPlugin.manifest.id);
    let previousVersion: string | null = null;
    if (existing) {
        previousVersion = existing.manifest.version;
        if (compareSemVer(nextPlugin.manifest.version, previousVersion) <= 0) {
            throw new Error(`SupDance 插件升级版本号 (${nextPlugin.manifest.version}) 必须高于当前已安装版本 (${previousVersion})`);
        }
        if (existing.deactivate && options.context) {
            await deactivateSupDancePluginSafely(existing.manifest.id, options.context);
        }
        unregisterPlugin(existing.manifest.id);
    }
    registerPlugin(nextPlugin);
    return { previousVersion, currentVersion: nextPlugin.manifest.version };
}

export type SupDancePluginLifecycleResult = {
    ok: boolean;
    pluginId: string;
    error?: string;
};

/**
 * 插件失败隔离激活：若插件 activate() 抛错，捕获异常并自动卸载该故障插件，确保不阻断宿主画布与工作台运行。
 */
export async function activateSupDancePluginSafely(pluginId: string, context: PluginHostContext): Promise<SupDancePluginLifecycleResult> {
    const registered = getRegisteredPlugin(pluginId);
    if (!registered) {
        return { ok: false, pluginId, error: `插件 ${pluginId} 未注册` };
    }
    try {
        await registered.activate?.(context);
        return { ok: true, pluginId };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        unregisterPlugin(pluginId);
        return { ok: false, pluginId, error: message };
    }
}

/**
 * 插件失败隔离停用：捕获 deactivate() 异常，确保停用与卸载流程不被插件内部错误中断。
 */
export async function deactivateSupDancePluginSafely(pluginId: string, context: PluginHostContext): Promise<SupDancePluginLifecycleResult> {
    const registered = getRegisteredPlugin(pluginId);
    if (!registered) {
        return { ok: false, pluginId, error: `插件 ${pluginId} 未注册` };
    }
    try {
        await registered.deactivate?.(context);
        return { ok: true, pluginId };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, pluginId, error: message };
    }
}

export function unregisterSupDancePlugin(pluginId: string): void {
    unregisterPlugin(pluginId);
}

function normalizeRoutePath(rawPath: string): string {
    const withLeadingSlash = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    const collapsed = withLeadingSlash.replace(/\/+/g, "/");
    return collapsed.length > 1 && collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
}

function collectNormalizedRoutePaths(routes: readonly RouteObject[], prefix = ""): string[] {
    const collected: string[] = [];
    for (const route of routes) {
        let currentPath = prefix;
        if (route.path) {
            const joined = route.path.startsWith("/") ? route.path : `${prefix}/${route.path}`;
            currentPath = normalizeRoutePath(joined);
            collected.push(currentPath);
        }
        if (route.children?.length) {
            collected.push(...collectNormalizedRoutePaths(route.children, currentPath));
        }
    }
    return collected;
}

/**
 * 校验并合并 SupDance 扩展路由，防止自定义路由（含嵌套子路由与尾部斜杠变体）意外覆盖上游既有路由。
 */
export function mergeSupDanceRoutes(upstreamRoutes: readonly RouteObject[], supdanceRoutes: readonly RouteObject[]): RouteObject[] {
    const existingPaths = new Set(collectNormalizedRoutePaths(upstreamRoutes));
    const customPaths = collectNormalizedRoutePaths(supdanceRoutes);
    const seenCustom = new Set<string>();

    for (const customPath of customPaths) {
        if (existingPaths.has(customPath)) {
            throw new Error(`SupDance 扩展路由 "${customPath}" 与上游路由冲突，禁止覆盖上游核心路径`);
        }
        if (seenCustom.has(customPath)) {
            throw new Error(`SupDance 扩展路由 "${customPath}" 在自定义路由表内重复声明`);
        }
        seenCustom.add(customPath);
    }
    return [...upstreamRoutes, ...supdanceRoutes];
}
