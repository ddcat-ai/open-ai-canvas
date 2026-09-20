import { useEffect, useState } from "react";
import { App, Avatar, Button, Select, Spin } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { addCanvasCollaborator, listCanvasCollaborationMembers, removeCanvasCollaborator, searchCanvasCollaborationUsers, type CanvasCollaborationMember, type CanvasCollaborationUser } from "@/services/api/canvas-collaboration";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import { presenceColor } from "./canvas-presence";

export function CanvasCollaborationMembers({ projectId }: { projectId: string }) {
    const { message, modal } = App.useApp();
    const userId = useUserStore((state) => state.user?.id);
    const client = useQueryClient();
    const queryKey = ["canvas-collaboration-members", userId, projectId];
    const roster = useQuery({ queryKey, queryFn: () => listCanvasCollaborationMembers(projectId), refetchOnMount: "always" });
    const members = roster.data?.members || [];
    const canManage = members.some((member) => member.userId === userId && member.role === "owner");
    const [inviting, setInviting] = useState(false);
    const [search, setSearch] = useState("");
    const [users, setUsers] = useState<CanvasCollaborationUser[]>([]);
    const [selected, setSelected] = useState<{ value: string; label: string }>();
    const [role, setRole] = useState<"editor" | "viewer">("editor");
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        setUsers([]);
        setSearchError("");
        if (!inviting || !canManage || !search.trim()) {
            setSearching(false);
            return;
        }
        const controller = new AbortController();
        setSearching(true);
        const timer = window.setTimeout(() => {
            void searchCanvasCollaborationUsers(projectId, search.trim(), { signal: controller.signal })
                .then((result) => {
                    if (!controller.signal.aborted) setUsers(result.users);
                })
                .catch(() => {
                    if (!controller.signal.aborted) setSearchError("搜索失败，请重新输入重试");
                })
                .finally(() => {
                    if (!controller.signal.aborted) setSearching(false);
                });
        }, 220);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [inviting, canManage, search, projectId]);

    const add = async () => {
        if (!selected || submitting || !canManage) return;
        setSubmitting(true);
        try {
            const { member } = await addCanvasCollaborator(projectId, { userId: selected.value, role });
            // Permission metadata is not a canvas content edit.
            useCanvasStore.setState((state) => ({ projects: state.projects.map((project) => (project.id === projectId ? { ...project, collaborationEnabled: true } : project)) }));
            client.setQueryData(queryKey, { members: [...members.filter((item) => item.userId !== member.userId), member] });
            void client.invalidateQueries({ queryKey: ["canvas-projects", "summaries"] });
            setSelected(undefined);
            setSearch("");
            setInviting(false);
            message.success("已添加成员，对方可在画布列表中打开");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "添加成员失败");
        } finally {
            setSubmitting(false);
        }
    };

    const remove = (member: CanvasCollaborationMember) =>
        modal.confirm({
            title: `移除 ${member.displayName || member.username || "此成员"}？`,
            content: "移除后不再拥有此画布的协作权限，已有内容仍会保留。",
            okText: "移除成员",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                await removeCanvasCollaborator(projectId, member.userId);
                await client.invalidateQueries({ queryKey });
                message.success("已移除成员");
            },
        });

    return (
        <section aria-label="协作成员" className="canvas-collaboration-members">
            <div className="canvas-collaboration-section-title">
                <h3>成员{roster.data ? <span className="ml-2 font-normal text-muted-foreground">{members.length}</span> : null}</h3>
                {canManage && !inviting ? (
                    <Button type="text" size="small" icon={<Plus size={14} />} onClick={() => setInviting(true)}>
                        添加成员
                    </Button>
                ) : null}
            </div>
            {roster.isPending ? (
                <Spin size="small" />
            ) : roster.isError ? (
                <p role="alert" className="canvas-version-error">
                    成员读取失败{" "}
                    <Button type="link" size="small" onClick={() => void roster.refetch()}>
                        重试
                    </Button>
                </p>
            ) : (
                <div className="canvas-collaboration-roster">
                    {members.map((member) => {
                        const name = member.displayName || member.username || "已注销成员";
                        return (
                            <div key={member.userId} className="canvas-collaboration-member">
                                <Avatar size={28} style={{ backgroundColor: presenceColor(member.userId), flexShrink: 0 }}>
                                    {Array.from(name)[0]}
                                </Avatar>
                                <div className="canvas-collaboration-member-name">
                                    <strong title={name}>
                                        {name}
                                        {member.userId === userId ? "（我）" : ""}
                                    </strong>
                                    {member.username && member.username !== name ? <small title={member.username}>@{member.username}</small> : null}
                                </div>
                                <span className="canvas-collaboration-member-role">{member.role === "owner" ? "所有者" : member.role === "editor" ? "可编辑" : "仅查看"}</span>
                                {canManage && member.role !== "owner" ? <Button type="text" size="small" aria-label={`移除 ${name}`} icon={<X size={14} />} onClick={() => remove(member)} /> : null}
                            </div>
                        );
                    })}
                </div>
            )}
            {inviting && canManage ? (
                <form
                    className="canvas-collaboration-create"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void add();
                    }}
                >
                    <label htmlFor="canvas-invite-user">搜索用户名或昵称</label>
                    <Select
                        id="canvas-invite-user"
                        showSearch
                        labelInValue
                        virtual={false}
                        filterOption={false}
                        value={selected}
                        searchValue={search}
                        onSearch={(value) => {
                            setSearch(value);
                            if (value.trim()) setSelected(undefined);
                        }}
                        onChange={setSelected}
                        loading={searching}
                        disabled={submitting}
                        placeholder="输入用户名或昵称"
                        notFoundContent={searching ? "正在搜索…" : searchError || (search.trim() ? "没有找到可添加的用户" : "输入用户名或昵称")}
                        options={users
                            .filter((user) => !members.some((member) => member.userId === user.id))
                            .map((user) => ({ value: user.id, label: user.displayName && user.displayName !== user.username ? `${user.displayName} · ${user.username}` : user.username }))}
                    />
                    <Select
                        aria-label="成员权限"
                        value={role}
                        onChange={setRole}
                        disabled={submitting}
                        options={[
                            { value: "editor", label: "可编辑" },
                            { value: "viewer", label: "仅查看" },
                        ]}
                    />
                    <div className="canvas-collaboration-create-actions">
                        <Button disabled={submitting} onClick={() => setInviting(false)}>
                            取消
                        </Button>
                        <Button type="primary" htmlType="submit" loading={submitting} disabled={!selected}>
                            添加
                        </Button>
                    </div>
                </form>
            ) : members.length === 1 && canManage ? (
                <p className="canvas-version-hint">添加成员，一起编辑这张画布。</p>
            ) : null}
        </section>
    );
}
