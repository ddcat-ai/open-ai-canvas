import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * i18n 守护探针：catalog 一致性、已迁移文件无中文残留、t() 引用的 key 必须存在、
 * prompt 词表目录禁止接 i18n（双重身份的词不允许被「统一翻译」改掉生成效果）。
 *
 * 维护规则：
 * - 新迁移一个文件，把它加进 MIGRATED_FILES（allowlist 只允许缩小，不允许放大）。
 * - 新增 namespace 时同步更新 NAMESPACES 与 src/locales/{zh-CN,en}/ 两侧 JSON。
 */

const WEB_ROOT = join(import.meta.dir, "..");
const LOCALES_DIR = join(WEB_ROOT, "src", "locales");
const SRC_DIR = join(WEB_ROOT, "src");

const LANGS = ["zh-CN", "en"] as const;
const NAMESPACES = ["common", "auth", "layout", "settings", "error", "project", "canvas", "admin", "tasks", "assets", "plugins", "skills", "wallet", "home", "dev", "domain", "lib"] as const;

/** 已完成迁移的源码文件：不得再出现中文（注释除外），也不得出现硬编码 locale 字面量 */
const MIGRATED_FILES = [
    "src/pages/auth/login.tsx",
    "src/pages/auth/register.tsx",
    "src/pages/auth/auth-scene.tsx",
    "src/components/layout/workspace-account-menu.tsx",
    "src/components/layout/locale-switcher.tsx",
    "src/components/layout/app-providers.tsx",
    // P1 第一批：pages/projects（红线文件除外：create-ai-prompt / project-chapter-ai / project-character-media）
    "src/pages/projects/index.tsx",
    "src/pages/projects/detail.tsx",
    "src/pages/projects/detail/assets.tsx",
    "src/pages/projects/detail/canvases.tsx",
    "src/pages/projects/detail/chapters.tsx",
    "src/pages/projects/detail/overview.tsx",
    "src/pages/projects/detail/project-character-card.tsx",
    "src/pages/projects/detail/settings.tsx",
    "src/pages/projects/detail/shared.tsx",
    // P1 第二批：pages/canvas + pages/create（红线除外：canvas-prompts / creation-references / creation-assets）
    "src/pages/canvas/index.tsx",
    "src/pages/canvas/project.tsx",
    "src/pages/canvas/shared.tsx",
    "src/pages/canvas/canvas-assistant-panel-column.tsx",
    "src/pages/canvas/canvas-image-generation-executor.ts",
    "src/pages/canvas/canvas-media-generation-executors.ts",
    "src/pages/canvas/canvas-project-context-menu.tsx",
    "src/pages/canvas/canvas-project-feedback.tsx",
    "src/pages/canvas/canvas-project-media-dialogs.tsx",
    "src/pages/canvas/canvas-project-selection-toolbar.tsx",
    "src/pages/canvas/canvas-project-status-dialogs.tsx",
    "src/pages/canvas/canvas-project-top-bar.tsx",
    "src/pages/canvas/canvas-project-world-layers.tsx",
    "src/pages/canvas/canvas-refresh-shell.tsx",
    "src/pages/canvas/canvas-text-generation-executor.ts",
    "src/pages/canvas/components/libtv-import-dialog.tsx",
    "src/pages/canvas/components/tapnow-import-dialog.tsx",
    "src/pages/canvas/use-canvas-active-tasks.ts",
    "src/pages/canvas/use-canvas-agent-operations.ts",
    "src/pages/canvas/use-canvas-assistant-visibility.ts",
    "src/pages/canvas/use-canvas-connection-controller.ts",
    "src/pages/canvas/use-canvas-director.ts",
    "src/pages/canvas/use-canvas-generation-batches.ts",
    "src/pages/canvas/use-canvas-generation-executor.ts",
    "src/pages/canvas/use-canvas-generation-retry.ts",
    "src/pages/canvas/use-canvas-generation.ts",
    "src/pages/canvas/use-canvas-history.ts",
    "src/pages/canvas/use-canvas-keyboard.ts",
    "src/pages/canvas/use-canvas-media-tools.ts",
    "src/pages/canvas/use-canvas-node-editor.ts",
    "src/pages/canvas/use-canvas-node-operations.ts",
    "src/pages/canvas/use-canvas-project-lifecycle.ts",
    "src/pages/canvas/use-canvas-render-model.ts",
    "src/pages/canvas/use-canvas-selection-controller.ts",
    "src/pages/canvas/use-canvas-short-drama.ts",
    "src/pages/canvas/use-canvas-storyboard.ts",
    "src/pages/canvas/use-canvas-style-workflow.ts",
    "src/pages/canvas/use-canvas-upload.ts",
    "src/pages/canvas/use-canvas-viewport-controller.ts",
    "src/pages/canvas/use-canvas-viewport-transition.ts",
    "src/pages/create/index.tsx",
    // P1 第三批：components/canvas（已完成子集；style-picker-modal 为内置画风 prompt 数据待分离，
    // assistant-panel 混有系统指令待甄别，均未列入）
    "src/components/canvas/canvas-drawing-editor-types.ts",
    "src/components/canvas/canvas-leafer-graphics-layer.tsx",
    "src/components/canvas/canvas-mini-map.tsx",
    "src/components/canvas/canvas-node-action-context.ts",
    "src/components/canvas/canvas-node-graph-context.ts",
    "src/components/canvas/canvas-subtitle-overlay.tsx",
    "src/components/canvas/canvas-subtitle-text.tsx",
    "src/components/canvas/canvas-timeline-ruler.tsx",
    "src/components/canvas/infinite-canvas.tsx",
    "src/components/canvas/canvas-node-toolbar.tsx",
    "src/components/canvas/canvas-style-picker-modal.tsx",
    "src/components/canvas/canvas-script-node.tsx",
    "src/components/canvas/style-asset-binding-modal.tsx",
    "src/components/canvas/canvas-timeline-dialog.tsx",
    "src/components/canvas/canvas-video-segment-dialog.tsx",
    "src/components/canvas/canvas-subtitle-dialog.tsx",
    "src/components/canvas/style-profile-editor-modal.tsx",
    "src/components/canvas/canvas-context-menu.tsx",
    "src/components/canvas/canvas-node-content.tsx",
    "src/components/canvas/canvas-config-node-panel.tsx",
    "src/components/canvas/canvas-short-drama-entry.tsx",
    "src/components/canvas/canvas-text-editor-modal.tsx",
    "src/components/canvas/canvas-node-prompt-panel.tsx",
    "src/components/canvas/canvas-project-sidebar.tsx",
    "src/components/canvas/director/director-sequencer.tsx",
    "src/components/canvas/canvas-node-angle-dialog.tsx",
    "src/application.tsx",
    "src/components/ai/ai-message-markdown.tsx",
    "src/components/ai/generation-tool-card.tsx",
    "src/components/ai/message-reasoning.tsx",
    "src/components/asset-media-preview.tsx",
    "src/components/assets/asset-library-card.tsx",
    "src/components/audio-settings-panel.tsx",
    "src/components/auth/auth-session-hydrator.tsx",
    "src/components/auth/require-auth.tsx",
    "src/components/cached-resource-image.tsx",
    "src/components/canvas/asset-picker-modal.tsx",
    "src/components/canvas/canvas-audio-settings-popover.tsx",
    "src/components/canvas/canvas-character-reference-modal.tsx",
    "src/components/canvas/canvas-character-reference-node.tsx",
    "src/components/canvas/canvas-connections.tsx",
    "src/components/canvas/canvas-create-menu.tsx",
    "src/components/canvas/canvas-delete-projects-dialog.tsx",
    "src/components/canvas/canvas-drawing-excalidraw-editor.tsx",
    "src/components/canvas/canvas-drawing-tldraw-editor.tsx",
    "src/components/canvas/canvas-emotion-workspace.tsx",
    "src/components/canvas/canvas-file-drop-overlay.tsx",
    "src/components/canvas/canvas-focus-mode-bar.tsx",
    "src/components/canvas/canvas-folder-card.tsx",
    "src/components/canvas/canvas-folder-preview.tsx",
    "src/components/canvas/canvas-frame-node.tsx",
    "src/components/canvas/canvas-image-settings-popover.tsx",
    "src/components/canvas/canvas-image-toolbar-tools.tsx",
    "src/components/canvas/canvas-node-annotation-dialog.tsx",
    "src/components/canvas/canvas-node-crop-dialog.tsx",
    "src/components/canvas/canvas-node-emotion-panel.tsx",
    "src/components/canvas/canvas-node-mask-edit-dialog.tsx",
    "src/components/canvas/canvas-node-split-dialog.tsx",
    "src/components/canvas/canvas-node-upscale-dialog.tsx",
    "src/components/canvas/canvas-portrait-texture-popover.tsx",
    "src/components/canvas/canvas-preset-picker.tsx",
    "src/components/canvas/canvas-project-card.tsx",
    "src/components/canvas/canvas-resource-mention-textarea.tsx",
    "src/components/canvas/canvas-size-picker.tsx",
    "src/components/canvas/canvas-timeline-preview.tsx",
    "src/components/canvas/canvas-upload-modal.tsx",
    "src/components/canvas/canvas-version-compare-modal.tsx",
    "src/components/canvas/canvas-video-prompt-tools.tsx",
    "src/components/canvas/canvas-video-settings-popover.tsx",
    "src/components/canvas/canvas-workspace-overlays.tsx",
    "src/components/canvas/canvas-zoom-controls.tsx",
    "src/components/canvas/director/canvas-director-node-panel.tsx",
    "src/components/canvas/director/director-viewport-dock.tsx",
    "src/components/canvas/director/director-viewport.tsx",
    "src/components/canvas/nodes/chart-node.tsx",
    "src/components/canvas/nodes/color-grade-node.tsx",
    "src/components/canvas/nodes/compare-node.tsx",
    "src/components/canvas/nodes/html-node.tsx",
    "src/components/canvas/nodes/markdown-node.tsx",
    "src/components/canvas/nodes/panorama-node.tsx",
    "src/components/canvas/nodes/sandboxed-frame.tsx",
    "src/components/canvas/nodes/svg-node.tsx",
    "src/components/canvas/toolbars/toolbar-settings-modal.tsx",
    "src/components/conversation/audio-waveform.tsx",
    "src/components/conversation/index.ts",
    "src/components/conversation/voice-recording-button.tsx",
    "src/components/conversation/voice-recording-inline.tsx",
    "src/components/image-generation-pending.tsx",
    "src/components/image-settings-panel.tsx",
    "src/components/layout/app-changelog-modal.tsx",
    "src/components/layout/app-top-nav.tsx",
    "src/components/layout/client-root-init.tsx",
    "src/components/layout/identity-provider-badge.tsx",
    "src/components/layout/model-setup-guide.tsx",
    "src/components/layout/system-announcement-center.tsx",
    "src/components/layout/user-oss-settings-form.tsx",
    "src/components/layout/workspace-command-palette.tsx",
    "src/components/layout/workspace-page.tsx",
    "src/components/layout/workspace-sidebar-nav.tsx",
    "src/components/layout/workspace-sidebar-state.ts",
    "src/components/layout/workspace-state.tsx",
    "src/components/layout/workspace-top-bar.tsx",
    "src/components/media-preview.tsx",
    "src/components/model-capability-editor.tsx",
    "src/components/model-logo.tsx",
    "src/components/model-protocol-picker.tsx",
    "src/components/prompt/prompt-code-editor.tsx",
    "src/components/ui/aceternity/comet-card.tsx",
    "src/components/ui/aceternity/floating-dock.tsx",
    "src/components/ui/aceternity/full-screen-loader.tsx",
    "src/components/ui/aceternity/spotlight-surface.tsx",
    "src/components/ui/aceternity/workspace-signal-icon.tsx",
    "src/components/ui/animated-theme-toggler.tsx",
    "src/components/ui/announcement-content.tsx",
    "src/components/ui/dia-text-reveal.tsx",
    "src/components/video-player.tsx",
    "src/components/video-settings-panel.tsx",
    "src/constant/credits.tsx",
    "src/hooks/use-copy-text.ts",
    "src/hooks/use-debounced-value.ts",
    "src/hooks/use-external-asset-sources.ts",
    "src/hooks/use-focus-mode.ts",
    "src/hooks/use-speech-recognition.ts",
    "src/hooks/use-voice-recording.ts",
    "src/hooks/use-wallet-balance.ts",
    "src/hooks/use-workspace-logout.ts",
    "src/i18n/detect.ts",
    "src/i18n/index.ts",
    "src/layouts/user-layout.tsx",
    "src/lib/aceternity-motion.ts",
    "src/lib/app-theme.ts",
    "src/lib/asset-storage-revision.ts",
    "src/lib/audio-generation.ts",
    "src/lib/canvas-theme.ts",
    "src/lib/canvas/canvas-aceternity-style.ts",
    "src/lib/canvas/canvas-agent-session.ts",
    "src/lib/canvas/canvas-asset-handoff.ts",
    "src/lib/canvas/canvas-batch-connection.ts",
    "src/lib/canvas/canvas-color-grade.ts",
    "src/lib/canvas/canvas-connection-policy.ts",
    "src/lib/canvas/canvas-drawing-engine.ts",
    "src/lib/canvas/canvas-drawing-excalidraw-document.ts",
    "src/lib/canvas/canvas-drawing-storage.ts",
    "src/lib/canvas/canvas-drawing-tldraw-document.ts",
    "src/lib/canvas/canvas-export.ts",
    "src/lib/canvas/canvas-face-detection.ts",
    "src/lib/canvas/canvas-face-detector.worker.ts",
    "src/lib/canvas/canvas-frame.ts",
    "src/lib/canvas/canvas-generation-layout.ts",
    "src/lib/canvas/canvas-generation-task-sync.ts",
    "src/lib/canvas/canvas-image-batch-retry.ts",
    "src/lib/canvas/canvas-image-data.ts",
    "src/lib/canvas/canvas-layout.ts",
    "src/lib/canvas/canvas-leafer-viewport.ts",
    "src/lib/canvas/canvas-live-viewport.ts",
    "src/lib/canvas/canvas-media-versions.ts",
    "src/lib/canvas/canvas-node-asset.ts",
    "src/lib/canvas/canvas-node-copy.ts",
    "src/lib/canvas/canvas-node-size.ts",
    "src/lib/canvas/canvas-performance-mode.ts",
    "src/lib/canvas/canvas-rich-text.ts",
    "src/lib/canvas/canvas-short-drama.ts",
    "src/lib/canvas/canvas-storage-revision.ts",
    "src/lib/canvas/canvas-storyboard-layout.ts",
    "src/lib/canvas/canvas-storyboard-progress.ts",
    "src/lib/canvas/canvas-video-frame.ts",
    "src/lib/canvas/canvas-video-regeneration.ts",
    "src/lib/canvas/canvas-video-segment-args.ts",
    "src/lib/canvas/canvas-video-segment.ts",
    "src/lib/canvas/canvas-viewport.ts",
    "src/lib/canvas/libtv-import.ts",
    "src/lib/canvas/local-runtime-connection.ts",
    "src/lib/canvas/node-registry/definitions/builtin-nodes.tsx",
    "src/lib/canvas/node-registry/definitions/index.ts",
    "src/lib/canvas/node-registry/index.ts",
    "src/lib/canvas/node-registry/node-definition.ts",
    "src/lib/canvas/node-registry/node-registry.ts",
    "src/lib/canvas/project-chapter-storyboard.ts",
    "src/lib/canvas/resource-storage-status.ts",
    "src/lib/canvas/tapnow-import.ts",
    "src/lib/canvas/tool-registry/definitions/add-node-menu-tools.tsx",
    "src/lib/canvas/tool-registry/definitions/index.ts",
    "src/lib/canvas/tool-registry/definitions/node-hover-tools.tsx",
    "src/lib/canvas/tool-registry/definitions/selection-toolbar-tools.tsx",
    "src/lib/canvas/tool-registry/index.ts",
    "src/lib/canvas/tool-registry/tool-definition.ts",
    "src/lib/canvas/tool-registry/tool-persistence.ts",
    "src/lib/canvas/tool-registry/tool-registry.ts",
    "src/lib/channel-model-catalog.ts",
    "src/lib/client-id.ts",
    "src/lib/creation-text-replay.ts",
    "src/lib/desktop-local-channel.ts",
    "src/lib/format-locale.ts",
    "src/lib/gemini-image.ts",
    "src/lib/generation-task-display.ts",
    "src/lib/grok-image-prompt-limit.ts",
    "src/lib/image-resolution-tiers.ts",
    "src/lib/localforage-storage.ts",
    "src/lib/model-capabilities.ts",
    "src/lib/model-connection-test.ts",
    "src/lib/model-protocols.ts",
    "src/lib/openai-prompt-cache.ts",
    "src/lib/plugins/builtin/eagle.ts",
    "src/lib/plugins/builtin/index.ts",
    "src/lib/plugins/plugin-registry.ts",
    "src/lib/plugins/plugin-storage.ts",
    "src/lib/plugins/plugin-types.ts",
    "src/lib/query-client.ts",
    "src/lib/settings-navigation.ts",
    "src/lib/timeline/srt-parser.ts",
    "src/lib/timeline/srt-resegment.ts",
    "src/lib/timeline/subtitle-highlight-runner.ts",
    "src/lib/timeline/subtitle-highlight-service.ts",
    "src/lib/timeline/subtitle-highlights.ts",
    "src/lib/timeline/timeline-build.ts",
    "src/lib/timeline/timeline-placement.ts",
    "src/lib/timeline/timeline-snap.ts",
    "src/lib/timeline/timeline-tracks.ts",
    "src/lib/timeline/timeline-view.ts",
    "src/lib/user-scope.ts",
    "src/lib/user-session.ts",
    "src/lib/utils.ts",
    "src/lib/video-generation-options.ts",
    "src/lib/workspace-route-modules.ts",
    "src/lib/workspace-routes.ts",
    "src/lib/zip.ts",
    "src/main.tsx",
    "src/pages/admin/admin-context.tsx",
    "src/pages/admin/admin-route-pages.tsx",
    "src/pages/admin/components/access-settings-panel.tsx",
    "src/pages/admin/components/admin-shell.tsx",
    "src/pages/admin/components/admin-ui.tsx",
    "src/pages/admin/components/email-settings-panel.tsx",
    "src/pages/admin/index.tsx",
    "src/pages/admin/lib/use-table-url-state.ts",
    "src/pages/admin/redemption-codes/redemption-codes-page.tsx",
    "src/pages/admin/settings/drawing-engine-settings-page.tsx",
    "src/pages/admin/settings/libtv-settings-page.tsx",
    "src/pages/admin/users/users-page.tsx",
    "src/pages/assets/asset-transfer.ts",
    "src/pages/canvas/canvas-generation-executor-types.ts",
    "src/pages/create/creation-assets.test.ts",
    "src/pages/plugins/eagle.tsx",
    "src/pages/plugins/index.tsx",
    "src/pages/settings/index.tsx",
    "src/pages/settings/model-default-grid.tsx",
    "src/pages/settings/prompt-preferences-pane.tsx",
    "src/pages/skills/skill-catalog.ts",
    "src/pages/skills/skill-editor-drawer.tsx",
    "src/pages/tasks/task-grid-card.tsx",
    "src/pages/tasks/task-group-header.tsx",
    "src/pages/tasks/task-list-row.tsx",
    "src/pages/tasks/task-shared.tsx",
    "src/pages/tasks/task-status-filter.tsx",
    "src/services/api/announcements.ts",
    "src/services/api/audio.ts",
    "src/services/api/auth.ts",
    "src/services/api/canvas-share.ts",
    "src/services/api/custom-channel-relay.ts",
    "src/services/api/eagle.ts",
    "src/services/api/generation-task.ts",
    "src/services/api/image-contracts.ts",
    "src/services/api/image-models.ts",
    "src/services/api/image-protocols.ts",
    "src/services/api/image-response.ts",
    "src/services/api/image-streaming.ts",
    "src/services/api/image-transport.ts",
    "src/services/api/image-validation.ts",
    "src/services/api/libtv.ts",
    "src/services/api/logical-models.ts",
    "src/services/api/project-agent-tools.ts",
    "src/services/api/projects.ts",
    "src/services/api/request.ts",
    "src/services/api/resources.ts",
    "src/services/api/response-interception.ts",
    "src/services/api/skills.ts",
    "src/services/api/style-profiles.ts",
    "src/services/api/tapnow.ts",
    "src/services/api/user-data.ts",
    "src/services/api/video-contracts.ts",
    "src/services/api/video-provider-deps.ts",
    "src/services/api/video-provider-gemini.ts",
    "src/services/api/video-provider-minimax.ts",
    "src/services/api/video-provider-newapi.ts",
    "src/services/api/video-provider-novita.ts",
    "src/services/api/video-provider-openai.ts",
    "src/services/api/video-response.ts",
    "src/services/api/video-transport.ts",
    "src/services/api/video-validation.ts",
    "src/services/api/wallet.ts",
    "src/services/canvas-generation-consumer.ts",
    "src/services/creation-conversation-store.ts",
    "src/services/creation-text-task-recovery.ts",
    "src/services/external-asset-sources.ts",
    "src/services/file-storage.ts",
    "src/services/generation-artifact-sink.ts",
    "src/services/generation-asset-repository.ts",
    "src/services/generation-consumer-dedupe.ts",
    "src/services/generation-consumer-lifecycle.ts",
    "src/services/generation-task-materializer.ts",
    "src/services/image-storage.ts",
    "src/services/local-dreamina-cli.ts",
    "src/services/local-dreamina-generation.ts",
    "src/services/local-dreamina-model-catalog.ts",
    "src/services/local-dreamina-task-projection.ts",
    "src/services/local-runtime-bootstrap.ts",
    "src/services/local-runtime-session.ts",
    "src/services/local-runtime.ts",
    "src/services/provider-neutral-generation-effects.ts",
    "src/services/resource-blob-cache.ts",
    "src/services/user-data-sync.ts",
    "src/stores/canvas/use-canvas-store.ts",
    "src/stores/canvas/use-canvas-ui-store.ts",
    "src/stores/canvas/use-director-workbench-store.ts",
    "src/stores/use-asset-store.ts",
    "src/stores/use-local-dreamina-model-store.ts",
    "src/stores/use-local-runtime-store.ts",
    "src/stores/use-locale-store.ts",
    "src/stores/use-plugin-store.ts",
    "src/stores/use-theme-store.ts",
    "src/stores/use-user-store.ts",
    "src/types/canvas-export.ts",
    "src/types/canvas.ts",
    "src/types/director.ts",
    "src/types/image.ts",
    "src/types/media.ts",
    "src/types/timeline.ts",
    "src/vite-env.d.ts",
];

