/**
 * 灵感大厅的「每日推荐」顺序。
 *
 * 内置目录是随版本发布的静态快照，按固定顺序展示时首页每天都是同一批。
 * 这里按「本地日期 + 条目 id」的散列排序：同一天内顺序固定，翻页、刷新都对得上；
 * 换一天整体换一批。排序键只取决于条目自身，目录增删条目不会打乱其余条目的相对位置。
 */
import { catalogIdOf, type CreationInspiration } from "./catalog";

/** 本地时区的日期键，例如 2026-11-05；过了本地零点才算新的一天。 */
export function localDayKey(date: Date = new Date()): string {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}

/** FNV-1a 加 murmur3 收尾混合的 32 位散列，只用来打乱展示顺序，不用于安全场景。 */
function hash32(text: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;
    return hash >>> 0;
}

export function orderInspirationsByDay(items: CreationInspiration[], dayKey: string): CreationInspiration[] {
    return items
        .map((item) => {
            const id = catalogIdOf(item);
            return { item, id, rank: hash32(`${dayKey}|${id}`) };
        })
        .sort((left, right) => left.rank - right.rank || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
        .map(({ item }) => item);
}

/** 首次收录 7 天内的上新条目带「新」标记。 */
const FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** 每日推荐最前面最多放几条上新，其余上新照常参与轮换，第一页不会被同一批占满。 */
const FRESH_PIN_LIMIT = 12;

function timeOf(value: string | undefined) {
    const time = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(time) ? time : 0;
}

export function isFreshInspiration(item: CreationInspiration, now: number): boolean {
    const added = timeOf(item.addedAt);
    return added > 0 && now - added < FRESH_WINDOW_MS;
}

/** 最新上架：按收录时间倒序，同一批按上游发布时间倒序；没有收录时间的内置条目排在后面，按当天顺序。 */
export function orderInspirationsByLatest(items: CreationInspiration[], dayKey: string): CreationInspiration[] {
    const daily = orderInspirationsByDay(items, dayKey);
    const rank = new Map(daily.map((item, index) => [item, index]));
    return daily.sort((left, right) => timeOf(right.addedAt) - timeOf(left.addedAt) || timeOf(right.publishedAt) - timeOf(left.publishedAt) || rank.get(left)! - rank.get(right)!);
}

/** 每日推荐：7 天内的上新最多 12 条放在最前（最新的优先），其余按当天顺序轮换。 */
export function orderInspirationsForToday(items: CreationInspiration[], dayKey: string, now: number): CreationInspiration[] {
    const daily = orderInspirationsByDay(items, dayKey);
    const pinned = orderInspirationsByLatest(
        daily.filter((item) => isFreshInspiration(item, now)),
        dayKey,
    ).slice(0, FRESH_PIN_LIMIT);
    if (!pinned.length) return daily;
    const pinnedSet = new Set(pinned);
    return [...pinned, ...daily.filter((item) => !pinnedSet.has(item))];
}
