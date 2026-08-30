import { expect, test } from "bun:test";

function compactSource(source: string) {
    return source.replace(/\s+/g, " ").trim();
}

function sourceSection(source: string, startMarker: string, endMarker: string) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
}

test("announcement editor preserves image and pinned fields through edit and save", async () => {
    const [panelSource, safetySource] = await Promise.all([
        Bun.file(new URL("../src/pages/admin/components/admin-announcements-panel.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/components/admin-announcement-safety.ts", import.meta.url)).text(),
    ]);
    const panel = compactSource(panelSource);

    expect(panel).toContain("uploadAdminAnnouncementImage");
    expect(panel).toContain("discardAdminAnnouncementImage");
    expect(panel).toContain('imageResourceId: announcement.imageResourceId || ""');
    expect(panel).toContain("pinned: announcement.pinned");
    expect(panel).toContain('imageResourceId: values.imageResourceId?.trim() || ""');
    expect(panel).toContain("pinned: Boolean(values.pinned)");
    expect(panel).toContain('(announcement?.imageResourceId || "") === (expectedContent.imageResourceId || "")');
    expect(panel).toContain('rootClassName="admin-modal-root admin-announcement-editor-modal"');
    expect(panel).toContain("centered");
    expect(panel).not.toContain("<Drawer");
    expect(safetySource).toContain("imageResourceId?: string");
    expect(safetySource).toContain("pinned?: boolean");
});

test("analytics keeps fixed range presets distinct and uses enabled channel models for pricing", async () => {
    const source = compactSource(await Bun.file(new URL("../src/pages/admin/components/analytics-panel.tsx", import.meta.url)).text());

    expect(source).toContain('type RangePreset = "7d" | "30d" | "60d"');
    expect(source).toContain('["60d", "60 天"]');
    expect(source).toContain('next.set("rangePreset", rangePreset)');
    expect(source).toContain("setRangePreset(undefined)");
    expect(source).toContain('placeholder={pricingModelOptions.length ? "选择已启用模型" : "暂无已启用模型"}');
    expect(source).toContain("onValuesChange={handlePricingValuesChange}");
    expect(source).toContain("onChange={handlePricingModelChange}");
    expect(source).toContain('hasOwnProperty.call(changedValues, "model")');
    expect(source).toContain("if (matchingChannels.length) form.setFieldValue(\"channelId\", matchingChannels[0].id)");
    expect(source).toContain("const sourceChannels = channels.filter((channel) => channel.enabled !== false)");
    expect(source).toContain('inputMode="decimal"');
    expect(source).toContain('className="admin-analytics-price-input"');
    expect(source).toContain('className="admin-analytics-price-field"');
    expect(source).toContain('rootClassName="admin-modal-root admin-analytics-pricing-modal"');
    expect(source).toContain("zIndex={1200}");
    expect(source).toContain("setPricingWorkspaceOpen(false)");
    expect(source).toContain("validator: validatePriceInput");
    expect(source).toContain('请输入非负价格，最多 6 位小数');
    expect(source).toContain("function formatPriceInput(micros: number)");
    expect(source).toContain("function toMicros(value?: string | number)");
    expect(source).not.toContain("<InputNumber");
});

test("storage settings keep generic S3 controls and connection validation", async () => {
    const source = await Bun.file(new URL("../src/pages/admin/settings/storage-settings-page.tsx", import.meta.url)).text();
    const compacted = compactSource(source);

    expect(compacted).toContain('{ mode: "s3", label: "S3 兼容存储"');
    expect(compacted).toContain("testAdminOSSConnection(connectionInput(values))");
    for (const field of ["s3Preset", "sessionToken", "pathStyle", "allowUserS3"]) {
        expect(compacted).toContain(`name="${field}"`);
    }
    expect(compacted).toContain('["aliyun", "tencent", "qiniu", "s3"].includes(setting.provider || "")');
});

test("admin navigation keeps the storage resource page reachable", async () => {
    const source = await Bun.file(new URL("../src/pages/admin/components/admin-shell.tsx", import.meta.url)).text();
    expect(source).toContain('path: "/admin/resources"');
});

test("nested admin pages return to their own parent entry", async () => {
    const source = await Bun.file(new URL("../src/pages/admin/components/admin-shell.tsx", import.meta.url)).text();
    const compacted = compactSource(source);
    expect(compacted).toContain("const currentItem = currentSection?.items.find");
    expect(compacted).toContain("const sectionPath = back ? (currentItem?.path");
});

test("high impact feature shutdowns require confirmation", async () => {
    const source = await Bun.file(new URL("../src/pages/admin/components/feature-availability-panel.tsx", import.meta.url)).text();
    expect(source).toContain('title: "关闭用户积分功能？"');
    expect(source).toContain('title: "关闭前台模型功能？"');
    expect(source).toContain("onChange={requestFeatureChange}");
});

test("admin settings use full-width summaries without selected-card side stripes", async () => {
    const [componentSource, cssSource] = await Promise.all([Bun.file(new URL("../src/pages/admin/components/admin-ui.tsx", import.meta.url)).text(), Bun.file(new URL("../src/styles/admin-ui.css", import.meta.url)).text()]);

    expect(componentSource).not.toContain("lg:grid lg:grid-cols-4");
    expect(cssSource).not.toContain('content: "配置摘要"');
    expect(cssSource).not.toContain("grid-template-columns: minmax(0, 1fr) 344px");
    expect(cssSource).not.toContain(".admin-storage-mode-choice::before");

    const featureSelected = sourceSection(cssSource, ".admin-feature-board-row.is-selected {", ".admin-feature-board-row.is-dirty {");
    const drawingSelected = sourceSection(cssSource, ".admin-drawing-engine-choice.is-selected {", ".admin-drawing-engine-choice.is-unavailable");
    expect(featureSelected).not.toContain("inset 3px 0 0");
    expect(drawingSelected).not.toContain("inset 3px 0 0");
});

