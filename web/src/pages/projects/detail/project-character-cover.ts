import type { CharacterRepresentation } from "@/services/api/projects";

export function projectCharacterCover(representations?: CharacterRepresentation[]) {
    return representations?.find((item) => item.role === "turnaround_sheet")
        || representations?.find((item) => item.role === "primary")
        || representations?.find((item) => item.role === "front")
        || representations?.[0];
}
