import type { MouseEvent, ReactNode } from "react";
import { Clapperboard, Film, ImageIcon, ListVideo, Pencil, Rows3, ScrollText } from "lucide-react";
import type { DramaCast, DramaSegment, DramaShot } from "@/services/api/drama";
import { useResourceMediaUrl } from "../drama-shared";
import { secondsLabel, SegmentInputs, segmentState } from "./segment-parts";

type TableProps = {
    segments: DramaSegment[];
    shotsBySegment: Map<number, DramaShot[]>;
    aspectRatio: string;
    castById: Map<string, DramaCast>;
    selected: Set<number>;
    focused?: number;
    onSegmentClick: (event: MouseEvent, segmentIndex: number) => void;
    onOpen: (segmentIndex: number, shotId?: string) => void;
    renderSegmentControls: (segment: DramaSegment, frame: ReactNode) => ReactNode;
};

type SegmentRowProps = Pick<TableProps, "castById" | "onSegmentClick" | "onOpen" | "renderSegmentControls"> & {
    segment: DramaSegment;
    shots?: DramaShot[];
    selected: boolean;
    focused: boolean;
};

function CellContent({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
    return (
        <div className={className ? `drama-sg-table-cell ${className}` : "drama-sg-table-cell"} tabIndex={0} role="group" aria-label={label}>
            {children}
        </div>
    );
}

function SegmentRow({ segment, shots, castById, selected, focused, onSegmentClick, onOpen, renderSegmentControls }: SegmentRowProps) {
    const viewable = segment.videoStatus === "ready" || segment.videoStatus === "stale" || segment.videoStatus === "failed";
    const url = useResourceMediaUrl(viewable ? segment.videoResourceId : undefined, "playback");
    const state = segmentState(segment);
    const segmentLabel = `第 ${segment.index + 1} 段`;

    return (
        <tr
            data-segment={segment.index}
            aria-current={focused || undefined}
            className={selected ? "is-selected" : undefined}
            onClick={(event) => onSegmentClick(event, segment.index)}
            onDoubleClick={(event) => {
                if (!(event.target as HTMLElement).closest("button, input, video, .ant-checkbox-wrapper")) onOpen(segment.index);
            }}
        >
            <td className="drama-sg-table-number-cell">
                <span className="drama-seg-num">{segment.index + 1}</span>
            </td>
            <td className="drama-sg-table-segment-cell">
                <CellContent label={`${segmentLabel}信息`}>{renderSegmentControls(segment, <SegmentInputs segment={segment} castById={castById} compact frameOnly />)}</CellContent>
            </td>
            <td className="drama-sg-table-shot-group">
                <CellContent label={`${segmentLabel}镜头、画面和对白`} className="drama-sg-table-shot-cell">
                    {shots?.length ? (
                        <ol className="drama-sg-table-shots" aria-label={`${segmentLabel}镜头`}>
                            {shots.map((shot) => (
                                <li key={shot.id} className="drama-sg-table-shot-columns">
                                    <div className="drama-sg-table-shot-header">
                                        <button type="button" className="drama-sg-table-shot-number" onClick={() => onOpen(segment.index, shot.id)} aria-label={`打开镜头 ${shot.position + 1}`}>
                                            <span>镜头 {shot.position + 1}</span>
                                            <Pencil size={12} aria-hidden />
                                        </button>
                                        <span className="drama-sg-table-shot-duration">{secondsLabel(shot.durationMs)}</span>
                                    </div>
                                    <p className="drama-sg-table-shot-action">{shot.action || shot.imagePrompt || "未描述画面"}</p>
                                    <p className="drama-sg-table-shot-dialogue">{shot.dialogue ? `${shot.speaker || "旁白"}：${shot.dialogue}` : "—"}</p>
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <div className="drama-sg-table-empty">
                            <Rows3 aria-hidden /> 暂无分镜
                        </div>
                    )}
                </CellContent>
            </td>
            <td className="drama-sg-table-reference-cell">
                <div className="drama-sg-table-reference-head">
                    <span>{segment.request.references.length ? `${segment.request.references.length} 张参考图` : "参考图"}</span>
                    {segment.request.references.length > 6 ? <small>另有 {segment.request.references.length - 6} 张</small> : null}
                </div>
                <CellContent label={`${segmentLabel}参考图`}>
                    {segment.request.references.length ? (
                        <SegmentInputs segment={segment} castById={castById} compact />
                    ) : (
                        <div className="drama-sg-table-empty">
                            <ImageIcon aria-hidden /> 无参考图
                        </div>
                    )}
                </CellContent>
            </td>
            <td>
                <CellContent label={`${segmentLabel}提示词`}>
                    {segment.videoPrompt?.trim() ? (
                        <p className="drama-sg-table-prompt">{segment.videoPrompt}</p>
                    ) : (
                        <div className="drama-sg-table-empty">
                            <ScrollText aria-hidden /> 暂无提示词
                        </div>
                    )}
                </CellContent>
            </td>
            <td className="drama-sg-table-video-cell">
                <div className="drama-sg-table-video" aria-label={`${segmentLabel}视频`} role="group">
                    {url ? (
                        <video key={url} src={url} aria-label={`${segmentLabel}视频`} controls playsInline preload="none" />
                    ) : (
                        <div className="drama-sg-table-video-empty" tabIndex={0}>
                            <Film className="size-4" aria-hidden />
                            <span>{state.label}</span>
                        </div>
                    )}
                    <span className="drama-sg-table-video-label">{segmentLabel}视频</span>
                </div>
            </td>
        </tr>
    );
}

export function StoryboardTable({ segments, shotsBySegment, selected, focused, ...props }: TableProps) {
    return (
        <table className="drama-sg-shot-table" aria-label="分镜列表">
            <colgroup>
                <col className="drama-sg-table-number-col" />
                <col className="drama-sg-table-segment-col" />
                <col />
                <col className="drama-sg-table-reference-col" />
                <col className="drama-sg-table-prompt-col" />
                <col className="drama-sg-table-video-col" />
            </colgroup>
            <thead>
                <tr>
                    <th scope="col" className="drama-sg-table-number-heading">
                        编号
                    </th>
                    <th scope="col">
                        <span>
                            <Clapperboard aria-hidden /> 剧情段
                        </span>
                    </th>
                    <th scope="col" className="drama-sg-table-shot-head">
                        <div className="drama-sg-table-shot-columns">
                            <span>
                                <ListVideo aria-hidden /> 镜头
                            </span>
                            <span>画面</span>
                            <span>对白</span>
                        </div>
                    </th>
                    <th scope="col">
                        <span>
                            <ImageIcon aria-hidden /> 参考图（按段）
                        </span>
                    </th>
                    <th scope="col">
                        <span>
                            <ScrollText aria-hidden /> 提示词
                        </span>
                    </th>
                    <th scope="col">
                        <span>
                            <Film aria-hidden />
                            <span>段视频</span>
                        </span>
                    </th>
                </tr>
            </thead>
            <tbody>
                {segments.map((segment) => (
                    <SegmentRow key={segment.id || segment.index} segment={segment} shots={shotsBySegment.get(segment.index)} selected={selected.has(segment.index)} focused={focused === segment.index} {...props} />
                ))}
            </tbody>
        </table>
    );
}
