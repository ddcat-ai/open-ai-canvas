import { ArrowUpRight, Clapperboard, Layers3, Sparkles } from "lucide-react";
import { agentCopy, type CanvasAppearance } from "@/lib/canvas/agent-appearance";

type AgentWelcomeProps = {
    appearance: CanvasAppearance;
    nodeCount: number;
    onChooseSkill: () => void;
    onDraftPrompt: (prompt: string) => void;
};

export function AgentWelcome({ appearance, nodeCount, onChooseSkill, onDraftPrompt }: AgentWelcomeProps) {
    return (
        <section className="agent-welcome" aria-label="开始 Agent 创作">
            <div className="agent-welcome-intro">
                <span className="agent-welcome-orb" aria-hidden="true" />
                <h2>{agentCopy(appearance.welcomeTitle, appearance.agentName)}</h2>
                <p>{agentCopy(appearance.welcomeDescription, appearance.agentName)}</p>
            </div>
            <div className="agent-welcome-actions">
                <button type="button" onClick={onChooseSkill}>
                    <Sparkles aria-hidden="true" />
                    <span>
                        <strong>选择技能，开始创作</strong>
                        <small>为这次创作找到合适的帮手</small>
                    </span>
                    <ArrowUpRight className="agent-welcome-arrow" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => onDraftPrompt("我想创作一段短片，请先和我一起梳理故事方向。先询问我的想法，不要直接生成。")}>
                    <Clapperboard aria-hidden="true" />
                    <span>
                        <strong>从灵感构思故事</strong>
                        <small>聊聊主题、角色，或一个难忘的画面</small>
                    </span>
                    <ArrowUpRight className="agent-welcome-arrow" aria-hidden="true" />
                </button>
                <button type="button" disabled={nodeCount === 0} onClick={() => onDraftPrompt("请先阅读当前画布，梳理素材与节点之间的关系，给出接下来的创作建议。先不要修改节点或提交生成任务。")}>
                    <Layers3 aria-hidden="true" />
                    <span>
                        <strong>一起梳理当前画布</strong>
                        <small>{nodeCount > 0 ? `${nodeCount} 个节点，看看下一步可以做什么` : "添加节点后，一起梳理创作思路"}</small>
                    </span>
                    <ArrowUpRight className="agent-welcome-arrow" aria-hidden="true" />
                </button>
            </div>
            <p className="agent-welcome-footnote">先聊想法，再决定下一步</p>
        </section>
    );
}
