import type { CanvasNodeMetadata } from "@/types/canvas";

export type CanvasAudioVoiceBinding = { characterNodeId: string; audioNodeId: string };

export function normalizeCanvasAudioVoiceBindings(value: unknown): CanvasAudioVoiceBinding[] {
    if (!Array.isArray(value)) return [];
    const characters = new Set<string>();
    return value.flatMap((item): CanvasAudioVoiceBinding[] => {
        if (!item || typeof item !== "object") return [];
        const candidate = item as Record<string, unknown>;
        const characterNodeId = typeof candidate.characterNodeId === "string" ? candidate.characterNodeId.trim() : "";
        const audioNodeId = typeof candidate.audioNodeId === "string" ? candidate.audioNodeId.trim() : "";
        if (!characterNodeId || !audioNodeId || characterNodeId === audioNodeId || characters.has(characterNodeId)) return [];
        characters.add(characterNodeId);
        return [{ characterNodeId, audioNodeId }];
    });
}

export function canvasAudioVoiceBindings(metadata: CanvasNodeMetadata | undefined) {
    return normalizeCanvasAudioVoiceBindings(metadata?.audioVoiceBindings);
}

export function compileCanvasAudioVoiceBindings(prompt: string, bindings: CanvasAudioVoiceBinding[], references: Array<{ nodeId: string; kind: string; title?: string; label: string }>) {
    const blocks = bindings.map((binding) => {
        const character = references.find((reference) => reference.nodeId === binding.characterNodeId && reference.kind === "character");
        const audio = references.find((reference) => reference.nodeId === binding.audioNodeId && reference.kind === "audio");
        if (!character || !audio) throw new Error("角色或参考音频连接已变化，请在音频设置中重新确认对应关系");
        return `【角色音色对应】${character.title || character.label} → @${audio.label}`;
    });
    if (!blocks.length) return prompt;
    const basePrompt = prompt.replace(/\n*【角色音色对应】[^\n]*/g, "").trim();
    return `${basePrompt}\n\n${blocks.join("\n")}`;
}
