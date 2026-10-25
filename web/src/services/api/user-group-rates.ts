import { http } from "./request";

export type UserGroupRate = {
    id: string;
    name: string;
    defaultMultiplierBasisPoints: number | null;
    multiplierBasisPoints: number | null;
};
export type UserGroupRates = { items: UserGroupRate[]; version: number };
export const getUserGroupRates = (userId: string) => http.get<UserGroupRates>(`/admin/users/${encodeURIComponent(userId)}/group-rates`);
export const saveUserGroupRates = (userId: string, rates: Record<string, number>, version: number) =>
    http.put<{ saved: boolean }>(`/admin/users/${encodeURIComponent(userId)}/group-rates`, { rates, version });
