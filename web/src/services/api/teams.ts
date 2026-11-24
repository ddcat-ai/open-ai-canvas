import { http } from "@/services/api/request";
import type { CreditLedgerEntry } from "@/services/api/wallet";

export type TeamSummary = { id: string; name: string; parentId?: string; parentName?: string; ownerUserId: string; role: "owner" | "member"; membershipId: string };
export type SpaceCredits = { availableMicrocredits: number; reservedMicrocredits: number };
export type TeamSpaceCredit = Pick<TeamSummary, "name" | "role" | "parentId" | "parentName"> & SpaceCredits & { teamId: string; poolAvailableMicrocredits: number };
export type SpaceCreditOverview = { personal: SpaceCredits; spaces: TeamSpaceCredit[] };
export type TeamMember = { id: string; userId: string; teamId: string; role: "owner" | "member"; username: string; displayName: string };
export type TeamInvitation = { id: string; teamId: string; teamName: string; parentName?: string; inviterName: string; inviteeUserId: string; inviteeName: string; status: "pending" | "accepted" | "rejected" | "revoked" | "expired"; expiresAt: string };
export type TeamInviteCandidate = { id: string; username: string; displayName: string; status: "available" | "member" | "pending" };
export type TeamCreditAccount = { id: string; kind: string; userId?: string; teamId?: string; membershipId?: string; availableMicrocredits: number; reservedMicrocredits: number; version: number };
export type TeamWallet = { pool?: TeamCreditAccount; poolAvailableMicrocredits: number; myAccount: TeamCreditAccount; members?: { membershipId: string; userId: string; account: TeamCreditAccount }[] };
export type TeamLedgerEntry = Omit<CreditLedgerEntry, "type"> & { type: "team_transfer" | "reserve" | "consume" | "refund"; accountId: string; membershipId?: string; availableDeltaMicrocredits: number; reservedDeltaMicrocredits: number };
export type PublishedAsset = { id: string; primaryVersionId: string };
export type TeamAssetPublicationResult = { sourceAssetId: string; asset?: PublishedAsset; error?: { code: number; msg: string; reason?: string } };
const teamPath = (teamId: string) => `/teams/${encodeURIComponent(teamId)}`;

export function listTeams(signal?: AbortSignal) {
    return http.get<TeamSummary[]>("/teams", { signal });
}
export function getSpaceCreditOverview(signal?: AbortSignal) {
    return http.get<SpaceCreditOverview>("/teams/credit-overview", { signal });
}
export function createTeamGroup(parentId: string, name: string) {
    return http.post<TeamSummary>(`${teamPath(parentId)}/groups`, { name });
}
export function createTeam(name: string) {
    return http.post<TeamSummary>("/teams", { name });
}
export function getTeam(teamId: string, signal?: AbortSignal) {
    return http.get<TeamSummary>(teamPath(teamId), { signal });
}
export function listTeamMembers(teamId: string, signal?: AbortSignal) {
    return http.get<TeamMember[]>(`${teamPath(teamId)}/members`, { signal });
}
export function searchTeamInviteCandidates(teamId: string, q: string, signal?: AbortSignal) {
    return http.get<TeamInviteCandidate[]>(`${teamPath(teamId)}/invite-candidates`, { params: { q }, signal });
}
export function listMyTeamInvitations(signal?: AbortSignal) {
    return http.get<TeamInvitation[]>("/team-invitations", { signal });
}
export function listTeamInvitations(teamId: string, signal?: AbortSignal) {
    return http.get<TeamInvitation[]>(`${teamPath(teamId)}/invitations`, { signal });
}
export function inviteTeamUser(teamId: string, inviteeUserId: string) {
    return http.post<TeamInvitation>(`${teamPath(teamId)}/invitations`, { inviteeUserId });
}
export function respondTeamInvitation(id: string, action: "accept" | "reject") {
    return http.post<TeamInvitation>(`/team-invitations/${encodeURIComponent(id)}/${action}`);
}
export function revokeTeamInvitation(teamId: string, id: string) {
    return http.post<TeamInvitation>(`${teamPath(teamId)}/invitations/${encodeURIComponent(id)}/revoke`);
}
export function leaveTeam(teamId: string) {
    return http.post(`${teamPath(teamId)}/leave`);
}
export function removeTeamMember(teamId: string, membershipId: string) {
    return http.delete(`${teamPath(teamId)}/members/${encodeURIComponent(membershipId)}`);
}
export function getTeamWallet(teamId: string, signal?: AbortSignal) {
    return http.get<TeamWallet>(`${teamPath(teamId)}/wallet`, { signal });
}
export function getTeamLedger(teamId: string, page: number, signal?: AbortSignal) {
    return http.get<{ entries: TeamLedgerEntry[]; total: number; page: number; limit: number }>(`${teamPath(teamId)}/wallet/ledger`, { params: { page, limit: 20 }, signal });
}
export function transferTeamCredits(teamId: string, input: { action: "fund" | "withdraw" | "allocate" | "reclaim"; membershipId?: string; amountMicrocredits: number; idempotencyKey: string }) {
    const path = input.action === "allocate" || input.action === "reclaim" ? `${teamPath(teamId)}/members/${encodeURIComponent(input.membershipId!)}/${input.action}` : `${teamPath(teamId)}/wallet/${input.action}`;
    return http.post<{ transfer: { id: string }; source: TeamCreditAccount; target: TeamCreditAccount }>(path, { amountMicrocredits: input.amountMicrocredits, idempotencyKey: input.idempotencyKey });
}
export function publishTeamAssets(teamId: string, assetIds: string[], idempotencyKey: string) {
    return http.post<{ results: TeamAssetPublicationResult[] }>(`${teamPath(teamId)}/asset-publications`, { assetIds, idempotencyKey }, { timeout: 120_000 });
}
