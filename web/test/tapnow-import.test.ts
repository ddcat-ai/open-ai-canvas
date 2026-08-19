import { describe, expect, test } from "bun:test";

import { formatTapNowBatchTime, parseTapNowShareID } from "../src/lib/canvas/tapnow-import";

describe("TapNow canvas import helpers", () => {
    test("extracts share IDs from TapNow links", () => {
        expect(parseTapNowShareID("https://app.tapnow.media/tapflow/view/8872a294")).toBe("8872a294");
        expect(parseTapNowShareID("8872a294")).toBe("8872a294");
        expect(parseTapNowShareID("https://app.tapnow.media/tapflow/view/abc_DEF-12?source=share")).toBe("abc_DEF-12");
    });

    test("rejects unrelated links and malformed IDs", () => {
        expect(parseTapNowShareID("https://example.com/tapflow/view/8872a294")).toBe("");
        expect(parseTapNowShareID("https://app.tapnow.ai/tapflow/view/8872a294")).toBe("");
        expect(parseTapNowShareID("https://app.tapnow.media/canvas/8872a294")).toBe("");
        expect(parseTapNowShareID("bad/id")).toBe("");
    });

    test("formats the readable batch label", () => {
        const localTime = new Date(2026, 7, 19, 5, 2);
        expect(formatTapNowBatchTime(localTime.toISOString())).toBe("202608190502");
    });
});
