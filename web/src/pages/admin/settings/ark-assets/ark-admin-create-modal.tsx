import { useQuery } from "@tanstack/react-query";
import { App, Button, Form, Input } from "antd";
import { CheckCircle2, Copy, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PaymentCheckoutCode } from "@/components/payment-checkout-code";
import { useCopyText } from "@/hooks/use-copy-text";
import { cancelArkPortraitSession, checkArkPortraitSession, createAdminArkGroup, createAdminArkSession, getArkPortraitSession, type ArkGroupKind, type ArkPortraitSession } from "@/services/api/ark-portraits";
import { AdminModal } from "../../ui/overlays";
import { AdminSegmented, Callout, Switch } from "../../ui/controls";
import { ARK_KIND_LABEL, formatArkAdminDate } from "./ark-admin-shared";
import { ArkGrantUsersField } from "./ark-grant-users-field";

type CreateMode = "create" | "register" | "liveness";
type CreateForm = { name: string; description?: string; groupId?: string };

const GROUP_ID_PATTERN = /^group-[A-Za-z0-9-]{1,100}$/;

/**
 * 新建平台素材组：虚拟 / 版权 IP 直接在方舟创建；也可以登记控制台已有的素材组 ID。
 * 平台真人素材组由真人本人完成 H5 认证生成（不收费），认证完成后在详情里设置授权用户。
 */
