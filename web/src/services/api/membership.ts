import { http } from "./request";
import type { PaymentCurrency } from "./payments";

export type MembershipPeriod = { productName: string; membershipGroup: string; startsAt: string; endsAt: string };
export type MembershipStatus = { salesEnabled: boolean; baseGroup: string; periods: MembershipPeriod[] };
export const getMembership = () => http.get<MembershipStatus>("/payments/membership");
export const setMembershipSales = (enabled: boolean) => http.put("/admin/payments/membership/sales", { enabled });
export const membershipTerms = { week: "周卡", month: "月卡", quarter: "季卡", year: "年卡" } as const;
export type MembershipTerm = keyof typeof membershipTerms;
export function saveMembershipCard(term: MembershipTerm, input: { enabled: boolean; amountFen: number; currency: PaymentCurrency; creditsMicrocredits: number; membershipGroup: string }) {
    return http.put(`/admin/payments/membership/cards/${term}`, input);
}
