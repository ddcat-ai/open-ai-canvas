import { getActiveUserScope } from "@/lib/user-scope";

type CanvasIntentAdapter = {
    bind(nodeId: string, intentId: string): void;
    owns(nodeId: string, intentId: string): boolean;
    persist(): Promise<void>;
};

const key = (scope: string, projectId: string) => `${scope}\0${projectId}`;

export function createCanvasLiteIntentRegistry(currentScope = getActiveUserScope) {
    const adapters = new Map<string, CanvasIntentAdapter>();
    function register(scope: string, projectId: string, adapter: CanvasIntentAdapter) {
        const adapterKey = key(scope, projectId);
        adapters.set(adapterKey, adapter);
        return () => {
            if (adapters.get(adapterKey) === adapter) adapters.delete(adapterKey);
        };
    }

    async function persist(input: { projectId: string; nodeId: string; intentId: string; signal?: AbortSignal; onBound?: () => void }) {
        const scope = currentScope();
        const adapterKey = key(scope, input.projectId);
        const adapter = adapters.get(adapterKey);
        const validate = () => {
            if (input.signal?.aborted) throw new DOMException("请求已取消", "AbortError");
            if (!scope || scope === "guest" || currentScope() !== scope || !adapter || adapters.get(adapterKey) !== adapter) throw new Error("画布或账号已切换，生成请求未发送");
        };
        validate();
        adapter!.bind(input.nodeId, input.intentId);
        if (!adapter!.owns(input.nodeId, input.intentId)) throw new Error("画布节点已不存在，生成请求未发送");
        input.onBound?.();
        await adapter!.persist();
        validate();
        if (!adapter!.owns(input.nodeId, input.intentId)) throw new Error("画布节点已变更，生成请求未发送");
    }
    return { register, persist };
}

const registry = createCanvasLiteIntentRegistry();
export const registerCanvasLiteIntentAdapter = registry.register;
export const persistCanvasLiteIntent = registry.persist;
