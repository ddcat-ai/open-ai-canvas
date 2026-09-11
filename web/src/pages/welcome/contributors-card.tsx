import { ArrowUpRight, BadgeCheck, UsersRound } from "lucide-react";

import { CometCard } from "@/components/ui/aceternity/comet-card";

import { welcomeContributors } from "./contributors";

const githubContributors = "https://github.com/ddcat-ai/open-ai-canvas#贡献者与团队";

export function WelcomeContributorsCard() {
    if (!welcomeContributors.length) return null;

    return (
        <section className="welcome-contributors" aria-labelledby="welcome-contributors-title">
            <CometCard containerClassName="welcome-contributors-perspective" className="welcome-contributors-card" rotateDepth={3.5} translateDepth={3}>
                <div className="welcome-contributors-heading">
                    <span className="welcome-contributors-kicker">
                        <UsersRound size={15} />
                        Contributors
                    </span>
                    <div>
                        <h3 id="welcome-contributors-title">一起把故事搬上银幕</h3>
                        <p>{welcomeContributors.length} 位创作者参与产品、开发、测试与社区建设</p>
                    </div>
                    <a href={githubContributors} target="_blank" rel="noreferrer" aria-label="在 GitHub README 查看贡献者清单">
                        查看清单
                        <ArrowUpRight size={14} />
                    </a>
                </div>
                <ul className="welcome-contributors-list" aria-label="项目贡献者">
                    {welcomeContributors.map((contributor) => (
                        <li
                            key={contributor.name}
                            className={contributor.isFounder ? "is-founder" : undefined}
                            title={contributor.signature || contributor.name}
                            aria-label={[contributor.name, contributor.wechat && `微信：${contributor.wechat}`, contributor.email].filter(Boolean).join("，")}
                        >
                            <img src={contributor.avatar} alt="" loading="lazy" />
                            {contributor.isFounder ? (
                                <div className="welcome-contributor-content">
                                    <div className="welcome-contributor-name-row">
                                        <span className="welcome-contributor-name">{contributor.name}</span>
                                        <span className="welcome-contributor-badge">
                                            <BadgeCheck size={13} />
                                            项目发起者
                                        </span>
                                    </div>
                                    <p className="welcome-contributor-meta">{[contributor.wechat && `微信：${contributor.wechat}`, contributor.email].filter(Boolean).join(" · ")}</p>
                                    <p className="welcome-contributor-signature">{contributor.signature}</p>
                                </div>
                            ) : (
                                <span>{contributor.name}</span>
                            )}
                        </li>
                    ))}
                </ul>
            </CometCard>
        </section>
    );
}
