import type { Plugin } from "vite";

/** Keep the startup dependency graph together without pulling in lazy routes. */
export function startupChunks(): Plugin {
    const startupModules = new Set<string>();
    const entryModules = new Set<string>();
    return {
        name: "canvas-startup-chunks",
        apply: "build",
        buildEnd(error) {
            if (error) return;
            const visit = (id: string, target: Set<string>) => {
                if (target.has(id)) return;
                target.add(id);
                const info = this.getModuleInfo(id);
                for (const dependency of info?.importedIds || []) visit(dependency, target);
            };
            for (const id of this.getModuleIds()) {
                if (/[\\/]src[\\/]main\.tsx$/.test(id)) visit(id, entryModules);
                if (/[\\/]src[\\/]application\.tsx$/.test(id)) visit(id, startupModules);
            }
        },
        outputOptions(options) {
            const splitting = typeof options.codeSplitting === "object" ? options.codeSplitting : {};
            return {
                ...options,
                codeSplitting: {
                    ...splitting,
                    groups: [
                        ...(splitting.groups || []),
                        {
                            name: "app-bootstrap",
                            test: (id) => startupModules.has(id) && !entryModules.has(id),
                            // Dedicated framework groups remain authoritative.
                            priority: 5,
                            minSize: 0,
                            includeDependenciesRecursively: false,
                        },
                    ],
                },
            };
        },
    };
}
