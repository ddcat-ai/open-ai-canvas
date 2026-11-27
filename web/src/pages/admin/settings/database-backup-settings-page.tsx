import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Form, Input, InputNumber, Select, Spin, Switch, Table, Tag, Tooltip } from "antd";
import { Download, RefreshCw, Save, DatabaseBackup } from "lucide-react";
import { databaseBackups, type DatabaseBackupRecord, type DatabaseBackupSettings } from "@/services/api/database-backups";
import { AdminPageFrame } from "../components/admin-shell";

const statusLabels: Record<string, string> = { running: "备份中", completed: "校验通过", failed: "失败", expired: "已按保留规则清理" };
const stageLabels: Record<string, string> = { snapshot: "生成快照", upload: "上传", verify: "回读校验" };

export default function DatabaseBackupSettingsPage() {
    const { message } = App.useApp();
    const [form] = Form.useForm<DatabaseBackupSettings>();
    const [settings, setSettings] = useState<DatabaseBackupSettings | null>(null);
    const [records, setRecords] = useState<DatabaseBackupRecord[]>([]);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [dirty, setDirty] = useState(false);
    const provider = Form.useWatch(["storage", "provider"], form);
    const running = records.some((record) => record.status === "running");
    const refresh = useCallback(async () => {
        try { setRecords((await databaseBackups.records()).records); setError(""); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "读取备份记录失败"); }
    }, []);
    useEffect(() => {
        let active = true;
        void databaseBackups.settings().then(({ settings: next }) => {
            if (active) { setSettings(next); form.setFieldsValue(next); }
        }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "读取配置失败"); });
        void refresh();
        return () => { active = false; };
    }, [form, refresh]);
    useEffect(() => {
        const timer = window.setInterval(() => void refresh(), running ? 3000 : 30000);
        return () => window.clearInterval(timer);
    }, [refresh, running]);
    async function save(values: DatabaseBackupSettings) {
        setBusy(true);
        try {
            const { settings: next } = await databaseBackups.save(values);
            setSettings(next);
            form.setFieldsValue({ ...next, recoveryPassword: "", storage: { ...next.storage, accessKeySecret: "" } });
            setDirty(false);
            void message.success("备份配置已保存");
        } catch (cause) { void message.error(cause instanceof Error ? cause.message : "保存失败"); }
        finally { setBusy(false); }
    }
    async function start() {
        setBusy(true);
        try { await databaseBackups.start(); await refresh(); void message.success("备份已开始，完成后将回读校验"); }
        catch (cause) { void message.error(cause instanceof Error ? cause.message : "启动失败"); }
        finally { setBusy(false); }
    }
    async function download(record: DatabaseBackupRecord) {
        try {
            const { url } = await databaseBackups.download(record.id);
            const anchor = document.createElement("a");
            anchor.href = url; anchor.rel = "noopener noreferrer"; anchor.referrerPolicy = "no-referrer";
            anchor.click();
        } catch (cause) { void message.error(cause instanceof Error ? cause.message : "下载失败"); }
    }
    return <AdminPageFrame title="数据库备份" description="完整业务数据库 · 加密归档 · 独立对象存储" scroll actions={
        <Button icon={<DatabaseBackup size={16} />} disabled={!settings?.hasRecoveryPassword || dirty || running || busy} onClick={() => void start()}>{running ? "备份进行中" : "立即备份"}</Button>
    }>
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-8">
            {error && <Alert type="error" title={error} />}
            <Alert type="info" title="整库备份，包含所有业务表" description="用户、画布、积分余额与流水、推广关系与返利、订单、渠道、分组折扣、运营配置均随数据库一起备份，同时打包配置解密文件和插件文件。原始图片、视频、音频文件不在此备份内，需另行保留本地资源目录及 OSS 对象。" />
            {!settings ? (!error && <Spin />) : <Form form={form} layout="vertical" onFinish={(values) => void save(values)} onValuesChange={() => setDirty(true)} disabled={busy}>
                <section className="border-b border-[var(--border)] pb-4">
                    <h2 className="mb-4 text-base font-semibold">备份存储</h2>
                    <div className="grid grid-cols-1 gap-x-5 md:grid-cols-2">
                        <Form.Item label="存储类型" name={["storage", "provider"]}><Select options={[{ label: "阿里云 OSS", value: "aliyun" }, { label: "S3 兼容存储", value: "s3" }]} /></Form.Item>
                        <Form.Item label="Endpoint" name={["storage", "endpoint"]} rules={[{ required: true }]}><Input placeholder="https://oss-cn-hangzhou.aliyuncs.com" /></Form.Item>
                        <Form.Item label="Bucket" name={["storage", "bucket"]} rules={[{ required: true }]}><Input /></Form.Item>
                        <Form.Item label="Region" name={["storage", "region"]} rules={[{ required: provider === "s3" }]}><Input placeholder={provider === "s3" ? "us-east-1" : "cn-hangzhou"} /></Form.Item>
                        <Form.Item label="Access Key ID" name={["storage", "accessKeyId"]} rules={[{ required: true }]}><Input autoComplete="off" /></Form.Item>
                        <Form.Item label="Access Key Secret" name={["storage", "accessKeySecret"]} rules={[{ required: !settings.hasStorageSecret }]}><Input.Password autoComplete="new-password" placeholder={settings.hasStorageSecret ? "已保存，留空保持不变" : "输入存储密钥"} /></Form.Item>
                        <Form.Item label="备份目录前缀" name={["storage", "pathPrefix"]}><Input placeholder="database-backups" /></Form.Item>
                        {provider === "s3" && <Form.Item label="Path Style" name={["storage", "pathStyle"]} valuePropName="checked"><Switch /></Form.Item>}
                    </div>
                    <Form.Item label="独立恢复口令" name="recoveryPassword" extra="恢复口令请另外保存到服务器之外。丢失后无法解密备份；修改口令后，旧备份仍需原口令。" rules={[{ required: !settings.hasRecoveryPassword }, { validator: (_, value) => !value || new TextEncoder().encode(value).length >= 16 ? Promise.resolve() : Promise.reject(new Error("恢复口令至少 16 个字节")) }]}><Input.Password autoComplete="new-password" placeholder={settings.hasRecoveryPassword ? "已保存，留空保持不变" : "至少 16 个字节"} /></Form.Item>
                </section>
                <section className="pt-5">
                    <h2 className="mb-4 text-base font-semibold">每日计划</h2>
                    <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2 lg:grid-cols-4">
                        <Form.Item label="自动备份" name="enabled" valuePropName="checked"><Switch /></Form.Item>
                        <Form.Item label="每日时间" name="dailyTime" rules={[{ required: true }]}><Input type="time" /></Form.Item>
                        <Form.Item label="时区" name="timezone"><Select options={[{ value: "Asia/Shanghai", label: "北京时间" }, { value: "UTC", label: "UTC" }]} /></Form.Item>
                        <Form.Item label="保留成功备份份数" name="retainCount" rules={[{ required: true }]}><InputNumber min={1} max={365} className="w-full" /></Form.Item>
                    </div>
                    <div className="flex items-center gap-3"><Button type="primary" htmlType="submit" loading={busy} icon={<Save size={16} />}>保存配置</Button>{dirty && <span className="text-sm text-[var(--muted-foreground)]">有未保存的修改</span>}</div>
                </section>
            </Form>}
            <section className="min-w-0 border-t border-[var(--border)] pt-5">
                <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold">备份记录</h2><Tooltip title="刷新记录"><Button aria-label="刷新记录" icon={<RefreshCw size={16} />} onClick={() => void refresh()} /></Tooltip></div>
                <Table<DatabaseBackupRecord> rowKey="id" size="small" dataSource={records} scroll={{ x: 720 }} pagination={{ pageSize: 10 }} locale={{ emptyText: "暂无备份记录" }} columns={[
                    { title: "开始时间", dataIndex: "startedAt", render: (value: string) => new Date(value).toLocaleString() },
                    { title: "触发", dataIndex: "trigger", render: (value: string) => value === "manual" ? "手动" : "定时" },
                    { title: "数据库", dataIndex: "database" },
                    { title: "状态", render: (_, record) => <Tooltip title={record.error || record.cleanupWarning}><Tag color={record.status === "completed" ? "success" : record.status === "failed" ? "error" : "default"}>{stageLabels[record.stage] || statusLabels[record.status] || record.status}{record.cleanupWarning ? " · 清理待重试" : ""}</Tag></Tooltip> },
                    { title: "大小", dataIndex: "size", render: (value: number) => value ? `${(value / 1024 / 1024).toFixed(2)} MB` : "-" },
                    { title: "操作", render: (_, record) => <Tooltip title="下载加密备份"><Button aria-label="下载加密备份" disabled={record.status !== "completed"} icon={<Download size={16} />} onClick={() => void download(record)} /></Tooltip> },
                ]} expandable={{ expandedRowRender: (record) => <div className="space-y-2 break-all text-sm"><div>记录：{record.id}</div>{record.finishedAt && <div>结束：{new Date(record.finishedAt).toLocaleString()}</div>}{record.sha256 && <div>SHA-256：{record.sha256}</div>}{record.error && <div>{record.error}</div>}{record.cleanupWarning && <div>{record.cleanupWarning}</div>}</div> }} />
            </section>
        </div>
    </AdminPageFrame>;
}
