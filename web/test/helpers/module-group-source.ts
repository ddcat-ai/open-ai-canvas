// 源码约束测试的读取辅助：大文件按职责拆分后，约束应覆盖原文件及其拆分出的同组模块。
//
// 用法：moduleGroupSource("pages/assets/index.tsx") 返回原文件与同组模块拼接后的文本。
// 只在「源码断言」类测试里使用；行为测试请直接 import 模块。

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 原文件（相对 src）到拆分出的同组模块。新增拆分时在这里登记。 */
export const SPLIT_MODULE_GROUPS: Record<string, readonly string[]> = {
    "components/canvas/canvas-cloud-agent-panel.tsx": ["components/canvas/canvas-cloud-agent-panel-parts.tsx", "components/canvas/canvas-cloud-agent-events.ts"],
    "components/canvas/canvas-cloud-agent-chat-ui.tsx": ["components/canvas/canvas-cloud-agent-composer.tsx", "components/canvas/canvas-cloud-agent-attachments.ts"],
    "components/canvas/art-critique/ai-art-critique-modal.tsx": ["components/canvas/art-critique/ai-art-critique-report.tsx"],
    "components/canvas/canvas-resource-mention-textarea.tsx": ["components/canvas/canvas-mention-chips.tsx", "components/canvas/canvas-mention-editable.ts", "components/canvas/canvas-mention-menu.tsx"],
    "components/canvas/canvas-node-content.tsx": ["components/canvas/canvas-node-media-content.tsx", "components/canvas/canvas-node-status-content.tsx"],
    "components/canvas/canvas-node-prompt-panel.tsx": ["components/canvas/canvas-node-prompt-config.ts", "components/canvas/canvas-node-prompt-references.tsx", "components/canvas/canvas-node-prompt-resize.tsx"],
    "components/canvas/canvas-script-node.tsx": ["components/canvas/canvas-script-node-parts.tsx"],
    "lib/art-critique/pipeline.ts": ["lib/art-critique/pipeline-messages.ts", "lib/art-critique/pipeline-parse.ts"],
    "lib/model-capabilities.ts": ["lib/model-capabilities-workflow.ts"],
    "pages/admin/components/admin-announcements-panel.tsx": ["pages/admin/components/admin-announcement-editor.tsx", "pages/admin/components/admin-announcement-results.ts"],
    "pages/admin/components/redemption-codes-panel.tsx": ["pages/admin/components/redemption-codes-modals.tsx"],
    "pages/admin/settings/appearance-settings-page.tsx": ["pages/admin/settings/appearance-settings-parts.tsx"],
    "pages/admin/settings/storage-settings-page.tsx": ["pages/admin/settings/storage-settings-model.ts"],
    "pages/assets/index.tsx": ["pages/assets/asset-library-cards.tsx", "pages/assets/asset-library-format.ts", "pages/assets/asset-library-panels.tsx"],
    "components/canvas/previs/canvas-previs-workbench.tsx": ["components/canvas/previs/previs-inspectors.tsx"],
    "pages/canvas/project.tsx": ["pages/canvas/canvas-clipboard.ts"],
    "pages/create/creation-workspace.tsx": ["pages/create/creation-workspace-empty.tsx", "pages/create/creation-workspace-history.tsx", "pages/create/creation-workspace-messages.tsx"],
    "services/user-data-sync.ts": ["services/user-data-sync-media.ts"],
    "stores/use-config-store.ts": ["stores/config-model-options.ts", "stores/config-workflow-fields.ts"],
};

const srcRoot = resolve(import.meta.dir, "../../src");

/** 读取 src 下的文件；若它被拆分过，一并读取同组模块。 */
export function moduleGroupSource(relativePath: string): string {
    const normalized = relativePath.replace(/^(\.\.\/)*src\//, "").replace(/^\.\//, "");
    const files = [normalized, ...(SPLIT_MODULE_GROUPS[normalized] ?? [])];
    return files.map((file) => readFileSync(resolve(srcRoot, file), "utf8")).join("\n");
}
