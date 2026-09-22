import type { ModelTag } from "@/lib/model-tags";
import "@/styles/shared/model-tags.css";

export function ModelTags({ tags }: { tags?: ModelTag[] }) {
    if (!tags?.length) return null;
    return <span className="model-tags" aria-label="模型标签">
        {tags.map((tag, index) => <span key={`${tag.text}-${index}`} className="model-tag" data-color={tag.color}>{tag.text}</span>)}
    </span>;
}
