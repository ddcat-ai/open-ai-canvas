// 画布 Agent 对话附件：类型定义与「附件 → @ 引用」转换。
//
// 输入区（composer）与消息渲染（chat-ui）都依赖它，单独成模块以避免两者互相 import。

import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type CloudAgentChatAttachment = { id: string; name: string; url: string };

/** 附件以 @[attachment:<id>] 引用进入提示词，编号按附件顺序从「图片1」开始。 */
export function agentAttachmentReferences(attachments: CloudAgentChatAttachment[]): CanvasResourceReference[] {
    return attachments.map((item, index) => ({
        id: `attachment:${item.id}`,
        nodeId: "",
        kind: "image",
        label: `图片${index + 1}`,
        title: item.name || `图片${index + 1}`,
        previewUrl: item.url,
        active: true,
        mentionToken: `@[attachment:${item.id}]`,
    }));
}
