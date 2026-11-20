// 画布 Agent 对话附件：类型定义与「附件 → @ 引用」转换。
//
// 输入区（composer）与消息渲染（chat-ui）都依赖它，单独成模块以避免两者互相 import。
// 在画布里附件就是画布节点（nodeId），引用写成节点令牌；没有 nodeId 的旧附件仍用 @[attachment:ID]。
import { translate } from "@/i18n";
import { canvasNodeMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { AgentAttachmentStatus } from "@/lib/canvas/agent-composer-attachments";
export type CloudAgentChatAttachment = {
    id: string;
    name: string;
    url: string;
    /** 对应的画布节点；有它时附件以节点引用发出。 */
    nodeId?: string;
    kind?: "image" | "text" | "video" | "audio";
    status?: AgentAttachmentStatus | "missing";
    progress?: number;
    error?: string;
    /** 失败后还留着原文件，可以重新上传。 */
    retryable?: boolean;
};
/** 附件引用候选，编号按附件顺序从「图片1」开始；画布节点出现后由画布引用（同一 ID）取代。 */
export function agentAttachmentReferences(attachments: CloudAgentChatAttachment[]): CanvasResourceReference[] {
    return attachments.map((item, index) =>
        item.nodeId
            ? {
                  id: item.nodeId,
                  nodeId: item.nodeId,
                  kind: item.kind === "text" ? "text" : item.kind === "video" ? "video" : item.kind === "audio" ? "audio" : "image",
                  label: item.name || translate("canvasA.attachments.imageLabel", { index: index + 1 }),
                  title: item.name || translate("canvasA.attachments.imageLabel", { index: index + 1 }),
                  previewUrl: item.url || undefined,
                  active: true,
                  mentionToken: canvasNodeMentionToken(item.nodeId),
              }
            : {
                  id: `attachment:${item.id}`,
                  nodeId: "",
                  kind: "image",
                  label: translate("canvasA.attachments.imageLabel", { index: index + 1 }),
                  title: item.name || translate("canvasA.attachments.imageLabel", { index: index + 1 }),
                  previewUrl: item.url,
                  active: true,
                  mentionToken: `@[attachment:${item.id}]`,
              },
    );
}
