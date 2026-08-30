import { resolveAddNodeMenuCommands, type AddNodeMenuContext } from "@/lib/canvas/tool-registry";
import { usePluginStore } from "@/stores/use-plugin-store";

import type { CanvasCreateCommand } from "./canvas-create-menu";

export function useCanvasCreateCommands(context: AddNodeMenuContext, runCommand?: (command: () => void) => void): CanvasCreateCommand[] {
    const installations = usePluginStore((state) => state.installations);
    const pluginStates = usePluginStore((state) => state.pluginStates);
    const enabledPluginIds = new Set(installations.filter((item) => pluginStates[item.manifest.id]?.effectiveEnabled ?? item.enabled).map((item) => item.manifest.id));

    return resolveAddNodeMenuCommands({ ...context, enabledPluginIds }).map((command) => ({
        id: command.id,
        label: command.label,
        icon: command.icon,
        badge: command.badge,
        section: command.section,
        onClick: () => {
            const run = () => command.run(context);
            if (runCommand) runCommand(run);
            else run();
        },
    }));
}
