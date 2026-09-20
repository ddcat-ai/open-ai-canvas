import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const WorkspaceTopBarMountContext = createContext<HTMLElement | null | undefined>(undefined);
const WorkspaceTopBarMountSetterContext = createContext<(node: HTMLElement | null) => void>(() => undefined);

export function WorkspaceTopBarExtensionProvider({ children }: { children: ReactNode }) {
    const [mount, setMount] = useState<HTMLElement | null>(null);

    return (
        <WorkspaceTopBarMountSetterContext.Provider value={setMount}>
            <WorkspaceTopBarMountContext.Provider value={mount}>
                {children}
            </WorkspaceTopBarMountContext.Provider>
        </WorkspaceTopBarMountSetterContext.Provider>
    );
}

export function WorkspaceTopBarExtensionSlot() {
    const setMount = useContext(WorkspaceTopBarMountSetterContext);
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        setMount(ref.current);
        return () => setMount(null);
    }, [setMount]);

    return <div className="app-workspace-topbar-extension" ref={ref} />;
}

export function useWorkspaceTopBarMount() {
    return useContext(WorkspaceTopBarMountContext);
}
