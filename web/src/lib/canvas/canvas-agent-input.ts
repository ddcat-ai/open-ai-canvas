import { canvasNodeMentionToken, canvasResourceMentionToken, type CanvasResourceReference } from "./canvas-resource-references";
import type { Asset } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasAssistantReference, type CanvasNodeData } from "@/types/canvas";

export function canvasNodeToAssistantReference(node: CanvasNodeData): CanvasAssistantReference | null {
    if (![CanvasNodeType.Image, CanvasNodeType.Text, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Drawing, CanvasNodeType.Skill].includes(node.type as CanvasNodeType)) return null;
    const base = { id: node.id, type: node.type as CanvasNodeType, title: node.title, storageKey: node.metadata?.storageKey };
    if (node.type === CanvasNodeType.Image) return { ...base, dataUrl: node.metadata?.content, text: node.metadata?.prompt };
    if (node.type === CanvasNodeType.Skill && node.metadata?.skillSnapshot) {
        const skill = node.metadata.skillSnapshot;
        return { ...base, text: [skill.name, skill.template, skill.outputContract].filter(Boolean).join("\n\n") };
    }
    const content = node.type === CanvasNodeType.Text ? node.metadata?.content : undefined;
    return { ...base, text: [content, node.metadata?.prompt, node.metadata?.composerContent].filter(Boolean).join("\n\n") };
}

// Resolve the same serialized tokens that the rich editor inserts. Node IDs
// survive canvas reordering; legacy labels must match a complete label.
export function collectAgentMentionReferences(prompt: string, references: CanvasResourceReference[], nodes: CanvasNodeData[], assets: Asset[]): CanvasAssistantReference[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    return references.flatMap((reference) => {
        if (reference.kind === "skill") return [];
        const escapedLabel = reference.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const token = canvasResourceMentionToken(reference);
        const mentioned = (token.startsWith("@[") && prompt.includes(token)) || (reference.nodeId && prompt.includes(canvasNodeMentionToken(reference.nodeId))) || (!reference.assetId && new RegExp(`@${escapedLabel}(?![\\p{L}\\p{N}_])`, "u").test(prompt));
        if (!mentioned) return [];
        if (reference.assetId) {
            const asset = assetById.get(reference.assetId);
            if (!asset || asset.kind === "model") return [];
            return [{
                id: reference.id,
                type: asset.kind === "image" ? CanvasNodeType.Image : asset.kind === "video" ? CanvasNodeType.Video : asset.kind === "audio" ? CanvasNodeType.Audio : CanvasNodeType.Text,
                title: asset.title,
                storageKey: "storageKey" in asset.data ? asset.data.storageKey : undefined,
                dataUrl: asset.kind === "image" ? asset.data.dataUrl : undefined,
                text: asset.kind === "text" ? asset.data.content : asset.kind === "entity" ? JSON.stringify(asset.data.definition) : asset.note,
            } satisfies CanvasAssistantReference];
        }
        const node = nodeById.get(reference.nodeId);
        const result = node ? canvasNodeToAssistantReference(node) : null;
        return result ? [result] : [];
    });
}

export function agentSlashQuery(value: string) {
    const match = /(^|\s)\/([^\s/]*)$/.exec(value);
    return match ? { start: match.index + match[1].length, query: match[2] } : null;
}

export function insertAgentSkill(value: string, slash: { start: number; query: string } | null, skillId: string, skillName?: string) {
    const token = skillName ? `/${skillName} ` : `@[skill:${skillId}] `;
    return slash ? `${value.slice(0, slash.start)}${token}${value.slice(slash.start + slash.query.length + 1).replace(/^\s+/u, "")}` : `${value.trimEnd()}${value.trim() ? " " : ""}${token}`;
}