export function ArkAdminCreateModal({ open, resume, onClose, onCreated }: { open: boolean; resume?: ArkPortraitSession; onClose: () => void; onCreated: (groupId?: string) => void }) {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const [form] = Form.useForm<CreateForm>();
    const [kind, setKind] = useState<ArkGroupKind>(resume ? "real" : "virtual");
    const [mode, setMode] = useState<CreateMode>(resume ? "liveness" : "create");
    const [grantAll, setGrantAll] = useState(false);
    const [grantUserIds, setGrantUserIds] = useState<string[]>([]);
    const [session, setSession] = useState<ArkPortraitSession | null>(resume || null);
    const [working, setWorking] = useState("");
    const settled = useRef(false);

    useEffect(() => {
        if (!open) return;
        setKind(resume ? "real" : "virtual");
        setMode(resume ? "liveness" : "create");
        setSession(resume || null);
        setGrantAll(false);
        setGrantUserIds([]);
        settled.current = false;
        form.resetFields();
    }, [open, resume?.id]);

    const statusQuery = useQuery({
        queryKey: ["admin-ark-session", session?.id],
        queryFn: ({ signal }) => getArkPortraitSession(session!.id, signal),
        enabled: open && session?.status === "pending",
        refetchInterval: 3_000,
    });

    useEffect(() => {
        const latest = statusQuery.data?.session;
        if (latest && session && latest.id === session.id && latest.status !== session.status) settle(latest);
        // settle 只处理最新会话状态。
    }, [statusQuery.data]);

    const settle = (latest: ArkPortraitSession) => {
        if (settled.current) return;
        if (latest.status === "verified") {
            settled.current = true;
            message.success(`「${latest.name}」真人认证完成，已建立平台真人素材组`);
            onCreated(latest.groupId);
            return;
        }
        if (latest.status === "failed" || latest.status === "expired" || latest.status === "cancelled") {
            message.warning(latest.error || "认证未完成，请重新发起");
            setSession(null);
            onCreated();
            return;
        }
        setSession((current) => (current ? { ...current, ...latest, h5Link: current.h5Link } : latest));
    };

    const run = async (key: string, action: () => Promise<void>) => {
        setWorking(key);
        try {
            await action();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
        } finally {
            setWorking("");
        }
    };

    const submit = async () => {
        const values = await form.validateFields();
        if (mode === "liveness") {
            await run("start", async () => {
                const result = await createAdminArkSession({ name: values.name.trim(), description: values.description?.trim(), lang: "zh" });
                setSession(result.session);
                onCreated();
            });
            return;
        }
        await run("create", async () => {
            const result = await createAdminArkGroup({ kind, name: values.name.trim(), description: values.description?.trim(), groupId: mode === "register" ? values.groupId?.trim() : undefined, grantAll, grantUserIds: grantAll ? [] : grantUserIds });
            message.success(mode === "register" ? "素材组已登记" : "素材组已在方舟创建");
            onCreated(result.group.groupId);
        });
    };

    const cancelSession = () =>
        run("cancel", async () => {
            if (session?.status === "pending") await cancelArkPortraitSession(session.id);
            setSession(null);
            onCreated();
        });

    const modeOptions: Array<{ value: CreateMode; label: string }> =
        kind === "real"
            ? [
                  { value: "liveness", label: "真人 H5 认证" },
                  { value: "register", label: "登记已有素材组" },
              ]
            : [
                  { value: "create", label: "在方舟新建" },
                  { value: "register", label: "登记已有素材组" },
              ];

    return (
        <AdminModal
            open={open}
            width={640}
            title={session ? "平台真人认证" : "新建平台素材组"}
            onCancel={() => {
                if (!working) onClose();
            }}
            maskClosable={false}
            footer={
                session ? (
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button danger loading={working === "cancel"} onClick={() => void cancelSession()}>
                            取消认证
                        </Button>
                        <Button onClick={onClose}>稍后继续</Button>
                        <Button type="primary" icon={<CheckCircle2 className="size-4" />} loading={working === "check"} onClick={() => void run("check", async () => settle((await checkArkPortraitSession(session.id)).session))}>
                            我已完成认证
                        </Button>
                    </div>
                ) : (
                    <div className="flex justify-end gap-2">
                        <Button disabled={Boolean(working)} onClick={onClose}>
                            取消
                        </Button>
                        <Button type="primary" loading={working === "create" || working === "start"} onClick={() => void submit()}>
                            {mode === "liveness" ? "发起真人认证" : mode === "register" ? "登记素材组" : "创建素材组"}
                        </Button>
                    </div>
                )
            }
        >
            {session ? (
                <div className="admin-ark-session">
                    {session.h5Link ? <PaymentCheckoutCode value={session.h5Link} /> : null}
                    <div className="admin-ark-session-copy">
                        <strong>请「{session.name}」本人完成认证</strong>
                        <p>用手机扫码，或在本机打开认证页。完成后这里会自动刷新；如未刷新，点击「我已完成认证」。链接 {formatArkAdminDate(session.expiresAt, true)} 前有效，不要转发给无关人员。</p>
                        {session.h5Link ? (
                            <div className="flex flex-wrap gap-2">
                                <Button icon={<ExternalLink className="size-4" />} href={session.h5Link} target="_blank" rel="noopener noreferrer">
                                    在本机打开认证页
                                </Button>
                                <Button icon={<Copy className="size-4" />} onClick={() => copyText(session.h5Link || "", "认证链接已复制")}>
                                    复制认证链接
                                </Button>
                            </div>
                        ) : (
                            <Callout tone="info">认证链接只在发起时返回。若已在手机上完成认证，点击「我已完成认证」查询结果。</Callout>
                        )}
                    </div>
                </div>
            ) : (
                <Form form={form} layout="vertical" requiredMark={false} className="pt-2">
                    <Form.Item label="素材组类型">
                        <AdminSegmented<ArkGroupKind>
                            ariaLabel="素材组类型"
                            value={kind}
                            onChange={(next) => {
                                setKind(next);
                                setMode(next === "real" ? "liveness" : "create");
                            }}
                            options={(["virtual", "ip", "real"] as const).map((value) => ({ value, label: ARK_KIND_LABEL[value] }))}
                        />
                    </Form.Item>
                    <Form.Item label="创建方式">
                        <AdminSegmented<CreateMode> ariaLabel="创建方式" value={mode} onChange={setMode} options={modeOptions} />
                    </Form.Item>
                    {mode === "liveness" ? <Callout tone="info">平台真人素材组不收费，认证完成后在素材组详情里设置授权用户。只能为本人或已取得肖像授权的真人发起。</Callout> : null}
                    <Form.Item name="name" label={mode === "liveness" ? "真人姓名" : "素材组名称"} rules={[{ required: true, whitespace: true, message: mode === "liveness" ? "请填写真人姓名" : "请填写素材组名称" }]} className="mt-4">
                        <Input maxLength={40} placeholder={mode === "liveness" ? "例如：签约演员 张三" : "例如：品牌吉祥物"} />
                    </Form.Item>
                    <Form.Item name="description" label="说明">
                        <Input.TextArea maxLength={200} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="可选，便于区分不同素材组" />
                    </Form.Item>
                    {mode === "register" ? (
                        <Form.Item
                            name="groupId"
                            label="方舟素材组 ID"
                            extra={kind === "real" ? "真人素材组需为控制台扫码授权得到的 LivenessFace 组。" : undefined}
                            rules={[
                                { required: true, message: "请填写方舟素材组 ID" },
                                { pattern: GROUP_ID_PATTERN, message: "请输入 group- 开头的方舟素材组 ID" },
                            ]}
                        >
                            <Input autoComplete="off" placeholder="group-…" />
                        </Form.Item>
                    ) : null}
                    {mode !== "liveness" ? (
                        <Form.Item label="授权使用" extra="被授权的用户可在设置页看到该素材组，并手动加入素材库使用。">
                            <div className="flex flex-col gap-3">
                                <label className="flex items-center gap-2 text-sm">
                                    <Switch checked={grantAll} onChange={setGrantAll} aria-label="授权给全部用户" />
                                    授权给全部用户
                                </label>
                                {grantAll ? null : <ArkGrantUsersField value={grantUserIds} onChange={setGrantUserIds} />}
                            </div>
                        </Form.Item>
                    ) : null}
                </Form>
            )}
        </AdminModal>
    );
}
