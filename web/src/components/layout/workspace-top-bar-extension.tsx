import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

type WorkspaceTopBarRegistration = {
    id: string;
    content: ReactNode;
};

type WorkspaceTopBarRegistrar = {
    register: (registration: WorkspaceTopBarRegistration) => void;
    unregister: (id: string) => void;
};

const WorkspaceTopBarRegistrarContext = createContext<WorkspaceTopBarRegistrar | null>(null);
const WorkspaceTopBarContentContext = createContext<ReactNode>(null);

export function WorkspaceTopBarExtensionProvider({ children }: { children: ReactNode }) {
    const [registration, setRegistration] = useState<WorkspaceTopBarRegistration | null>(null);
    const register = useCallback((next: WorkspaceTopBarRegistration) => setRegistration(next), []);
    const unregister = useCallback((id: string) => setRegistration((current) => current?.id === id ? null : current), []);
    const registrar = useMemo(() => ({ register, unregister }), [register, unregister]);

    return (
        <WorkspaceTopBarRegistrarContext.Provider value={registrar}>
            <WorkspaceTopBarContentContext.Provider value={registration?.content || null}>
                {children}
            </WorkspaceTopBarContentContext.Provider>
        </WorkspaceTopBarRegistrarContext.Provider>
    );
}

export function useWorkspaceTopBarExtension(content: ReactNode) {
    const registrar = useContext(WorkspaceTopBarRegistrarContext);
    const id = useId();

    useLayoutEffect(() => {
        if (!registrar) return;
        registrar.register({ id, content });
        return () => registrar.unregister(id);
    }, [content, id, registrar]);
}

export function useWorkspaceTopBarContent() {
    return useContext(WorkspaceTopBarContentContext);
}
