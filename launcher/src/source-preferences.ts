import type { Config } from "./bridge";

// Keep the existing core contract: disabled is strict direct-only, never fallback.
export function setMirrorEnabled(config: Config, enabled: boolean): Config {
  return { ...config, sourceMode: enabled ? "mirror" : "official" };
}
