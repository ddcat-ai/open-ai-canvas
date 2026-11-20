import { describe, expect, test } from "bun:test";

import { DEFAULT_SELECTED_CHAPTERS, defaultChapterSelection, firstChapters, groupChapterEpisodes, toggleChapterRange } from "../src/lib/drama/chapter-selection";

describe("drama chapter selection", () => {
    test("long novels default to the first chapters, short ones select everything", () => {
        expect([...defaultChapterSelection(600)]).toEqual(Array.from({ length: DEFAULT_SELECTED_CHAPTERS }, (_, index) => index));
        expect([...defaultChapterSelection(3)]).toEqual([0, 1, 2]);
        expect([...firstChapters(5, 10)]).toEqual([0, 1, 2, 3, 4]);
        expect([...firstChapters(20, 3, 10)]).toEqual([10, 11, 12]);
    });

    test("shift range toggles both directions", () => {
        const selected = toggleChapterRange(new Set([0]), 4, 2, true);
        expect([...selected].sort((a, b) => a - b)).toEqual([0, 2, 3, 4]);
        expect([...toggleChapterRange(selected, 0, 3, false)]).toEqual([4]);
    });

    test("grouping never merges chapters across a gap", () => {
        const groups = groupChapterEpisodes(
            [
                { position: 0, chars: 10 },
                { position: 1, chars: 20 },
                { position: 2, chars: 5 },
                { position: 4, chars: 7 },
            ],
            2,
        );
        expect(groups).toEqual([
            { label: "第 1–2 章", chars: 30, count: 2 },
            { label: "第 3 章", chars: 5, count: 1 },
            { label: "第 5 章", chars: 7, count: 1 },
        ]);
    });
});
