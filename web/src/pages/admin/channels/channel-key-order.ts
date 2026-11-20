/** Reorder only the visible website's slots, preserving other sites and hidden groups. */
export function moveWebsiteKeyGroup(order: string[], groupIds: string[], source: string, target: string): string[] {
    const group = new Set(groupIds);
    const current = order.filter((id) => group.has(id));
    if (new Set(order).size !== order.length || group.size !== groupIds.length || !group.has(source) || !group.has(target) || current.length !== groupIds.length || current.some((id, index) => id !== groupIds[index])) {
        throw new Error("Key 分组顺序已变化，请刷新后重试");
    }
    if (source === target) return order;
    const moved = [...groupIds];
    moved.splice(moved.indexOf(source), 1);
    moved.splice(groupIds.indexOf(target), 0, source);
    let index = 0;
    return order.map((id) => (group.has(id) ? moved[index++]! : id));
}
