import { http } from "./request";

export const getCreationPreferences = (userId: string) => http.get<{ preferences: Record<string, unknown> }>("/settings/creation-preferences", { params: { userId }, timeout: 4000 });
export const patchCreationPreferences = (userId: string, changes: Record<string, unknown>) => http.patch<{ preferences: Record<string, unknown> }>("/settings/creation-preferences", { userId, changes }, { timeout: 8000 });
