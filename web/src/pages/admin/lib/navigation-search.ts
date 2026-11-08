export type AdminSearchEntry = {
    path: string;
    label: string;
    group: string;
    keywords?: string;
};

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase().trim();

/** 每个词都需匹配；页面名优先于分类、路由和功能关键词。 */
export function searchAdminNavigation(entries: readonly AdminSearchEntry[], query: string): AdminSearchEntry[] {
    const text = normalize(query);
    if (!text) return [...entries];
    const terms = text.split(/\s+/);
    return entries
        .map((entry) => {
            const label = normalize(entry.label);
            const searchable = normalize(`${entry.label} ${entry.group} ${entry.path} ${entry.keywords || ""}`);
            const score = label === text ? 3 : label.startsWith(text) ? 2 : label.includes(text) ? 1 : 0;
            return { entry, score, matches: terms.every((term) => searchable.includes(term)) };
        })
        .filter((result) => result.matches)
        .sort((a, b) => b.score - a.score)
        .map((result) => result.entry);
}
