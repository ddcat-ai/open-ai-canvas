import type { ReactNode, SVGProps } from "react";

/** Icons required by the ecommerce Agent. */
export type EcommerceIconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function Svg({ size = 24, strokeWidth = 1.6, children, ...props }: EcommerceIconProps & { children: ReactNode }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            {children}
        </svg>
    );
}

const tone = { fill: "currentColor", fillOpacity: 0.16, stroke: "none" } as const;
const solid = { fill: "currentColor", stroke: "none" } as const;

export function ExportIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <rect x="3.5" y="4" width="17" height="4.6" rx="1.6" {...tone} />
            <rect x="3.5" y="4" width="17" height="4.6" rx="1.6" />
            <path d="M5.2 8.6v8.4a2.5 2.5 0 0 0 2.5 2.5h8.6a2.5 2.5 0 0 0 2.5-2.5V8.6" />
            <path d="M12 11.3v5.2M9.7 14.3 12 16.6l2.3-2.3" />
        </Svg>
    );
}

export function GlobeIcon(props: EcommerceIconProps) {
    const meridian = "M12 3.5c-2.3 2.3-3.5 5.1-3.5 8.5s1.2 6.2 3.5 8.5c2.3-2.3 3.5-5.1 3.5-8.5S14.3 5.8 12 3.5Z";
    return (
        <Svg {...props}>
            <path d={meridian} {...tone} />
            <circle cx="12" cy="12" r="8.5" />
            <path d={meridian} />
            <path d="M3.9 9.4h16.2M3.9 14.6h16.2" />
        </Svg>
    );
}

export function HandIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <path d="M7.6 12.4h12.8v1.4c0 4-3 6.7-6.8 6.7h-1.2c-2.2 0-3.7-.8-5-2.3L5 15.4Z" {...tone} />
            <path d="M7.6 13.2V7.4a1.6 1.6 0 0 1 3.2 0v4.2M10.8 11.4V5.6a1.6 1.6 0 0 1 3.2 0v5.8M14 11.4V7.2a1.6 1.6 0 0 1 3.2 0v4.6" />
            <path d="M17.2 9.6a1.6 1.6 0 0 1 3.2 0v4.2c0 4-3 6.7-6.8 6.7h-1.2c-2.2 0-3.7-.8-5-2.3l-3-3.5a1.6 1.6 0 0 1 2.4-2.1l.8.9" />
        </Svg>
    );
}

export function HistoryIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <circle cx="12.2" cy="12" r="7.6" {...tone} />
            <path d="M4.6 12a7.6 7.6 0 1 0 2.3-5.4L4.6 8.8M4.6 4.9v3.9h3.9" />
            <path d="M12.2 8.3v3.9l2.7 1.7" />
        </Svg>
    );
}

export function ImageNodeIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <rect x="3.5" y="4.5" width="17" height="15" rx="3.2" />
            <path d="M3.9 16.3 8 12.2a1.6 1.6 0 0 1 2.3 0l6.6 6.8" {...tone} />
            <path d="M3.9 16.3 8 12.2a1.6 1.6 0 0 1 2.3 0l6.6 6.8M14.3 16.2l1.5-1.5a1.6 1.6 0 0 1 2.3 0l2.2 2.2" />
            <circle cx="15.8" cy="8.9" r="1.6" {...solid} />
        </Svg>
    );
}

export function ImagePlusIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <path d="M3.9 16.3 8 12.2a1.6 1.6 0 0 1 2.3 0l6.6 6.8" {...tone} />
            <path d="M20.5 11.8v4.5a3.2 3.2 0 0 1-3.2 3.2H6.7a3.2 3.2 0 0 1-3.2-3.2V7.7a3.2 3.2 0 0 1 3.2-3.2h5.5" />
            <path d="M3.9 16.3 8 12.2a1.6 1.6 0 0 1 2.3 0l6.6 6.8M14.3 16.2l1.5-1.5a1.6 1.6 0 0 1 2.3 0l2.2 2.2" />
            <path d="M18 3.2v5.6M15.2 6h5.6" />
        </Svg>
    );
}

export function LayersIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <path d="M12 3.8 20.4 8.4 12 13 3.6 8.4Z" {...tone} />
            <path d="M12 3.8 20.4 8.4 12 13 3.6 8.4Z" />
            <path d="m3.6 12.2 8.4 4.6 8.4-4.6M3.6 15.9l8.4 4.6 8.4-4.6" />
        </Svg>
    );
}

