export function selectAssetIds(current: string[], visibleIds: string[], id: string, selected: boolean, anchorId?: string): string[] {
    const anchor = anchorId ? visibleIds.indexOf(anchorId) : -1;
    const target = visibleIds.indexOf(id);
    const affected = new Set(anchor >= 0 && target >= 0 ? visibleIds.slice(Math.min(anchor, target), Math.max(anchor, target) + 1) : [id]);
    return selected ? [...new Set([...current, ...affected])] : current.filter((value) => !affected.has(value));
}
