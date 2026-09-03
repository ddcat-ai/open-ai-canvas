import { WORKBENCH_CONTRIBUTIONS } from "@/lib/workspace-sidebar-layout";
import { registerPlugin } from "../plugin-registry";
import { PLUGIN_API_VERSION, type PluginManifest, type RegisteredPlugin } from "../plugin-types";

export const WORKBENCH_PLUGIN_ID = "workbench";

const manifest: PluginManifest = {
    apiVersion: PLUGIN_API_VERSION,
    id: WORKBENCH_PLUGIN_ID,
    name: "工作台插件",
    version: "1.0.0",
    publishedAt: "2026-09-03",
    updatedAt: "2026-09-03",
    description: "把常用创作入口聚合到侧边栏，并允许每位用户在设置中自定义显示状态与顺序。",
    author: "影策团队",
    surfaces: ["sidebar", "settings"],
    permissions: [],
    trusted: true,
    defaultEnabled: true,
    runtime: { web: "declarative" },
    contributes: { workbench: WORKBENCH_CONTRIBUTIONS },
};

export const workbenchPlugin: RegisteredPlugin = { manifest };

registerPlugin(workbenchPlugin);
