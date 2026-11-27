export function displayGroupComparator(order: readonly string[]) {
    const ranks = new Map(order.map((name, index) => [name, index]));
    return (left: string, right: string) =>
        (ranks.get(left) ?? order.length) - (ranks.get(right) ?? order.length) ||
        left.localeCompare(right, "zh-CN");
}

export function compareDisplayMembers(leftOrder: number, rightOrder: number, leftId: string, rightId: string) {
    return leftOrder - rightOrder || leftId.localeCompare(rightId, "en");
}
