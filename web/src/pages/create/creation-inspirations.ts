import { curatedInspirations, inspirationSources } from "@/lib/inspirations/catalog";

/** Compatibility exports for the original creation page inspiration contract. */
export const creationFeaturedWorks = curatedInspirations.map(({ sourceId, credit, ...item }) => ({
    ...item,
    ...(sourceId === "chatgpt-prompts" && credit ? { source: credit } : {}),
}));

export const inspirationSource = inspirationSources["chatgpt-prompts"];
