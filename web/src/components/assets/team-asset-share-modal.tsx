import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Select } from "antd";
import { Link } from "react-router";
import { AppModal } from "@/components/ui/product/app-modal";
import { teamKeys } from "@/lib/team-query-keys";
import { listTeams, type TeamAssetPublicationResult } from "@/services/api/teams";
import { createPersonalAssetPublication } from "@/services/team-asset-publication";
import { useUserStore } from "@/stores/use-user-store";

export function TeamAssetShareModal({ assetIds, onClose }: { assetIds: readonly string[]; onClose: () => void }) {
    const userId = useUserStore((state) => state.user?.id) || "";
    const queryClient = useQueryClient();
    const [teamId, setTeamId] = useState<string>();
    const [remainingIds, setRemainingIds] = useState(() => [...assetIds]);
    const operation = useRef<ReturnType<typeof createPersonalAssetPublication> | undefined>(undefined);
    const [results, setResults] = useState<TeamAssetPublicationResult[]>([]);
    const teams = useQuery({ queryKey: teamKeys.list(userId), queryFn: ({ signal }) => listTeams(signal) });
    const publish = useMutation({
        mutationFn: async () => {
            if (!teamId) throw new Error("请选择目标团队");
            operation.current ??= createPersonalAssetPublication(teamId, remainingIds, crypto.randomUUID());
            return operation.current();
        },
        onSuccess: async (next) => {
            setResults((current) => [...current.filter((result) => !next.some((item) => item.sourceAssetId === result.sourceAssetId)), ...next]);
            setRemainingIds(next.filter((result) => result.error).map((result) => result.sourceAssetId));
            operation.current = undefined;
            await queryClient.invalidateQueries({ queryKey: teamKeys.space(userId, teamId!) });
        },
    });
    const succeeded = results.filter((result) => result.asset).length;
    return (
        <AppModal
            centered
            title="共享到团队"
            open
            onCancel={() => {
                if (!publish.isPending) onClose();
            }}
            width={620}
            confirmLoading={publish.isPending}
            okText={publish.isError ? "重试同一发布请求" : `共享 ${remainingIds.length} 项`}
            okButtonProps={{ disabled: !teamId || !remainingIds.length }}
            onOk={() => publish.mutate()}
            cancelText={remainingIds.length ? "关闭" : "完成"}
        >
            <div className="space-y-4">
                <Alert type="info" title={`已选 ${assetIds.length} 项素材（包含跨页选择）`} description="团队获得独立副本，离队和删除个人原件不会移除团队版本。尚未同步的本地素材会明确提示，完成同步后可重试失败项。" />
                <label className="block space-y-2">
                    <span>目标团队</span>
                    <Select
                        className="w-full"
                        placeholder="选择已加入的团队"
                        loading={teams.isPending}
                        value={teamId}
                        disabled={publish.isPending || results.length > 0 || publish.isError}
                        showSearch={{ optionFilterProp: "label" }}
                        options={teams.data?.map((team) => ({ value: team.id, label: team.parentName ? `${team.parentName} / ${team.name}` : team.name }))}
                        onChange={(value) => {
                            setTeamId(value);
                            operation.current = undefined;
                        }}
                    />
                </label>
                {teams.isError ? <Alert type="error" title={teams.error.message} action={<Button onClick={() => void teams.refetch()}>重试</Button>} /> : null}
                {teams.data?.length === 0 ? (
                    <p>
                        你还没有加入团队。<Link to="/teams">创建或加入团队</Link>后再共享。
                    </p>
                ) : null}
                {publish.isError ? <Alert type="error" title="发布尚未确认" description={`${publish.error.message}。保留当前目标和请求标识重试，避免重复发布。`} /> : null}
                {publish.isPending ? (
                    <p role="status" className="text-sm">
                        正在核对服务端素材并发布，请勿关闭窗口…
                    </p>
                ) : null}
                {succeeded ? <Alert type="success" title={`已成功共享 ${succeeded} 项`} action={<Link to={`/teams/${encodeURIComponent(teamId!)}/assets`}>查看团队库</Link>} /> : null}
                <div className="max-h-72 space-y-2 overflow-auto">
                    {results
                        .filter((result) => result.error)
                        .map((result) => (
                            <Alert key={result.sourceAssetId} type="error" title={`素材 ${result.sourceAssetId} 未共享`} description={result.error?.msg} />
                        ))}
                </div>
            </div>
        </AppModal>
    );
}
