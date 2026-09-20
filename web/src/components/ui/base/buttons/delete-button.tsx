import { Button, Popover } from "antd";
import { Check, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";

/** 原位确认只在真实请求完成后关闭；失败保留操作上下文。 */
export function DeleteButton({ label, description, onConfirm }: { label: string; description: string; onConfirm: () => Promise<unknown> }) {
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");
    const busy = useRef(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const close = () => { if (!busy.current) { setOpen(false); trigger.current?.focus(); } };
    const confirm = async () => {
        if (busy.current) return;
        busy.current = true;
        setPending(true);
        setError("");
        try { await onConfirm(); setOpen(false); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败，请重试"); }
        finally { busy.current = false; setPending(false); }
    };
    return <span className="product-delete" onClick={(event) => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
        <Popover trigger="click" placement="bottomRight" open={open} onOpenChange={(next) => { if (!busy.current) { setOpen(next); setError(""); } }} content={
            <div className="product-delete-confirm" role="dialog" aria-label={label} aria-busy={pending}>
                <strong>{label}？</strong>
                <p>{description}</p>
                {error ? <p role="alert" className="product-delete-error">{error}</p> : null}
                <div className="product-delete-confirm-actions">
                    <Button autoFocus icon={<X />} disabled={pending} onClick={close}>取消</Button>
                    <Button danger type="primary" icon={<Check />} loading={pending} onClick={() => void confirm()}>确认删除</Button>
                </div>
            </div>
        }>
            <button ref={trigger} type="button" className="product-icon-button product-delete-trigger" aria-label={label} aria-expanded={open} aria-haspopup="dialog"><Trash2 /></button>
        </Popover>
    </span>;
}
