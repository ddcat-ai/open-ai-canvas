import ReactMarkdown from "react-markdown";
import type { UpdateAnnouncement, UpdateBlock } from "@/lib/update-announcement";
import "./update-announcement-content.css";

export function UpdateAnnouncementContent({ value, mediaURL }: { value: UpdateAnnouncement; mediaURL?: (block: UpdateBlock) => string }) {
    return (
        <div className="update-announcement-content">
            {value.releases.length ? (
                value.releases.map((release) => (
                    <section className="update-announcement-release" key={release.id} aria-label={`版本 ${release.version}`}>
                        <header className="update-announcement-release-heading">
                            <h3>{release.version || "待填写版本"}</h3>
                            {release.version === value.currentVersion ? <span className="update-announcement-badge">当前版本</span> : null}
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
                                                <ReactMarkdown components={{ img: () => null }}>{block.text || "待填写文字内容"}</ReactMarkdown>
                                            </div>
                                        ) : (
                                            <figure>
                                                {url ? (
                                                    block.type === "image" ? (
                                                        <img src={url} alt={block.caption || "更新公告配图"} loading="lazy" />
                                                    ) : (
                                                        <video src={url} controls playsInline preload="metadata" aria-label={block.caption || "更新公告视频"} />
                                                    )
                                                ) : (
                                                    <div className="update-announcement-media-empty">待上传{block.type === "image" ? "图片" : "视频"}</div>
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
                <p className="update-announcement-empty">添加版本与内容后，可在此预览公告。</p>
            )}
        </div>
    );
}
