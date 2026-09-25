import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
    return readFileSync(resolve(import.meta.dir, path), "utf8");
}

describe("playback transcoding feature switch", () => {
    test("is editable from the feature availability panel and saved with the other switches", () => {
        const panel = source("../src/pages/admin/components/feature-availability-panel.tsx");

        expect(panel).toContain('key: "playbackTranscodingEnabled"');
        expect(panel).toContain("playbackTranscodingEnabled: features.playbackTranscodingEnabled");
        expect(panel).toContain("playbackTranscodingEnabled: record.playbackTranscodingEnabled as boolean");
        expect(panel).toContain("`${enabledWorkspaceFeatures}/${workspaceFeatureRows.length} 开放`");
    });

    test("defaults to the existing transcoding behavior", () => {
        const store = source("../src/stores/use-user-store.ts");

        expect(store).toContain("playbackTranscodingEnabled: true,");
    });
});
