import { queryOptions } from "@tanstack/react-query";
import { getDrama } from "@/services/api/drama";
import { dramaKeys } from "./drama-query-keys";

export function dramaSummaryQuery(projectId: string) {
    return queryOptions({
        queryKey: dramaKeys.summary(projectId),
        queryFn: ({ signal }) => getDrama(projectId, signal),
        staleTime: 3_000,
    });
}
