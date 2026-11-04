import localforage from "localforage";

import { createProviderNeutralGenerationTaskEffectStore } from "../../src/services/provider-neutral-generation-effects";
import type { GenerationTaskEffectStore } from "../../src/services/generation-task-materializer";

type ResponseMessage = { kind: "response"; id: number; value?: unknown };
type CommandMessage = { kind: "command"; id: number; action: string; args: unknown[] };
let sequence = 0;
const pending = new Map<number, (value: unknown) => void>();
let effects: GenerationTaskEffectStore;

function request(action: string, ...args: unknown[]) {
    const id = ++sequence;
    return new Promise<unknown>((resolve) => {
        pending.set(id, resolve);
        postMessage({ kind: "request", id, action, args });
    });
}

function initialize(options: { browserLocks: boolean; required: boolean }) {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: () => "shared-effect-owner" } } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: options.browserLocks
            ? {
                  locks: {
                      request: async <T>(name: string, callback: () => Promise<T>) => {
                          await request("lock", name);
                          try {
                              return await callback();
                          } finally {
                              await request("unlock", name);
                          }
                      },
                  },
              }
            : {},
    });
    localforage.getItem = ((key: string) => request("get", key)) as typeof localforage.getItem;
    localforage.setItem = ((key: string, value: unknown) => request("set", key, value)) as typeof localforage.setItem;
    effects = createProviderNeutralGenerationTaskEffectStore({ requireCrossRealmLock: options.required });
}

self.onmessage = async (event: MessageEvent<ResponseMessage | CommandMessage>) => {
    const message = event.data;
    if (message.kind === "response") {
        pending.get(message.id)?.(message.value);
        pending.delete(message.id);
        return;
    }
    try {
        let value: unknown;
        if (message.action === "initialize") initialize(message.args[0] as Parameters<typeof initialize>[0]);
        else if (message.action === "claim") value = await effects.claim(message.args[0] as string, message.args[1] as string);
        else if (message.action === "renew") value = await effects.renew(message.args[0] as string, message.args[1] as string, message.args[2] as string);
        else if (message.action === "complete") value = await effects.complete(message.args[0] as string, message.args[1] as string, message.args[2] as { materializedAssetId?: string }, message.args[3] as string);
        else throw new Error(`Unknown command: ${message.action}`);
        postMessage({ kind: "result", id: message.id, value });
    } catch (error) {
        postMessage({ kind: "result", id: message.id, error: error instanceof Error ? error.message : String(error) });
    }
};
