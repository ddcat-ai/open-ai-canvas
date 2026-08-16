import { useEffect, useState } from "react";
import { Download, ExternalLink, Maximize2 } from "lucide-react";
import { sanitizeResourceUrl } from "./utils";

type Props = {
    content: string;
    status: "streaming" | "idle";
};

export function ArtifactImageBlock({ content, status }: Props) {
    const url = sanitizeResourceUrl(content);
    const [loaded, setLoaded] = useState(false);
    const [isError, setIsError] = useState(false);

    // 当 url 切换时重置加载/错误状态
    useEffect(() => {
        setLoaded(false);
        setIsError(false);
    }, [url]);

    if (!url) {
        return (
            <div className="artifact-image-block">
                <div className="artifact-image-frame">
                    {status === "streaming" ? (
                        <div className="artifact-image-loading" aria-label="图像生成中" />
                    ) : (
                        <div className="artifact-image-empty-inline">缺少图像地址</div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="artifact-image-block">
            <div className="artifact-image-meta">
                <span className="artifact-image-dot is-ready" aria-hidden />
                <span className="artifact-image-name">生成图像</span>
                {status === "streaming" ? (
                    <span className="artifact-streaming-tag">
                        <span className="artifact-status-dot is-streaming" aria-hidden />
                        渲染中…
                    </span>
                ) : null}
            </div>
            <div className="artifact-image-frame">
                {!loaded && !isError ? <div className="artifact-image-loading" aria-label="图像加载中" /> : null}
                {!isError ? (
                    <img
                        src={url}
                        alt="AI 生成图像"
                        className={`artifact-image-img ${loaded ? "is-loaded" : ""}`}
                        onLoad={() => setLoaded(true)}
                        onError={() => setIsError(true)}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                    />
                ) : (
                    <div className="artifact-image-error">
                        <ExternalLink size={18} />
                        <span>图像加载失败，可能为外链资源</span>
                        <a href={url} target="_blank" rel="noreferrer noopener">在新标签页打开</a>
                    </div>
                )}
            </div>
            {status !== "streaming" && !isError ? (
                <div className="artifact-image-actions">
                    <a href={url} target="_blank" rel="noreferrer noopener" className="artifact-image-action">
                        <Maximize2 size={14} />
                        <span>查看大图</span>
                    </a>
                    <a href={url} download className="artifact-image-action">
                        <Download size={14} />
                        <span>下载</span>
                    </a>
                </div>
            ) : null}
        </div>
    );
}
