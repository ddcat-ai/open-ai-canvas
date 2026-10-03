import type { HomepageCreationGenerationRequest } from "@/lib/plugins/plugin-types";

export type HomepageGenerationExecutor = (request: HomepageCreationGenerationRequest) => Promise<void>;

/**
 * Runs the Agent's planned items in queue order. The Agent owns the number of
 * requests; the generic composer count selector is never consulted here.
 */
export async function executeHomepageGenerationPlan(
    requests: HomepageCreationGenerationRequest[],
    execute: HomepageGenerationExecutor,
) {
    for (const request of requests) await execute(request);
}
