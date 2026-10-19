import { expect, test } from "bun:test";
import { filterPetCatalog, spriteImportID } from "../src/lib/canvas/pet-catalog";
import type { PetAppearance } from "../src/services/api/appearance";

test("large catalogs remain searchable past the original limit and combine publication filters", () => {
    const pets = Array.from({ length: 64 }, (_, index) => ({ id: `p${index}`, name: index === 63 ? "Claude娘" : `角色${index}`, published: index % 2 === 0 }) as PetAppearance);
    expect(filterPetCatalog(pets, "")).toHaveLength(64);
    expect(filterPetCatalog(pets, "  CLAUDE ").map((p) => p.id)).toEqual(["p63"]);
    expect(filterPetCatalog(pets, "claude", "published")).toHaveLength(0);
    expect(filterPetCatalog(pets, "claude", "draft").map((p) => p.id)).toEqual(["p63"]);
});

test("repeat imports identify the file contents independently of filenames", async () => {
    const first = await spriteImportID(new File(["atlas-one"], "first.zip"));
    expect(await spriteImportID(new File(["atlas-one"], "renamed.zip"))).toBe(first);
    expect(await spriteImportID(new File(["atlas-two"], "first.zip"))).not.toBe(first);
    expect(first).toMatch(/^import-[a-f0-9]{48}$/);
});