export function LayoutIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <rect x="3.5" y="4" width="17" height="16" rx="3" />
            <rect x="6.4" y="6.9" width="11.2" height="3.7" rx="1.2" {...tone} />
            <rect x="6.4" y="6.9" width="11.2" height="3.7" rx="1.2" />
            <rect x="6.4" y="13.2" width="4.6" height="4" rx="1.2" />
            <path d="M13.8 13.6h3.8M13.8 16.8h2.4" />
        </Svg>
    );
}

export function LightbulbIcon(props: EcommerceIconProps) {
    const bulb = "M12 3.6a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v.4h5v-.4c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3.6Z";
    return (
        <Svg {...props}>
            <path d={bulb} {...tone} />
            <path d={bulb} />
            <path d="M9.8 19.5h4.4M10.7 21.3h2.6" />
        </Svg>
    );
}

export function NavCreateIcon({ size = 20, ...props }: EcommerceIconProps) {
    const star = "M12 3.2c.6 4.4 3 6.8 7.4 7.4-4.4.6-6.8 3-7.4 7.4-.6-4.4-3-6.8-7.4-7.4 4.4-.6 6.8-3 7.4-7.4Z";
    return (
        <Svg size={size} strokeWidth={1.7} {...props}>
            <path d={star} {...tone} />
            <path d={star} />
            <circle cx="19" cy="19" r="1.4" {...solid} />
        </Svg>
    );
}

export function NewChatIcon(props: EcommerceIconProps) {
    const bubble = "M6 4.5h12a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5h-7.4l-3.8 2.9v-2.9H6A2.5 2.5 0 0 1 3.5 15V7A2.5 2.5 0 0 1 6 4.5Z";
    return (
        <Svg {...props}>
            <path d={bubble} {...tone} />
            <path d={bubble} />
            <path d="M12 8.4v5.2M9.4 11h5.2" />
        </Svg>
    );
}

export function PaletteIcon(props: EcommerceIconProps) {
    const body = "M12 3.6c-4.8 0-8.5 3.6-8.5 8.2 0 4.5 3.6 8.2 8 8.2 1.3 0 2.1-.8 2.1-1.9 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8h2.1c2.2 0 4-1.8 4-4 0-3.4-3.8-6.1-8.5-6.1Z";
    return (
        <Svg {...props}>
            <path d={body} {...tone} />
            <path d={body} />
            <circle cx="7.9" cy="11.6" r="1.15" {...solid} />
            <circle cx="10.4" cy="7.9" r="1.15" {...solid} />
            <circle cx="14.7" cy="8.1" r="1.15" {...solid} />
        </Svg>
    );
}

export function PanelCollapseIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <path d="M3.5 7.7a3.2 3.2 0 0 1 3.2-3.2h2.6v15H6.7a3.2 3.2 0 0 1-3.2-3.2Z" {...tone} />
            <rect x="3.5" y="4.5" width="17" height="15" rx="3.2" />
            <path d="M9.3 4.5v15M15.8 9.6 13.4 12l2.4 2.4" />
        </Svg>
    );
}

export function PanelExpandIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <path d="M3.5 7.7a3.2 3.2 0 0 1 3.2-3.2h2.6v15H6.7a3.2 3.2 0 0 1-3.2-3.2Z" {...tone} />
            <rect x="3.5" y="4.5" width="17" height="15" rx="3.2" />
            <path d="M9.3 4.5v15M13.4 9.6l2.4 2.4-2.4 2.4" />
        </Svg>
    );
}

export function PointerIcon(props: EcommerceIconProps) {
    const arrow = "M5.6 4.6 18.7 10.1a.6.6 0 0 1-.1 1.1l-5.4 1.6a1 1 0 0 0-.6.6l-1.9 5.3a.6.6 0 0 1-1.1 0Z";
    return (
        <Svg {...props}>
            <path d={arrow} {...tone} />
            <path d={arrow} />
        </Svg>
    );
}

export function ProductDetailNodeIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <rect x="5.5" y="3" width="13" height="18" rx="2.8" />
            <rect x="8" y="5.8" width="8" height="6" rx="1.4" {...tone} />
            <rect x="8" y="5.8" width="8" height="6" rx="1.4" />
            <path d="M8 15h8M8 18h5" />
        </Svg>
    );
}

export function QueueIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <rect x="3.6" y="4.6" width="4" height="4" rx="1.3" />
            <rect x="3.6" y="10" width="4" height="4" rx="1.3" {...tone} />
            <rect x="3.6" y="10" width="4" height="4" rx="1.3" />
            <rect x="3.6" y="15.4" width="4" height="4" rx="1.3" />
            <path d="M10.8 6.6h9.6M10.8 12h9.6M10.8 17.4h6.4" />
        </Svg>
    );
}