/** 允许硬编码 locale 字面量的文件（locale 标签的唯一数据源） */
const LOCALE_LITERAL_ALLOWLIST = [
    "src/lib/format-locale.ts",
    // tldraw 的 locale 参数接收 tldraw 自己的语言代码（"zh-cn"），不是 Intl 标签；与 Intl 格式化无关
    "src/components/canvas/canvas-drawing-tldraw-editor.tsx",
];

/** prompt 词表黑名单：这些目录里的中文是送进模型的协议词汇，禁止引入 i18n */
const PROMPT_BLACKLIST_DIRS = ["src/lib/canvas/director"];
/** 单文件级黑名单：中文是送模型词汇或按文本匹配后端的协议数据 */
const PROMPT_BLACKLIST_FILES = [
];

// ---------- 工具 ----------

type FlatCatalog = Map<string, string>;

function flatten(value: unknown, prefix: string, out: FlatCatalog): void {
    if (value === null || typeof value !== "object") {
        out.set(prefix, String(value));
        return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
}

function loadCatalog(lang: string, ns: string): FlatCatalog {
    const path = join(LOCALES_DIR, lang, `${ns}.json`);
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const flat: FlatCatalog = new Map();
    flatten(parsed, "", flat);
    return flat;
}

/**
 * 去注释状态机（保留字符串内容）：逐字符扫描，字符串内的 "//"、"/*"、引号不参与状态转移。
 * 不用正则的原因见盘点结论——printWidth 255 的密集单行会让 "[^"]*" 把两个无关字符串配成一对。
 */
function stripComments(code: string): string {
    let out = "";
    let state: "code" | "line" | "block" | "quote" = "code";
    let quote = "";
    for (let i = 0; i < code.length;) {
        const c = code[i]!;
        const n = code[i + 1] ?? "";
        if (state === "code") {
            if (c === "/" && n === "/") {
                state = "line";
                i += 2;
                continue;
            }
            if (c === "/" && n === "*") {
                state = "block";
                i += 2;
                continue;
            }
            if (c === '"' || c === "'" || c === "`") {
                state = "quote";
                quote = c;
            }
            out += c;
            i += 1;
            continue;
        }
        if (state === "line") {
            if (c === "\n") {
                state = "code";
                out += c;
            }
            i += 1;
            continue;
        }
        if (state === "block") {
            if (c === "*" && n === "/") {
                state = "code";
                i += 2;
                continue;
            }
            i += 1;
            continue;
        }
        // quote：转义原样保留；字符串内容（含中文）保留待检
        if (c === "\\") {
            out += code.slice(i, i + 2);
            i += 2;
            continue;
        }
        out += c;
        i += 1;
        if (c === quote) state = "code";
    }
    return out;
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

function placeholders(text: string): Set<string> {
    return new Set([...text.matchAll(PLACEHOLDER_RE)].map((match) => match[1]!));
}

function walkSourceFiles(dir: string): string[] {
    const result: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) result.push(...walkSourceFiles(full));
        else if (/\.(ts|tsx)$/.test(entry)) result.push(full);
    }
    return result;
}

