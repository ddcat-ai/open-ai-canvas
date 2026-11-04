import { Button, Input } from "antd";
import { useState } from "react";
import "./fact-review.css";

export function CommerceFactReview({ facts, onApply, onExclude, excludeLabel }: { facts: string[]; onApply: (verified: string) => void; onExclude: () => void; excludeLabel?: string }) {
    const [verified, setVerified] = useState("");
    if (!facts.length) return null;
    return (
        <div className="ecommerce-fact-review">
            <strong>核实商品信息</strong>
            <ul>
                {facts.map((fact, index) => (
                    <li key={index}>{fact}</li>
                ))}
            </ul>
            <label>
                补充已核实的真实资料
                <Input.TextArea rows={3} value={verified} placeholder="例如：表带材质已确认是 PU。请填写明确资料；不能把“材质未知”等问题直接确认为事实。" onChange={(event) => setVerified(event.target.value)} />
            </label>
            <p>补充真实资料后需重新策划。也可审阅图片提示词后明确排除这些主张；排除约束将逐张提交，信息不会被标记为真实事实。</p>
            <Button size="small" disabled={!verified.trim()} onClick={() => onApply(verified.trim())}>
                保存真实补充资料
            </Button>{" "}
            <Button size="small" onClick={onExclude}>
                {excludeLabel || "已审阅，排除这些主张"}
            </Button>
        </div>
    );
}
