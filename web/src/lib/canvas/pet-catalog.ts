import type { PetAppearance } from "@/services/api/appearance";

export const PET_CATALOG_LIMIT = 64;
export const PET_CATALOG_PAGE_SIZE = 12;

export async function spriteImportID(file: Blob) {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return (
        "import-" +
        Array.from(new Uint8Array(digest))
            .map((value) => value.toString(16).padStart(2, "0"))
            .join("")
            .slice(0, 48)
    );
}

export function filterPetCatalog(catalog: PetAppearance[], query: string, status = "all") {
    const term = query.trim().toLocaleLowerCase();
    return catalog.filter((pet) => (!term || pet.name.toLocaleLowerCase().includes(term)) && (status === "all" || pet.published === (status === "published")));
}
