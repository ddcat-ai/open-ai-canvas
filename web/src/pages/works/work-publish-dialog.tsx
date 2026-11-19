import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Checkbox, Form, Input, Select } from "antd";
import { Upload } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AppModal } from "@/components/ui/product/app-modal";
import { workCategories, submitWork, updateWork, type CommunityWork, type CommunityWorkInput } from "@/services/api/community-works";
import { getRemoteCanvasProject, listRemoteAssetsPage, listRemoteCanvasProjectsPage } from "@/services/api/user-data";
import { resourceFileUrl, uploadResourceFile } from "@/services/api/resources";
import { workResourceOptions, type WorkResourceOption } from "@/lib/community-works";
import { useUserStore } from "@/stores/use-user-store";
import "./works.css";

export function WorkPublishDialog({ work, projectId, onClose, onSaved }: { work?: CommunityWork; projectId?: string; onClose: () => void; onSaved: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const userId = useUserStore((state) => state.user?.id);
    const [form] = Form.useForm<CommunityWorkInput>();
    const selectedProject = Form.useWatch("projectId", form);
    const selectedMedia = Form.useWatch("mediaResourceId", form);
    const selectedCover = Form.useWatch("coverResourceId", form);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState<"media" | "cover">();
    const [uploaded, setUploaded] = useState<WorkResourceOption[]>([]);
    const [assetSearch, setAssetSearch] = useState("");
    const [assetPage, setAssetPage] = useState(1);
    const [projectSearch, setProjectSearch] = useState("");
    const mediaInput = useRef<HTMLInputElement>(null);
    const coverInput = useRef<HTMLInputElement>(null);
    const uploadAbort = useRef<AbortController>(undefined);
    const submitInFlight = useRef(false);
    const initialUser = useRef(userId);
    useEffect(() => () => uploadAbort.current?.abort(), [userId]);
    useEffect(() => {
        form.setFieldsValue({
            title: work?.title || "",
            description: work?.description || "",
            category: work?.category || "creative",
            tags: work?.tags || [],
            mediaResourceId: work?.mediaResourceId || "",
            coverResourceId: work?.coverResourceId || "",
            projectId: work?.projectId || projectId,
            rightsConfirmed: false,
        });
    }, [form, work, projectId]);
    const assets = useQuery({ queryKey: ["work-resource-options", userId, assetSearch, assetPage], queryFn: ({ signal }) => listRemoteAssetsPage({ page: assetPage, pageSize: 50, query: assetSearch, signal }) });
    const projects = useQuery({ queryKey: ["work-project-options", userId, projectSearch], queryFn: ({ signal }) => listRemoteCanvasProjectsPage({ page: 1, pageSize: 50, query: projectSearch, signal }) });
    const project = useQuery({ queryKey: ["work-source-project", userId, selectedProject], queryFn: () => getRemoteCanvasProject(selectedProject!), enabled: Boolean(selectedProject) });
    const options = useMemo(() => {
        const selected = work
            ? [
                  { id: work.mediaResourceId, title: work.title, kind: work.kind, url: work.mediaUrl },
                  { id: work.coverResourceId, title: work.title, kind: "image" as const, url: work.coverUrl },
              ]
            : [];
        return [...new Map([...selected, ...workResourceOptions(assets.data?.assets || [], project.data?.project), ...uploaded].map((option) => [option.id, option])).values()];
    }, [work, assets.data, project.data, uploaded]);
    const chooseFile = async (file: File | undefined, slot: "media" | "cover") => {
        if (!file) return;
        const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : undefined;
        if (!kind || (slot === "cover" && kind !== "image")) {
            void message.error(t("communityWorks.invalidFile"));
            return;
        }
        setUploading(slot);
        const controller = new AbortController();
        uploadAbort.current = controller;
        try {
            const resource = await uploadResourceFile(file, kind, { fileName: file.name, expectedUserId: userId, signal: controller.signal });
            if (controller.signal.aborted || initialUser.current !== useUserStore.getState().user?.id) return;
            setUploaded((previous) => [...previous, { id: resource.id, title: file.name, kind, url: resourceFileUrl(resource.id) }]);
            form.setFieldValue(slot === "cover" ? "coverResourceId" : "mediaResourceId", resource.id);
            if (slot === "media" && kind === "image" && !form.getFieldValue("coverResourceId")) form.setFieldValue("coverResourceId", resource.id);
            if (!form.getFieldValue("title")) form.setFieldValue("title", file.name.replace(/\.[^.]+$/, "").slice(0, 120));
        } catch (error) {
            if (!controller.signal.aborted) void message.error(error instanceof Error ? error.message : t("communityWorks.uploadFailed"));
        } finally {
            if (!controller.signal.aborted) setUploading(undefined);
        }
    };
    const submit = async (values: CommunityWorkInput) => {
        if (submitInFlight.current) return;
        if (initialUser.current !== useUserStore.getState().user?.id) {
            void message.error(t("communityWorks.changedAccount"));
            return;
        }
        submitInFlight.current = true;
        setSaving(true);
        try {
            const input = { ...values, title: values.title.trim(), description: values.description.trim(), tags: values.tags || [], projectId: values.projectId || undefined };
            if (work) await updateWork(work.id, input);
            else await submitWork(input);
            if (initialUser.current !== useUserStore.getState().user?.id) return;
            void message.success(t("communityWorks.saved"));
            onSaved();
        } catch (error) {
            void message.error(error instanceof Error ? error.message : t("communityWorks.failed"));
        } finally {
            submitInFlight.current = false;
            setSaving(false);
        }
    };
    const picker = (slot: "media" | "cover") => {
        const value = slot === "media" ? selectedMedia : selectedCover;
        const picked = options.find((option) => option.id === value);
        return (
            <>
                <Form.Item name={slot === "media" ? "mediaResourceId" : "coverResourceId"} label={t(`communityWorks.${slot}`)} rules={[{ required: true, message: t("communityWorks.required") }]}>
                    <Select
                        showSearch
                        loading={assets.isFetching || project.isFetching}
                        optionFilterProp="label"
                        placeholder={t("communityWorks.choose")}
                        options={options.filter((option) => slot === "media" || option.kind === "image").map((option) => ({ value: option.id, label: option.title }))}
                    />
                </Form.Item>
                {picked && <div className="work-upload-preview">{picked.kind === "image" ? <img src={picked.url} alt={picked.title} /> : <video src={picked.url} controls preload="metadata" />}</div>}
                <input
                    ref={slot === "media" ? mediaInput : coverInput}
                    className="sr-only"
                    type="file"
                    accept={slot === "media" ? "image/*,video/*" : "image/*"}
                    onChange={(event) => {
                        void chooseFile(event.target.files?.[0], slot);
                        event.target.value = "";
                    }}
                    aria-label={`${t("communityWorks.upload")} · ${t(`communityWorks.${slot}`)}`}
                />
                <Button icon={<Upload size={15} />} loading={uploading === slot} disabled={Boolean(uploading) || saving} onClick={() => (slot === "media" ? mediaInput : coverInput).current?.click()}>
                    {t("communityWorks.upload")}
                </Button>
            </>
        );
    };
    return (
        <AppModal title={t(work ? "communityWorks.edit" : "communityWorks.create")} open onCancel={saving || uploading ? undefined : onClose} footer={null} width={680}>
            <Form form={form} layout="vertical" onFinish={(values) => void submit(values)} className="work-publish-form" disabled={saving}>
                {work?.status === "published" && <p role="note">{t("communityWorks.editingPublished")}</p>}
                <Form.Item name="title" label={t("communityWorks.title")} rules={[{ required: true, whitespace: true, max: 120, message: t("communityWorks.required") }]}>
                    <Input maxLength={120} />
                </Form.Item>
                <Form.Item name="description" label={t("communityWorks.description")}>
                    <Input.TextArea maxLength={2000} rows={3} />
                </Form.Item>
                <div className="work-publish-row">
                    <Form.Item name="category" label={t("communityWorks.category")} rules={[{ required: true }]}>
                        <Select options={workCategories.map((value) => ({ value, label: t(`communityWorks.categories.${value}`) }))} />
                    </Form.Item>
                    <Form.Item
                        name="tags"
                        label={t("communityWorks.tags")}
                        rules={[{ validator: (_, tags: string[] | undefined) => (!tags || (tags.length <= 10 && tags.every((tag) => tag.length <= 32)) ? Promise.resolve() : Promise.reject(new Error(t("communityWorks.required")))) }]}
                    >
                        <Select mode="tags" maxCount={10} tokenSeparators={[",", "，"]} />
                    </Form.Item>
                </div>
                <Input.Search
                    aria-label={t("communityWorks.choose")}
                    placeholder={t("communityWorks.choose")}
                    onSearch={(value) => {
                        setAssetSearch(value);
                        setAssetPage(1);
                    }}
                    allowClear
                />
                {assets.isError && (
                    <p role="alert">
                        {assets.error.message}
                        <Button onClick={() => void assets.refetch()}>{t("communityWorks.retry")}</Button>
                    </p>
                )}
                <div className="work-publish-row">
                    <div>{picker("media")}</div>
                    <div>{picker("cover")}</div>
                </div>
                {assets.data && (assetPage > 1 || assets.data.hasMore) && (
                    <div className="work-resource-pagination">
                        <Button disabled={assetPage === 1} onClick={() => setAssetPage((page) => page - 1)}>
                            ←
                        </Button>
                        <span>{assetPage}</span>
                        <Button disabled={!assets.data.hasMore} onClick={() => setAssetPage((page) => page + 1)}>
                            →
                        </Button>
                    </div>
                )}
                <Form.Item name="projectId" label={t("communityWorks.project")}>
                    <Select
                        allowClear
                        showSearch
                        loading={projects.isFetching}
                        filterOption={false}
                        onSearch={setProjectSearch}
                        placeholder={t("communityWorks.noProject")}
                        options={[...new Map([...(projects.data?.projects || []), ...(project.data ? [project.data.project] : [])].map((entry) => [entry.id, { value: entry.id, label: entry.title }])).values()]}
                    />
                </Form.Item>
                {selectedProject && <p role="note">{t("communityWorks.projectConsent")}</p>}
                {project.isError && (
                    <p role="alert">
                        {project.error.message}
                        <Button onClick={() => void project.refetch()}>{t("communityWorks.retry")}</Button>
                    </p>
                )}
                <Form.Item name="rightsConfirmed" valuePropName="checked" rules={[{ validator: (_, checked) => (checked ? Promise.resolve() : Promise.reject(new Error(t("communityWorks.rightsRequired")))) }]}>
                    <Checkbox>{t("communityWorks.rights")}</Checkbox>
                </Form.Item>
                <div className="work-dialog-actions">
                    <Button onClick={onClose} disabled={saving || Boolean(uploading)}>
                        {t("communityWorks.cancel")}
                    </Button>
                    <Button type="primary" htmlType="submit" loading={saving} disabled={Boolean(uploading) || Boolean(selectedProject && (project.isPending || project.isError))}>
                        {t("communityWorks.submit")}
                    </Button>
                </div>
            </Form>
        </AppModal>
    );
}
