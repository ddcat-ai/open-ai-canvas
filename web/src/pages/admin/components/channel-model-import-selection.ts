// 「拉取模型」预览弹窗的筛选与批量勾选规则。
// 上游端点可能返回几百个模型，弹窗里先按关键字收窄，再对收窄后的集合做批量勾选。

/** 关键字为空（或只有空白）时返回全部；否则按大小写不敏感的子串匹配模型标识。 */
export function filterImportModels(models: string[], keyword: string): string[] {
    const query = keyword.trim().toLowerCase();
    if (!query) return models;
    return models.filter((name) => name.toLowerCase().includes(query));
}

/** 全选：并入当前可见集合，保留关键字外已经勾选的模型。 */
export function selectVisibleModels(current: string[], visible: string[]): string[] {
    return Array.from(new Set([...current, ...visible]));
}

/** 取消选中：只移除当前可见集合里的勾选，关键字外的勾选保持不变。 */
export function deselectVisibleModels(current: string[], visible: string[]): string[] {
    const hidden = new Set(visible);
    return current.filter((name) => !hidden.has(name));
}
