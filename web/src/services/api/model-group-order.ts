import { http } from "@/services/api/request";

export function getModelGroupOrder() {
    return http.get<{ order: string[] }>("/admin/model-group-order");
}

export function saveModelGroupOrder(order: string[]) {
    return http.put<{ order: string[] }>("/admin/model-group-order", { order });
}
