import { expect, test } from "bun:test";
import { commerceKnowledgeDomainRows } from "../src/pages/admin/knowledge-domain-coverage";

test("admin knowledge coverage always lists KB01-KB19 and marks missing domains empty", () => {
    const rows = commerceKnowledgeDomainRows({ KB01: 12, KB04: 3, legacy: 8 });

    expect(rows).toHaveLength(19);
    expect(rows.map(({ id }) => id)).toEqual(["KB01", "KB02", "KB03", "KB04", "KB05", "KB06", "KB07", "KB08", "KB09", "KB10", "KB11", "KB12", "KB13", "KB14", "KB15", "KB16", "KB17", "KB18", "KB19"]);
    expect(rows[0]).toMatchObject({ label: "全球电商行业", count: 12 });
    expect(rows[3]).toMatchObject({ label: "主图与详情页排版", count: 3 });
    expect(rows[1].count).toBe(0);
});

test("missing admin domain coverage safely renders nineteen empty knowledge domains", () => {
    expect(commerceKnowledgeDomainRows()).toHaveLength(19);
    expect(commerceKnowledgeDomainRows().every(({ count }) => count === 0)).toBe(true);
});
