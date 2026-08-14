export type GenerationEffectStamped = {
    generationEffectKeys?: string[];
};

export function generationEffectApplied(target: GenerationEffectStamped, effectKey: string | undefined): boolean {
    return Boolean(effectKey && target.generationEffectKeys?.includes(effectKey));
}

export function applyGenerationConsumerEffect<T extends GenerationEffectStamped>(target: T, effectKey: string, apply: (current: T) => T): { value: T; applied: boolean } {
    if (generationEffectApplied(target, effectKey)) return { value: target, applied: false };
    const value = apply(target);
    return {
        value: {
            ...value,
            generationEffectKeys: [...new Set([...(value.generationEffectKeys || []), effectKey])],
        },
        applied: true,
    };
}
