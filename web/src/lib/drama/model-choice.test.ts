import assert from "node:assert/strict";
import { test } from "node:test";

import { dramaResolutionAfterModelChange, dramaVideoResolutionTiers, dramaVideoResolutionValue } from "./model-choice";
import type { DramaModelOption } from "@/services/api/drama";

function videoOption(resolutions: string[], defaultVideoResolution?: string) {
    return { capability: "video", choice: {}, label: "", videoResolutions: resolutions, defaultVideoResolution, maxAudios: 0 } as DramaModelOption;
}

test("resolution tiers are the sorted union of every loaded video model", () => {
    const tiers = dramaVideoResolutionTiers([videoOption(["720P", "1080p"]), videoOption(["480p", "540p", "768p", "2k", "4k"])], "720p");
    assert.deepEqual(tiers, ["480p", "540p", "720P", "768p", "1080p", "2k", "4k"]);
});

test("resolution tiers keep 720p and 768p apart and dedupe case aliases", () => {
    const tiers = dramaVideoResolutionTiers([videoOption(["720P", "720p", "768p"])]);
    assert.deepEqual(tiers, ["720P", "768p"]);
});

test("a model value is matched by tier, not by original casing", () => {
    assert.equal(dramaVideoResolutionValue(videoOption(["480P", "720P"]), "720p"), "720P");
    assert.equal(dramaVideoResolutionValue(videoOption(["480P", "720P"]), "768p"), "");
    assert.equal(dramaVideoResolutionValue(undefined, "720p"), "");
});

test("switching models keeps a supported resolution and otherwise falls back to the model default", () => {
    assert.equal(dramaResolutionAfterModelChange(videoOption(["480P", "720P"]), "720p"), "720P");
    assert.equal(dramaResolutionAfterModelChange(videoOption(["480P", "720P"]), "768p"), undefined);
    assert.equal(dramaResolutionAfterModelChange(videoOption(["480P", "720P"]), undefined), undefined);
});
