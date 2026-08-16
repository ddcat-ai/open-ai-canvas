export type ArtifactKind = "text" | "code" | "image" | "sheet";

export type ArtifactStatus = "streaming" | "idle";

export type ArtifactBlock = {
    kind: ArtifactKind;
    title: string;
    content: string;
    status: ArtifactStatus;
    metadata?: {
        language?: string;
        mime?: string;
        rows?: number;
        cols?: number;
    };
};

export type ArtifactToolbarAction = {
    description: string;
    icon: React.ReactNode;
    onClick: () => void;
};

export type ArtifactFooterAction = {
    icon: React.ReactNode;
    label?: string;
    description: string;
    onClick: () => void;
    isDisabled?: boolean;
};
