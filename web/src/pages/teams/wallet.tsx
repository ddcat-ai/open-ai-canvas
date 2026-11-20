import { useState } from "react";
import { useOutletContext } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Input, Select, Table } from "antd";
import { PageHeader } from "@/components/layout/workspace-page";
import { AppModal } from "@/components/ui/product/app-modal";
import { parseTeamCreditAmount, teamCredits, teamKeys } from "@/lib/team-query-keys";
import { getTeamLedger, getTeamWallet, listTeamMembers, transferTeamCredits, type TeamLedgerEntry, type TeamSummary } from "@/services/api/teams";
import { useUserStore } from "@/stores/use-user-store";

const actions = { fund: "转入团队", withdraw: "转回个人", allocate: "划拨额度", reclaim: "回收额度" };
type TransferAction = keyof typeof actions;
const transferDescriptions: Record<string, string> = { ...actions, group_fund: "公司划入小组", group_withdraw: "小组退回公司", member_leave: "离队回收", billing_release: "离队后退回余额" };
const billingDescriptions = { reserve: "任务冻结", consume: "任务结算", refund: "任务退回" };

export function TeamWalletPane() {
    const team = useOutletContext<TeamSummary>();
    const userId = useUserStore((state) => state.user?.id) || "";
    const prefix = teamKeys.space(userId, team.id);
    const owner = team.role === "owner";
    const captions = team.parentId ? { ...actions, fund: "从公司公共池转入", withdraw: "转回公司公共池" } : { ...actions, fund: "从个人钱包转入" };
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const wallet = useQuery({ queryKey: [...prefix, "wallet"], queryFn: ({ signal }) => getTeamWallet(team.id, signal) });
    const members = useQuery({ queryKey: [...prefix, "members"], queryFn: ({ signal }) => listTeamMembers(team.id, signal), enabled: owner });
    const [page, setPage] = useState(1);
    const ledger = useQuery({ queryKey: [...prefix, "ledger", page], queryFn: ({ signal }) => getTeamLedger(team.id, page, signal) });
    const [form, setForm] = useState<{ action: TransferAction; membershipId?: string; idempotencyKey: string }>();
    const [amount, setAmount] = useState("");
    const openTransfer = (action: TransferAction, membershipId?: string) => {
        setAmount("");
        setForm({ action, membershipId, idempotencyKey: crypto.randomUUID() });
    };
    const parsedAmount = parseTeamCreditAmount(amount);
    const transfer = useMutation({
        mutationFn: async () => {
            if (!form || parsedAmount === undefined) throw new Error("请输入大于零且最多六位小数的积分");
            if ((form.action === "allocate" || form.action === "reclaim") && !form.membershipId) throw new Error("请选择团队成员");
            return transferTeamCredits(team.id, { ...form, amountMicrocredits: parsedAmount });
        },
        onSuccess: async () => {
            setForm(undefined);
            await queryClient.invalidateQueries({ queryKey: prefix });
            if (team.parentId) await queryClient.invalidateQueries({ queryKey: teamKeys.space(userId, team.parentId) });
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            message.success("积分划转成功");
        },
        onError: (error) => message.error(error.message),
    });
    const account = wallet.data?.myAccount;
    const ledgerAccount = (entry: TeamLedgerEntry) => {
        if (entry.accountId === account?.id) return "我的团队额度";
        if (entry.accountId === wallet.data?.pool?.id) return "团队待分配";
        if (entry.membershipId) {
            const member = members.data?.find((candidate) => candidate.id === entry.membershipId);
            return member?.displayName || member?.username || "历史成员额度";
        }
        return "所有者个人钱包";
    };
    return (
        <div className="space-y-5">
            <PageHeader
                title={owner ? "团队积分" : "我的团队额度"}
                description="公共池中的积分由所有者划拨。分给你的额度只能在当前空间消费。"
                actions={
                    owner ? (
                        <>
                            <Button onClick={() => openTransfer("withdraw")}>{captions.withdraw}</Button>
                            <Button type="primary" onClick={() => openTransfer("fund")}>
                                {captions.fund}
                            </Button>
                        </>
                    ) : (
                        <Button onClick={() => void wallet.refetch()}>刷新额度</Button>
                    )
                }
            />
            {wallet.isError ? <Alert type="error" title="额度读取失败" description={wallet.error.message} action={<Button onClick={() => void wallet.refetch()}>重试</Button>} /> : null}
            <div className="grid gap-3 sm:grid-cols-3">
                {[
                    { label: "我的可用额度", value: account?.availableMicrocredits },
                    { label: "公共待分配", value: wallet.data?.poolAvailableMicrocredits },
                    { label: "我的任务冻结", value: account?.reservedMicrocredits },
                ].map((stat) => (
                    <div key={stat.label} className="rounded-xl border border-border bg-background p-5">
                        <p className="text-sm text-foreground/60">{stat.label}</p>
                        <strong className="mt-2 block text-2xl tabular-nums">
                            {stat.value === undefined ? "—" : teamCredits(stat.value)}
                            <span className="ml-1 text-xs font-normal">积分</span>
                        </strong>
                    </div>
                ))}
            </div>
            {owner ? (
                <section className="space-y-3">
                    <h2 className="font-semibold">成员额度</h2>
                    {members.isError ? <Alert type="error" title={members.error.message} /> : null}
                    <Table
                        rowKey="membershipId"
                        loading={wallet.isPending || members.isPending}
                        dataSource={wallet.data?.members}
                        pagination={false}
                        scroll={{ x: 600 }}
                        columns={[
                            {
                                title: "成员",
                                key: "name",
                                render: (_, entry) => {
                                    const member = members.data?.find((item) => item.id === entry.membershipId);
                                    return member?.displayName || member?.username || entry.userId;
                                },
                            },
                            { title: "可用", key: "available", render: (_, entry) => teamCredits(entry.account.availableMicrocredits) },
                            { title: "冻结", key: "reserved", render: (_, entry) => teamCredits(entry.account.reservedMicrocredits) },
                            {
                                title: "操作",
                                key: "actions",
                                render: (_, entry) => (
                                    <div className="flex gap-2">
                                        <Button size="small" onClick={() => openTransfer("allocate", entry.membershipId)}>
                                            划拨
                                        </Button>
                                        <Button size="small" onClick={() => openTransfer("reclaim", entry.membershipId)}>
                                            回收
                                        </Button>
                                    </div>
                                ),
                            },
                        ]}
                    />
                </section>
            ) : null}
            <section className="space-y-3">
                <h2 className="font-semibold">{owner ? "团队资金流水" : "我的团队流水"}</h2>
                {ledger.isError ? <Alert type="error" title={ledger.error.message} /> : null}
                <Table
                    rowKey="id"
                    loading={ledger.isPending}
                    dataSource={ledger.data?.entries}
                    pagination={{ current: page, pageSize: 20, total: ledger.data?.total, onChange: setPage, showSizeChanger: false }}
                    scroll={{ x: 650 }}
                    columns={[
                        { title: "时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() },
                        { title: "账户", key: "account", render: (_, entry) => ledgerAccount(entry) },
                        { title: "说明", key: "description", render: (_, entry) => (entry.type === "team_transfer" ? transferDescriptions[entry.note || ""] || "团队划转" : billingDescriptions[entry.type]) },
                        { title: "可用变动", dataIndex: "availableDeltaMicrocredits", render: (value: number) => teamCredits(value) },
                        { title: "冻结变动", dataIndex: "reservedDeltaMicrocredits", render: (value: number) => teamCredits(value) },
                        { title: "变动后可用", dataIndex: "availableAfterMicrocredits", render: (value: number) => teamCredits(value) },
                    ]}
                />
            </section>
            <AppModal
                centered
                title={form ? captions[form.action] : "积分划转"}
                open={Boolean(form)}
                onCancel={() => {
                    if (!transfer.isPending) setForm(undefined);
                }}
                onOk={() => transfer.mutate()}
                okText="确认划转"
                confirmLoading={transfer.isPending}
                okButtonProps={{ disabled: parsedAmount === undefined }}
            >
                <div className="space-y-4">
                    {form?.action === "allocate" || form?.action === "reclaim" ? (
                        <label className="block space-y-2">
                            <span>团队成员</span>
                            <Select
                                className="w-full"
                                value={form.membershipId}
                                disabled={transfer.isPending}
                                options={members.data?.map((member) => ({ value: member.id, label: `${member.displayName || member.username} (@${member.username})` }))}
                                onChange={(membershipId) => setForm({ ...form, membershipId, idempotencyKey: crypto.randomUUID() })}
                            />
                        </label>
                    ) : null}
                    <label className="block space-y-2">
                        <span>积分数量</span>
                        <Input
                            value={amount}
                            disabled={transfer.isPending}
                            inputMode="decimal"
                            placeholder="例如 100"
                            onChange={(event) => {
                                setAmount(event.target.value);
                                if (form) setForm({ ...form, idempotencyKey: crypto.randomUUID() });
                            }}
                            suffix="积分"
                        />
                    </label>
                    <p className="text-sm text-foreground/60">
                        {form?.action === "fund"
                            ? team.parentId
                                ? `从「${team.parentName}」的公共池划入当前小组。分配给成员后即可使用。`
                                : "从你的个人可用余额转入公司公共池。分配给成员后即可使用。"
                            : form?.action === "withdraw"
                              ? team.parentId
                                  ? `小组尚未分配的积分将退回「${team.parentName}」的公共池。`
                                  : "将公司尚未分配的积分转回你的个人钱包。"
                              : form?.action === "allocate"
                                ? "从团队待分配余额划拨给所选成员，成员个人钱包不会增加。"
                                : "只回收所选成员尚未使用的可用额度，任务冻结额度保持不变。"}
                    </p>
                </div>
            </AppModal>
        </div>
    );
}