// ---------- 用例 ----------

const catalogs = new Map<string, FlatCatalog>();
for (const lang of LANGS) {
    for (const ns of NAMESPACES) catalogs.set(`${lang}:${ns}`, loadCatalog(lang, ns));
}

describe("i18n catalog", () => {
    test("en 与 zh-CN 的 namespace 文件一一对应且 key 集合一致", () => {
        for (const ns of NAMESPACES) {
            const zh = catalogs.get(`zh-CN:${ns}`)!;
            const en = catalogs.get(`en:${ns}`)!;
            const zhKeys = [...zh.keys()].sort();
            const enKeys = [...en.keys()].sort();
            expect(enKeys).toEqual(zhKeys);
        }
    });

    test("插值占位符两种语言一致", () => {
        for (const ns of NAMESPACES) {
            const [zh, en] = [catalogs.get(`zh-CN:${ns}`)!, catalogs.get(`en:${ns}`)!];
            for (const [key, value] of zh) {
                expect([...placeholders(value)].sort()).toEqual([...placeholders(en.get(key) ?? "")].sort());
            }
        }
    });

    test("复数后缀成对完整：_one/_other 在两种语言中同构", () => {
        // 跨语言同构：一边出现复数键，另一边必须也有同 base 的复数键
        const zhBases = pluralBases("zh-CN", NAMESPACES, catalogs);
        const enBases = pluralBases("en", NAMESPACES, catalogs);
        expect([...enBases].sort()).toEqual([...zhBases].sort());
        // 出现任一复数后缀就必须 _one/_other 齐全（英文复数规则要求）
        for (const lang of LANGS) {
            const suffixesByBase = new Map<string, Set<string>>();
            for (const ns of NAMESPACES) {
                for (const key of catalogs.get(`${lang}:${ns}`)!.keys()) {
                    const match = key.match(/^(.*)(_one|_other)$/);
                    if (!match) continue;
                    const bucket = suffixesByBase.get(match[1]!) ?? new Set<string>();
                    bucket.add(match[2]!);
                    suffixesByBase.set(match[1]!, bucket);
                }
            }
            for (const [base, suffixes] of suffixesByBase) {
                expect(suffixes.has("_one"), `${lang} ${base} 缺 _one`).toBe(true);
                expect(suffixes.has("_other"), `${lang} ${base} 缺 _other`).toBe(true);
            }
        }
    });
});

