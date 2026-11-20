import { ModelTags } from "@/components/model-tags";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import type { ChannelModel } from "@/services/api/wallet";

export function ChannelModelDetailsCell({ description, tags = [] }: Pick<ChannelModel, "description" | "tags">) {
    if (!description && !tags.length) return <span className="text-foreground/45">—</span>;

    return (
        <Tooltip
            trigger={["hover", "focus"]}
            title={
                <>
                    {description && <div className="whitespace-pre-wrap break-words">{description}</div>}
                    <ModelTags tags={tags} />
                </>
            }
        >
            <div className="admin-channel-model-details" tabIndex={0}>
                {description && <div className="truncate text-xs text-foreground/65">{description}</div>}
                {tags.length > 0 && (
                    <div className="flex min-w-0 items-center gap-1">
                        <ModelTags tags={tags.slice(0, 2)} />
                        {tags.length > 2 && <span className="shrink-0 text-xs text-foreground/55">+{tags.length - 2}</span>}
                    </div>
                )}
            </div>
        </Tooltip>
    );
}
