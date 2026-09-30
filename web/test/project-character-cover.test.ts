import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import type { CharacterRepresentation } from "../src/services/api/projects";
import { projectCharacterCover } from "../src/pages/projects/detail/project-character-cover";

const characterCardSource = readFileSync(resolve(import.meta.dir, "../src/pages/projects/detail/project-character-card.tsx"), "utf8");
const projectAssetsSource = readFileSync(resolve(import.meta.dir, "../src/pages/projects/detail/assets.tsx"), "utf8");

describe("project character cover selection", () => {
    test("prefers the front representation over an earlier side representation", () => {
        const representations: CharacterRepresentation[] = [
            { id: "side", resourceId: "side-image", mediaType: "image", role: "side" },
            { id: "front", resourceId: "front-image", mediaType: "image", role: "front" },
        ];

        expect(projectCharacterCover(representations)?.resourceId).toBe("front-image");
    });

    test("uses the same cover selector for cards and the preview modal", () => {
        expect(characterCardSource).toContain("projectCharacterCover(character?.representations)");
        expect(projectAssetsSource).toContain("projectCharacterCover(asset?.character?.representations)");
    });
});