function pluralBases(lang: string, namespaces: readonly string[], catalogs: Map<string, FlatCatalog>): Set<string> {
    const bases = new Set<string>();
    for (const ns of namespaces) {
        for (const key of catalogs.get(`${lang}:${ns}`)!.keys()) {
            const match = key.match(/^(.*)(_one|_other)$/);
            if (match) bases.add(match[1]);
        }
    }
    return bases;
}

describe("migrated source files", () => {
    test("已迁移文件无中文残留（注释除外）", () => {
        for (const rel of MIGRATED_FILES) {
            const full = join(WEB_ROOT, rel);
            expect(existsSync(full), `${rel} 不存在，请从 MIGRATED_FILES 移除或修正路径`).toBe(true);
            const stripped = stripComments(readFileSync(full, "utf8"));
            const found = stripped.split("\n").filter((line) => CJK_RE.test(line));
            expect(found, `${rel} 存在未迁移中文：\n${found.join("\n")}`).toEqual([]);
        }
    });

    test("t() 引用的静态 key 必须存在于 catalog（动态模板串跳过）", () => {
        const knownKeys = new Set<string>();
        for (const lang of LANGS) {
            for (const ns of NAMESPACES) {
                for (const key of catalogs.get(`${lang}:${ns}`)!.keys()) knownKeys.add(`${ns}.${key}`);
            }
        }
        for (const rel of MIGRATED_FILES) {
            const source = readFileSync(join(WEB_ROOT, rel), "utf8");
            const namespaces = [...source.matchAll(/useTranslation\(\s*\[?\s*["']([\w-]+)["']/g)].map((m) => m[1]!);
            const calls = [...source.matchAll(/\bt\(\s*(["'])((?:(?!\1).)+)\1/g)].map((m) => m[2]!);
            for (const rawKey of calls) {
                if (rawKey.includes("${")) continue; // 动态 key 无法静态解析，靠 catalog 对账兜底
                const normalized = rawKey.includes(":") ? rawKey.replace(":", ".") : `${namespaces[0] ?? "common"}.${rawKey}`;
                expect(knownKeys.has(normalized), `${rel} 引用了不存在的 key: ${rawKey}`).toBe(true);
            }
        }
    });

    test("已迁移文件不得新增硬编码 locale 字面量（格式化走 lib/format-locale）", () => {
        // 只禁「格式化 API 首参传入的硬编码 locale」；"zh-CN"/"en" 作为 LocaleName 判别值仍属合法使用，
        // 所以正则锚定格式化调用（toLocale*/localeCompare/Intl.*Format）而不是裸字面量——
        // 判别值形态（locale === "zh-CN"）天然不匹配，allowlist 内第三方代码（如 tldraw）也不受影响
        const intlLiteralRe =
            /\.(?:toLocaleString|toLocaleDateString|toLocaleTimeString|toLocaleLowerCase|toLocaleUpperCase|localeCompare)\(\s*["'](zh-cn|zh-CN|zh_TW|zh-tw|zh_CN|en-US|en-GB|en)["']|Intl\.(?:NumberFormat|DateTimeFormat)\(\s*["'](zh-cn|zh-CN|zh_TW|zh-tw|zh_CN|en-US|en-GB|en)["']/g;
        for (const rel of MIGRATED_FILES) {
            // 白名单文件承载合法的第三方 locale 判别值（如 tldraw 的 "zh-cn" 语言代码）
            if (LOCALE_LITERAL_ALLOWLIST.includes(rel)) continue;
            const stripped = stripComments(readFileSync(join(WEB_ROOT, rel), "utf8"));
            const hits = [...stripped.matchAll(intlLiteralRe)].map((m) => m[0]);
            expect(hits, `${rel} 出现硬编码 Intl locale，请改用 formatLocale() 或将判定值收进 allowlist`).toEqual([]);
        }
        // LocaleSwitcher 必须仍以这两个判别值作为选项（防止被误改成 Intl 标签）
        const switcher = stripComments(readFileSync(join(WEB_ROOT, "src/components/layout/locale-switcher.tsx"), "utf8"));
        expect(switcher.includes('"zh-CN"')).toBe(true);
        expect(switcher.includes('"en"')).toBe(true);
    });
});

describe("prompt blacklist", () => {
    test("prompt 词表目录禁止引入 i18n（UI 翻译不得污染送模型的词汇）", () => {
        const forbidden = [/from\s+["']@\/i18n/, /from\s+["']react-i18next["']/, /\bi18next\b/];
        for (const fileRel of PROMPT_BLACKLIST_FILES) {
            const file = join(WEB_ROOT, fileRel);
            expect(existsSync(file)).toBe(true);
            const source = readFileSync(file, "utf8");
            for (const re of forbidden) {
                expect(re.test(source), `${file} 引入了 i18n，prompt 词表不得跟随界面语言`).toBe(false);
            }
        }
        for (const dirRel of PROMPT_BLACKLIST_DIRS) {
            const dir = join(SRC_DIR, dirRel.replace(/^src\//, ""));
            expect(existsSync(dir)).toBe(true);
            for (const file of walkSourceFiles(dir)) {
                const source = readFileSync(file, "utf8");
                for (const re of forbidden) {
                    expect(re.test(source), `${file} 引入了 i18n，prompt 词表不得跟随界面语言`).toBe(false);
                }
            }
        }
    });
});
