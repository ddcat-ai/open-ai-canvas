import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";
import type { UpdateAnnouncement, UpdateBlock } from "@/lib/update-announcement";
import "./update-announcement-content.css";

export function UpdateAnnouncementContent({ value, mediaURL }: { value: UpdateAnnouncement; mediaURL?: (block: UpdateBlock) => string }) {
    const { t } = useTranslation();
    return (
        <div className="update-announcement-content">
            {value.releases.length ? (
                value.releases.map((release) => (
                    <section className="update-announcement-release" key={release.id} aria-label={t("account.layout.updates.versionLabel", { version: release.version })}>
                        <header className="update-announcement-release-heading">
                            <h3>{release.version || t("account.layout.updates.versionPending")}</h3>
                            {release.version === value.currentVersion ? <span className="update-announcement-badge">{t("account.layout.updates.currentVersion")}</span> : null}
                            {release.date ? <time dateTime={release.date}>{release.date}</time> : null}
                        </header>
                        {release.title ? <h4 className="update-announcement-release-title">{release.title}</h4> : null}
                        <div className="update-announcement-block-grid">
                            {release.blocks.map((block) => {
                                const url = mediaURL?.(block) || block.mediaUrl || "";
                                return (
                                    <div className={`update-announcement-block is-${block.layout}`} key={block.id}>
                                        {block.type === "text" ? (
                                            <div className="update-announcement-copy">
                                                <ReactMarkdown components={{ img: () => null }}>{block.text || t("account.layout.updates.textPending")}</ReactMarkdown>
                                            </div>
                                        ) : (
                                            <figure>
                                                {url ? (
                                                    block.type === "image" ? (
                                                        <img src={url} alt={block.caption || t("account.layout.updates.imageAlt")} loading="lazy" />
                                                    ) : (
                                                        <video src={url} controls playsInline preload="metadata" aria-label={block.caption || t("account.layout.updates.videoLabel")} />
                                                    )
                                                ) : (
                                                    <div className="update-announcement-media-empty">{block.type === "image" ? t("account.layout.updates.imagePending") : t("account.layout.updates.videoPending")}</div>
                                                )}
                                                {block.caption ? <figcaption>{block.caption}</figcaption> : null}
                                            </figure>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                ))
            ) : (
                <p className="update-announcement-empty">{t("account.layout.updates.empty")}</p>
            )}
        </div>
    );
}
