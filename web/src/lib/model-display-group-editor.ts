import type { ModelDisplayGroup, ModelDisplayCollection } from "@/services/api/model-display-groups";

export function moveDisplayItem<T>(items: T[], from: number, to: number): T[] {
    if (!Number.isInteger(to) || from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
}

export function moveDisplayGroupByDrop(groups: ModelDisplayGroup[], sourceId: string, targetId: string, before: boolean): ModelDisplayGroup[] {
    const from = groups.findIndex((group) => group.id === sourceId);
    const target = groups.findIndex((group) => group.id === targetId);
    if (from < 0 || target < 0 || from === target) return groups;
    let to = target + (before ? 0 : 1);
    if (from < to) to -= 1;
    return moveDisplayItem(groups, from, to);
}

export function assignDisplayMembers(groups: ModelDisplayGroup[], ids: string[], destination: string): ModelDisplayGroup[] {
    if (destination && !groups.some((group) => group.id === destination)) return groups;
    const moving = new Set(ids);
    return groups.map((group) => {
        // Members already in the destination retain their positions.
        if (group.id === destination) {
            const existing = new Set(group.modelIds);
            return { ...group, modelIds: [...group.modelIds, ...[...moving].filter((id) => !existing.has(id))] };
        }
        return { ...group, modelIds: group.modelIds.filter((id) => !moving.has(id)), ...(group.collections ? { collections: group.collections.map((collection) => ({ ...collection, members: collection.members.filter((member) => !moving.has(member.modelId)) })) } : {}) };
    });
}

export function assignCollectionMembers(groups: ModelDisplayGroup[], ids: string[], groupId: string, collectionId: string, resolutions: Record<string, string>): ModelDisplayGroup[] {
    const destination = groups.find((group) => group.id === groupId);
    if (!destination || (collectionId && !destination.collections?.some((collection) => collection.id === collectionId))) return groups;
    const moving = new Set(ids);
    return assignDisplayMembers(groups, ids, groupId).map((group) => ({
        ...group,
        ...(group.collections ? { collections: group.collections.map((collection) => {
            const members = collection.members.filter((member) => !moving.has(member.modelId));
            if (group.id === groupId && collection.id === collectionId) members.push(...[...moving].map((modelId) => ({ modelId, resolution: collection.members.find((member) => member.modelId === modelId)?.resolution || resolutions[modelId] || "" })));
            return { ...collection, members };
        }) } : {}),
    }));
}

export function displayGroupEntries(group: ModelDisplayGroup): Array<{ key: string; modelIds: string[]; collection?: ModelDisplayCollection }> {
    const seen = new Set<string>();
    return group.modelIds.flatMap((id) => {
        const collection = group.collections?.find((item) => item.members.some((member) => member.modelId === id));
        if (!collection) return [{ key: id, modelIds: [id] }];
        if (seen.has(collection.id)) return [];
        seen.add(collection.id);
        return [{ key: collection.id, modelIds: collection.members.map((member) => member.modelId), collection }];
    }).concat((group.collections || []).filter((collection) => !seen.has(collection.id)).map((collection) => ({ key: collection.id, modelIds: [], collection })));
}

export function moveDisplayEntry(group: ModelDisplayGroup, key: string, to: number): ModelDisplayGroup {
    const entries = displayGroupEntries(group);
    const ordered = moveDisplayItem(entries, entries.findIndex((entry) => entry.key === key), to);
    if (ordered === entries) return group;
    return { ...group, modelIds: ordered.flatMap((entry) => entry.modelIds), collections: ordered.flatMap((entry) => entry.collection ? [entry.collection] : []) };
}

export function moveDisplayEntryToGroup(groups: ModelDisplayGroup[], sourceGroupId: string, entryKey: string, destinationGroupId: string): ModelDisplayGroup[] {
    if (!sourceGroupId || sourceGroupId === destinationGroupId) return groups;
    const source = groups.find((group) => group.id === sourceGroupId);
    const destination = groups.find((group) => group.id === destinationGroupId);
    const entry = source && displayGroupEntries(source).find((item) => item.key === entryKey);
    if (!source || (!destination && destinationGroupId) || !entry) return groups;
    const moved = assignDisplayMembers(groups, entry.modelIds, destinationGroupId);
    return moved.map((group) => {
        if (group.id === sourceGroupId && entry.collection) {
            return { ...group, collections: group.collections?.filter((collection) => collection.id !== entry.collection!.id) };
        }
        if (group.id === destinationGroupId && entry.collection) {
            return {
                ...group,
                collections: [...(group.collections || []).filter((collection) => collection.id !== entry.collection!.id), entry.collection!],
            };
        }
        return group;
    });
}

export function moveCollectionMemberByDrop(group: ModelDisplayGroup, collectionId: string, sourceId: string, targetId: string, before: boolean): ModelDisplayGroup {
    const collection = group.collections?.find((item) => item.id === collectionId);
    if (!collection) return group;
    const from = collection.members.findIndex((item) => item.modelId === sourceId);
    const target = collection.members.findIndex((item) => item.modelId === targetId);
    if (from < 0 || target < 0 || from === target) return group;
    let to = target + (before ? 0 : 1);
    if (from < to) to -= 1;
    const ordered = moveDisplayItem(collection.members, from, to);
    if (ordered === collection.members) return group;
    const memberIds = new Set(collection.members.map((item) => item.modelId));
    let index = 0;
    return {
        ...group,
        modelIds: group.modelIds.map((id) => memberIds.has(id) ? ordered[index++].modelId : id),
        collections: group.collections!.map((item) => item.id === collectionId ? { ...item, members: ordered } : item),
    };
}
