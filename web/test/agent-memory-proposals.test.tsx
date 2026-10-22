import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentMemoryProposalChanges, AgentMemoryRevisionChanges } from "@/pages/settings/agent-memory-proposals";
import type { AgentMemory, AgentMemoryProposal, AgentMemoryRevision } from "@/services/api/agent-memories";

const memory: AgentMemory = {
    id: "first",
    topic: "canvas.safe-write",
    category: "canvas",
    situation: "修改画布之前",
    lesson: "先读后写",
    source: "用户确认的来源",
    status: "approved",
    hits: 2,
    injected: 3,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
};
const proposal: AgentMemoryProposal = {
    id: "proposal",
    status: "pending",
    version: 2,
    summary: { merged: 1, rewritten: 0, removed: 1, skipped: 0 },
    changes: [{ kind: "merge", before: [memory, { ...memory, id: "second", topic: "canvas.verify" }], after: { ...memory, lesson: "读取、写入、验证结果" } }],
    createdAt: new Date(0).toISOString(),
};

test("proposal preview shows all source memories and resulting content before approval", () => {
    const html = renderToStaticMarkup(<AgentMemoryProposalChanges proposal={proposal} />);
    expect(html).toContain("批准前不会改变记忆");
    expect(html).toContain("修改前");
    expect(html).toContain("修改后");
    expect(html).toContain("合并 2 条记忆");
    expect(html).toContain("canvas.verify");
    expect(html).toContain("读取、写入、验证结果");
    expect(html).toContain("用户确认的来源");
    expect(html).not.toContain("已验证成功");
});

test("restore preview shows complete batch and protects later edits", () => {
    const revision: AgentMemoryRevision = {
        id: "revision",
        proposalId: proposal.id,
        version: 1,
        before: proposal.changes[0].before,
        after: [proposal.changes[0].after],
        createdAt: proposal.createdAt,
    };
    const html = renderToStaticMarkup(<AgentMemoryRevisionChanges revision={revision} />);
    expect(html).toContain("将恢复为");
    expect(html).toContain("canvas.verify");
    expect(html).toContain("后续编辑");
    expect(html).toContain("保留新修改");
    const restored = renderToStaticMarkup(<AgentMemoryRevisionChanges revision={{ ...revision, restoredAt: new Date(0).toISOString() }} />);
    expect(restored).toContain("此版本已恢复");
});

test("no-change proposal clearly has no applicable mutations", () => {
    const html = renderToStaticMarkup(<AgentMemoryProposalChanges proposal={{ ...proposal, status: "no_changes", changes: [] }} />);
    expect(html).toContain("没有可应用的记忆变更");
    expect(html).toContain("无需修改");
});
