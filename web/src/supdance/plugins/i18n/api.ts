import { compactApiParams, http } from "@/services/api/request";

import type { SupDanceI18nAdminOverview, SupDanceI18nEntry, SupDanceI18nEntryListResult, SupDanceI18nEntryQuery, SupDanceI18nExportPayload, SupDanceI18nPublicBundle, SupDanceI18nSettings } from "./types";

export async function getPublicSupDanceI18nBundle(signal?: AbortSignal) {
    return http.get<SupDanceI18nPublicBundle>("/plugins/supdance-i18n/bundle", { signal });
}

export const fetchPublicI18nBundle = getPublicSupDanceI18nBundle;

export async function getAdminSupDanceI18nOverview() {
    return http.get<SupDanceI18nAdminOverview>("/admin/plugins/supdance-i18n/settings");
}

export const fetchAdminI18nOverview = getAdminSupDanceI18nOverview;

export async function updateAdminSupDanceI18nSettings(settings: SupDanceI18nSettings) {
    return http.put<SupDanceI18nAdminOverview>("/admin/plugins/supdance-i18n/settings", settings);
}

export const updateAdminI18nSettings = updateAdminSupDanceI18nSettings;

export async function listAdminSupDanceI18nEntries(query: SupDanceI18nEntryQuery) {
    return http.get<SupDanceI18nEntryListResult>("/admin/plugins/supdance-i18n/entries", {
        params: compactApiParams({
            namespace: query.namespace && query.namespace !== "all" ? query.namespace : undefined,
            origin: query.origin && query.origin !== "all" ? query.origin : undefined,
            missingLocale: query.missingLocale && query.missingLocale !== "all" ? query.missingLocale : undefined,
            keyword: query.keyword?.trim() || undefined,
            page: query.page,
            pageSize: query.pageSize,
        }),
    });
}

export const fetchAdminI18nEntries = listAdminSupDanceI18nEntries;

export async function upsertAdminSupDanceI18nEntries(entries: SupDanceI18nEntry[]) {
    return http.put<{ overview: SupDanceI18nAdminOverview; updatedCount: number }>("/admin/plugins/supdance-i18n/entries", { entries });
}

export const upsertAdminI18nEntries = upsertAdminSupDanceI18nEntries;

export async function deleteAdminSupDanceI18nEntry(key: string) {
    return http.delete<{ overview: SupDanceI18nAdminOverview; removed: boolean }>("/admin/plugins/supdance-i18n/entries", {
        params: compactApiParams({ key }),
    });
}

export const deleteAdminI18nEntry = deleteAdminSupDanceI18nEntry;

export async function exportAdminSupDanceI18n() {
    return http.get<SupDanceI18nExportPayload>("/admin/plugins/supdance-i18n/export");
}

export const exportAdminI18nBundle = exportAdminSupDanceI18n;

export async function importAdminSupDanceI18n(payload: Partial<SupDanceI18nExportPayload> & { entries?: SupDanceI18nEntry[] }, replaceAll = false) {
    return http.post<{ overview: SupDanceI18nAdminOverview; importedCount: number }>("/admin/plugins/supdance-i18n/import", {
        payload,
        replaceAll,
    });
}

export const importAdminI18nBundle = importAdminSupDanceI18n;
