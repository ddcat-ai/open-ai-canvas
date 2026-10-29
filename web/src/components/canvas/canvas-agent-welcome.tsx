import { ArrowUpRight, Clapperboard, Layers3, Orbit, Sparkles } from "lucide-react";
import { agentCopy, type CanvasAppearance } from "@/lib/canvas/agent-appearance";

/** 已安装技能少于这个数时，欢迎页主动提示按行业安装推荐技能。 */
const RECOMMEND_SKILLS_BELOW = 3;

type AgentWelcomeProps = {
    appearance: CanvasAppearance;
    /** null 表示当前不在画布中。 */
    nodeCount: number | null;
    /** null 表示技能库还没读到。 */
    installedSkillCount?: number | null;
    onChooseSkill: () => void;
    onOpenSkillRecommendations?: () => void;
    onDraftPrompt: (prompt: string) => void;
};

export function AgentWelcome({ appearance, nodeCount, installedSkillCount = null, onChooseSkill, onOpenSkillRecommendations, onDraftPrompt }: AgentWelcomeProps) {
    const suggestRecommendations = Boolean(onOpenSkillRecommendations) && installedSkillCount !== null && installedSkillCount < RECOMMEND_SKILLS_BELOW;
    return (
        <section className="agent-welcome" aria-label="开始 Agent 创作">
            <div className="agent-welcome-intro">
                <span className="agent-welcome-orb" aria-hidden="true" />
                <h2>{agentCopy(appearance.welcomeTitle, appearance.agentName)}</h2>
                <p>{agentCopy(appearance.welcomeDescription, appearance.agentName)}</p>
            </div>
            <div className="agent-welcome-actions">
                {suggestRecommendations ? (
                    <button type="button" onClick={onOpenSkillRecommendations}>
                        <Sparkles aria-hidden="true" />
                        <span>
                            <strong>按行业安装推荐技能</strong>
                            <small>{installedSkillCount ? `已安装 ${installedSkillCount} 个，装好后 Agent 会按任务自动选用` : "装好后 Agent 会按任务自动选用"}</small>
                        </span>
                        <ArrowUpRight className="agent-welcome-arrow" aria-hidden="true" />
                    </button>
                ) : null}
                <button type="button" onClick={onChooseSkill}>
                    <Orbit aria-hidden="true" />
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
                <button type="button" disabled={!nodeCount} onClick={() => onDraftPrompt("请先阅读当前画布，梳理素材与节点之间的关系，给出接下来的创作建议。先不要修改节点或提交生成任务。")}>
                    <Layers3 aria-hidden="true" />
                    <span>
                        <strong>一起梳理当前画布</strong>
                        <small>{nodeCount === null ? "进入一个画布后可用" : nodeCount > 0 ? `${nodeCount} 个节点，看看下一步可以做什么` : "添加节点后，一起梳理创作思路"}</small>
                    </span>
                    <ArrowUpRight className="agent-welcome-arrow" aria-hidden="true" />
                </button>
            </div>
            <p className="agent-welcome-footnote">先聊想法，再决定下一步</p>
        </section>
    );
}
