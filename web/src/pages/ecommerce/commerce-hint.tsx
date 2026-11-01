import { Sparkles } from "lucide-react";
import type { ReactElement } from "react";
import { AntTooltip } from "@/components/ui/base/tooltip/ant-tooltip";

export function CommerceHint({ text, children, placement = "top" }: { text: string; children: ReactElement; placement?: "top" | "bottom" | "left" | "right" }) {
    return (
        <AntTooltip
            title={
                <span className="commerce-hint-content">
                    <Sparkles size={12} aria-hidden="true" />
                    {text}
                </span>
            }
            placement={placement}
            mouseEnterDelay={0.24}
            classNames={{ root: "commerce-hint" }}
        >
            {children}
        </AntTooltip>
    );
}