export function RedoIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <path d="m15 14 4.5-4.5L15 5" />
            <path d="M19.2 9.5H9.5a5 5 0 0 0 0 10H13" />
        </Svg>
    );
}

export function RefreshIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <path d="M19.5 12a7.5 7.5 0 0 1-13.1 5M4.5 12a7.5 7.5 0 0 1 13.1-5" />
            <path d="M17.9 3.6v3.6h-3.6M6.1 20.4v-3.6h3.6" />
        </Svg>
    );
}

export function SettingsIcon(props: EcommerceIconProps) {
    const gear =
        "M10.5 5.7 10.8 3.5A8.6 8.6 0 0 1 13.2 3.5L13.5 5.7A6.5 6.5 0 0 1 15.4 6.5L17.2 5.1A8.6 8.6 0 0 1 18.9 6.8L17.5 8.6A6.5 6.5 0 0 1 18.3 10.5L20.5 10.8A8.6 8.6 0 0 1 20.5 13.2L18.3 13.5A6.5 6.5 0 0 1 17.5 15.4L18.9 17.2A8.6 8.6 0 0 1 17.2 18.9L15.4 17.5A6.5 6.5 0 0 1 13.5 18.3L13.2 20.5A8.6 8.6 0 0 1 10.8 20.5L10.5 18.3A6.5 6.5 0 0 1 8.6 17.5L6.8 18.9A8.6 8.6 0 0 1 5.1 17.2L6.5 15.4A6.5 6.5 0 0 1 5.7 13.5L3.5 13.2A8.6 8.6 0 0 1 3.5 10.8L5.7 10.5A6.5 6.5 0 0 1 6.5 8.6L5.1 6.8A8.6 8.6 0 0 1 6.8 5.1L8.6 6.5A6.5 6.5 0 0 1 10.5 5.7Z";
    return (
        <Svg {...props}>
            <path d={gear} {...tone} />
            <path d={gear} />
            <circle cx="12" cy="12" r="2.6" />
        </Svg>
    );
}

export function SlidersIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <path d="M4 7h7M15 7h5M4 12h3M11 12h9M4 17h9M17 17h3" />
            <circle cx="13" cy="7" r="2" {...tone} />
            <circle cx="13" cy="7" r="2" />
            <circle cx="9" cy="12" r="2" {...tone} />
            <circle cx="9" cy="12" r="2" />
            <circle cx="15" cy="17" r="2" {...tone} />
            <circle cx="15" cy="17" r="2" />
        </Svg>
    );
}

export function StyleLibraryIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <rect x="3.5" y="3.5" width="7.4" height="7.4" rx="2.2" {...tone} />
            <rect x="3.5" y="3.5" width="7.4" height="7.4" rx="2.2" />
            <rect x="13.1" y="3.5" width="7.4" height="7.4" rx="2.2" />
            <rect x="3.5" y="13.1" width="7.4" height="7.4" rx="2.2" />
            <rect x="13.1" y="13.1" width="7.4" height="7.4" rx="2.2" />
        </Svg>
    );
}

export function TextNodeIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <path d="M5.5 7.2V5.5h13v1.7" />
            <path d="M12 5.5v13" />
            <path d="M9.4 18.5h5.2" />
        </Svg>
    );
}

export const TextToolIcon = TextNodeIcon;

export function UndoIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <path d="M9 14 4.5 9.5 9 5" />
            <path d="M4.8 9.5h9.7a5 5 0 0 1 0 10H11" />
        </Svg>
    );
}

export function UploadIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <path d="M4 14.6h16v2.2a2.7 2.7 0 0 1-2.7 2.7H6.7A2.7 2.7 0 0 1 4 16.8Z" {...tone} />
            <path d="M4 14.6v2.2a2.7 2.7 0 0 0 2.7 2.7h10.6a2.7 2.7 0 0 0 2.7-2.7v-2.2" />
            <path d="M12 15.2V4.8M8.2 8.4 12 4.6l3.8 3.8" />
        </Svg>
    );
}

export function VideoNodeIcon(props: EcommerceIconProps) {
    return (
        <Svg {...props}>
            <rect x="3" y="5.5" width="13.5" height="13" rx="3" {...tone} />
            <rect x="3" y="5.5" width="13.5" height="13" rx="3" />
            <path d="m16.5 10.3 3.3-2.1a.8.8 0 0 1 1.2.7v6.2a.8.8 0 0 1-1.2.7l-3.3-2.1" />
            <path d="M8.4 9.7v4.6l3.7-2.3Z" {...solid} />
        </Svg>
    );
}