test("task-first settings reveal dependent configuration only after the primary choice", async () => {
    const [storageSource, emailSource, accessSource, featureSource, drawingSource, arkSource, interceptionSource, thirdPartySource, cssSource] = await Promise.all([
        Bun.file(new URL("../src/pages/admin/settings/storage-settings-page.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/components/email-settings-panel.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/components/access-settings-panel.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/components/feature-availability-panel.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/settings/drawing-engine-settings-page.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/settings/ark-private-assets-settings-page.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/settings/response-interception-settings-page.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/settings/libtv-settings-page.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/admin-ui.css", import.meta.url)).text(),
    ]);

    expect(storageSource).toContain('title="1. 选择新资源存储位置"');
    expect(storageSource).toContain("选择后继续完成第 2 步并保存");
    expect(sourceSection(storageSource, "const requestModeChange", "const save")).not.toContain("save(values)");

    expect(emailSource).toContain("{draftEnabled ? (");
    expect(emailSource).toContain('id="admin-email-smtp"');
    expect(emailSource).toContain('title="1. 是否发送注册邮箱验证码"');
    expect(emailSource).toContain('title="2. 配置 SMTP 连接与发件身份"');

    expect(accessSource).toContain("{draftLinuxDOEnabled ? (");
    expect(accessSource).toContain('title="1. 是否允许创建新账号"');
    expect(accessSource).toContain('title="2. 是否开放 Linux.do 登录"');

    expect(featureSource).toContain('title="1. 用户工作台入口"');
    expect(featureSource).toContain('title="2. 插件开放范围"');
    expect(featureSource).toContain('title="3. 用户模型来源"');
    expect(featureSource).toContain('className="admin-feature-runtime-note"');

    expect(drawingSource).toContain('title="1. 选择新建绘图默认编辑器"');
    expect(drawingSource).toContain('title="2. 配置 tldraw 授权（按需）"');
    expect(sourceSection(drawingSource, "const selectEngine", "async function save")).not.toContain("save(");

    expect(arkSource).toContain('title="1. 配置方舟项目与 IAM 凭据"');
    expect(arkSource).toContain('title="2. 是否启用可信素材同步"');
    expect(arkSource).toContain("{prerequisitesReady || draftEnabled ? (");
    expect(arkSource).toContain('aria-label="启用可信素材同步，保存修改后生效"');

    expect(interceptionSource).toContain('title="1. 是否替换用户可见的上游错误"');
    expect(interceptionSource).toContain('title="2. 配置替换规则与优先级"');
    expect(interceptionSource).toContain('title="3. 本地预览用户最终文案"');
    expect(interceptionSource).toContain("{enabled ? (");
    expect(interceptionSource).not.toContain('className="admin-intercept-overview"');
    expect(sourceSection(interceptionSource, "const changeEnabled", "if (loading")).not.toContain("save(");

    expect(thirdPartySource).toContain('title="1. 配置 LibTV 服务端访问凭据"');
    expect(thirdPartySource).toContain('title="2. 是否开放用户导入 LibTV 画布"');
    expect(thirdPartySource).toContain('title="3. 验证已保存的 LibTV 凭据"');
    expect(thirdPartySource).toContain("{draftHasToken ? (");
    expect(thirdPartySource).toContain("{setting.hasToken && !clearTokenDraft ? (");
    expect(thirdPartySource).not.toContain('className="admin-third-party-overview"');
    expect(sourceSection(thirdPartySource, "const changeEnabled", "const markTokenForRemoval")).not.toContain("save(");

    expect(compactSource(cssSource)).toContain(".admin-feature-board { width: 100%; max-width: none; grid-template-columns: minmax(0, 1fr);");
});

test("admin tables keep requested filters and actions in the intended positions", async () => {
    const [storageSource, creditSource] = await Promise.all([
        Bun.file(new URL("../src/pages/admin/components/storage-resources-panel.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/components/credit-operations-panel.tsx", import.meta.url)).text(),
    ]);

    const storageToolbar = sourceSection(storageSource, "toolbar={", "toolbarActiveFilters=");
    expect(storageToolbar).toContain('className="admin-storage-resource-filters"');
    expect(storageToolbar).toContain('placeholder="资源 ID 或对象路径"');
    expect(storageToolbar).toContain('placeholder="用户"');
    expect(storageToolbar).toContain('aria-label="筛选资源类型"');
    expect(storageToolbar).toContain('aria-label="筛选资源状态"');
    expect(storageToolbar).toContain('aria-label="筛选存储类型"');

    const operationColumn = sourceSection(creditSource, 'title: "操作"', "const hasFilters");
    expect(operationColumn).toContain('fixed: "right"');
});

test("request logs display user credit billing independently from upstream cost", async () => {
    const [listSource, detailSource, apiSource] = await Promise.all([
        Bun.file(new URL("../src/pages/admin/logs/logs-page.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/components/api-log-detail-drawer.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/services/api/auth.ts", import.meta.url)).text(),
    ]);

    const billingSummary = sourceSection(listSource, "function BillingSummary", "function MediaResult");
    expect(listSource).toContain('title: "积分计费"');
    expect(billingSummary).toContain("billingAmountMicrocredits");
    expect(billingSummary).toContain("billingAvailable");
    expect(billingSummary).not.toContain("costAvailable");
    expect(detailSource).toContain('["积分计费", billingText(log)]');
    expect(detailSource).toContain('["上游成本", log.costAvailable');
    expect(apiSource).toContain("billingAmountMicrocredits: number");
    expect(apiSource).toContain("billingAvailable: boolean");
});
