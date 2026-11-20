import { ArrowUpRight, BadgeCheck, UsersRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CometCard } from "@/components/ui/aceternity/comet-card";

import { welcomeContributors } from "./contributors";

const githubContributors = "https://github.com/ddcat-ai/open-ai-canvas#贡献者与团队";

export function WelcomeContributorsCard() {
    const { t } = useTranslation();
    if (!welcomeContributors.length) return null;

    return (
        <section id="contributors" className="welcome-contributors" aria-labelledby="welcome-contributors-title">
            <CometCard containerClassName="welcome-contributors-perspective" className="welcome-contributors-card" rotateDepth={3.5} translateDepth={3}>
                <div className="welcome-contributors-heading">
                    <span className="welcome-contributors-kicker">
                        <UsersRound size={15} />
                        Contributors
                    </span>
                    <div>
                        <h3 id="welcome-contributors-title">{t("account.welcome.contributors.title")}</h3>
                        <p>{t("account.welcome.contributors.description", { count: welcomeContributors.length })}</p>
                    </div>
                    <a href={githubContributors} target="_blank" rel="noreferrer" aria-label={t("account.welcome.contributors.viewLabel")}>
                        {t("account.welcome.contributors.view")}
                        <ArrowUpRight size={14} />
                    </a>
                </div>
                <ul className="welcome-contributors-list" aria-label={t("account.welcome.contributors.list")}>
                    {welcomeContributors.map((contributor) => (
                        <li
                            key={contributor.name}
                            className={contributor.isFounder ? "is-founder" : undefined}
                            title={contributor.signature || contributor.name}
                            aria-label={[contributor.name, contributor.wechat && t("account.welcome.contributors.wechat", { id: contributor.wechat }), contributor.email].filter(Boolean).join(t("account.welcome.contributors.separator"))}
                        >
                            <img src={contributor.avatar} alt="" loading="lazy" />
                            {contributor.isFounder ? (
                                <div className="welcome-contributor-content">
                                    <div className="welcome-contributor-name-row">
                                        <span className="welcome-contributor-name">{contributor.name}</span>
                                        <span className="welcome-contributor-badge">
                                            <BadgeCheck size={13} />
                                            {t("account.welcome.contributors.founder")}
                                        </span>
                                    </div>
                                    <p className="welcome-contributor-meta">{[contributor.wechat && t("account.welcome.contributors.wechat", { id: contributor.wechat }), contributor.email].filter(Boolean).join(" · ")}</p>
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
