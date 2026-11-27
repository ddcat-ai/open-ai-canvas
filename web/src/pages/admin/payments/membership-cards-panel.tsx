import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Form, InputNumber, Select, Spin, Switch } from "antd";
import { useState } from "react";
import { getMembership, membershipTerms, saveMembershipCard, setMembershipSales, type MembershipTerm } from "@/services/api/membership";
import type { TopupProduct, PaymentCurrency } from "@/services/api/payments";
import { listAdminUserGroups, type UserGroup } from "@/services/api/user-groups";

type Values = { price: number; currency: PaymentCurrency; membershipGroup: string; credits: number; enabled: boolean };

function CardForm({ term, product, groups, defaultCurrency, reload }: { term: MembershipTerm; product?: TopupProduct; groups: UserGroup[]; defaultCurrency: PaymentCurrency; reload: () => Promise<void> }) {
    const { message } = App.useApp();
    const [busy, setBusy] = useState(false);
    async function save(values: Values) {
        setBusy(true);
        try {
            await saveMembershipCard(term, { enabled: values.enabled, amountFen: Math.round(values.price * 100), currency: values.currency, membershipGroup: values.membershipGroup, creditsMicrocredits: Math.round(values.credits * 1_000_000) });
            await reload();
            message.success(`${membershipTerms[term]}已保存`);
        } catch (err) {
            message.error(err instanceof Error ? err.message : "保存会员卡失败");
        } finally {
            setBusy(false);
        }
    }
    return (
        <section className="border-b py-3">
            <h3>
                {membershipTerms[term]} · {{ week: 7, month: 30, quarter: 90, year: 365 }[term]} 天
            </h3>
            <Form
                name={`membership-${term}`}
                layout="inline"
                onFinish={save}
                initialValues={{
                    price: product ? product.amountFen / 100 : undefined,
                    currency: product?.currency ?? defaultCurrency,
                    membershipGroup: product?.membershipGroup,
                    credits: (product?.creditsMicrocredits ?? 0) / 1_000_000,
                    enabled: product?.enabled ?? false,
                }}
            >
                <Form.Item label="售价" name="price" rules={[{ required: true }]}>
                    <InputNumber min={0.01} max={1_000_000} precision={2} />
                </Form.Item>
                <Form.Item label="币种" name="currency">
                    <Select options={["CNY", "USD"].map((value) => ({ value, label: value }))} />
                </Form.Item>
                <Form.Item label="用户组" name="membershipGroup" rules={[{ required: true }]}>
                    <Select className="min-w-28" options={groups.map((g) => ({ value: g.code, label: g.name }))} />
                </Form.Item>
                <Form.Item label="赠送积分" name="credits" rules={[{ required: true }]}>
                    <InputNumber min={0} max={1_000_000_000} precision={6} />
                </Form.Item>
                <Form.Item label="上架" name="enabled" valuePropName="checked">
                    <Switch />
                </Form.Item>
                <Button htmlType="submit" loading={busy}>
                    保存{membershipTerms[term]}
                </Button>
            </Form>
        </section>
    );
}

export function MembershipCardsPanel({ products, loading, defaultCurrency, reload }: { products: TopupProduct[]; loading: boolean; defaultCurrency: PaymentCurrency; reload: () => Promise<void> }) {
    const { message } = App.useApp();
    const [busy, setBusy] = useState(false);
    const status = useQuery({ queryKey: ["admin-membership-sales"], queryFn: getMembership });
    const groups = useQuery({ queryKey: ["admin-membership-groups"], queryFn: listAdminUserGroups });
    async function toggle(value: boolean) {
        setBusy(true);
        try {
            await setMembershipSales(value);
            await status.refetch({ throwOnError: true });
        } catch (err) {
            message.error(err instanceof Error ? err.message : "设置销售开关失败");
        } finally {
            setBusy(false);
        }
    }
    if (status.error || groups.error) return <Alert type="error" message={(status.error || groups.error)?.message} />;
    if (!status.data || !groups.data) return <Spin />;
    return (
        <div aria-busy={loading}>
            <label className="flex items-center gap-2 py-3">
                <Switch checked={status.data.salesEnabled} loading={busy} onChange={toggle} />
                开放会员卡销售
            </label>
            <p>关闭后停止新购和续费，已创建的订单和已购权益继续履约。换卡从已购时段结束时生效，赠分在支付确认时到账。</p>
            {(Object.keys(membershipTerms) as MembershipTerm[]).map((term) => {
                const product = products.find((p) => p.id === `membership-${term}`);
                return <CardForm key={term + String(product?.updatedAt)} term={term} groups={groups.data.groups} product={product} defaultCurrency={defaultCurrency} reload={reload} />;
            })}
        </div>
    );
}
