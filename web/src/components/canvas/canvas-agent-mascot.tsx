export function CanvasAgentMascot() {
    return (
        <svg className="canvas-agent-mascot" viewBox="0 0 56 56" aria-hidden="true">
            <defs>
                <linearGradient id="agent-shell" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0" stopColor="#ffdf8a" />
                    <stop offset=".42" stopColor="#ff8ebc" />
                    <stop offset="1" stopColor="#8067ff" />
                </linearGradient>
                <linearGradient id="agent-lens" x1="0" x2="1" y1="0" y2="1">
                    <stop stopColor="#17243a" />
                    <stop offset="1" stopColor="#08101d" />
                </linearGradient>
                <radialGradient id="agent-glint" cx="35%" cy="25%">
                    <stop stopColor="#fff" stopOpacity=".95" />
                    <stop offset="1" stopColor="#7cf4e4" stopOpacity="0" />
                </radialGradient>
            </defs>
            <g className="canvas-agent-mascot-body">
                <path d="M17 8 22 4l5 5 7-5 5 5 7-1-2 9c3 4 4 9 4 15 0 13-8 21-20 21S8 45 8 32c0-7 2-12 6-16l-1-8 4 0Z" fill="url(#agent-shell)" />
                <rect x="12" y="13" width="32" height="29" rx="12" fill="url(#agent-lens)" />
                <circle className="canvas-agent-mascot-lens-ring" cx="28" cy="27" r="13" fill="none" stroke="#7cf4e4" strokeWidth="2.5" />
                <circle cx="22" cy="21" r="9" fill="url(#agent-glint)" opacity=".75" />
                <g className="canvas-agent-mascot-eyes" fill="#fafcfd">
                    <ellipse cx="22" cy="27" rx="3.4" ry="4.2" /><ellipse cx="34" cy="27" rx="3.4" ry="4.2" />
                </g>
                <circle cx="22" cy="28" r="1.2" fill="#35466a" /><circle cx="34" cy="28" r="1.2" fill="#35466a" />
                <path d="M24 36q4 3 8 0" fill="none" stroke="#7cf4e4" strokeLinecap="round" strokeWidth="1.5" />
                <path d="m45 8 2-4 2 4 4 2-4 2-2 4-2-4-4-2Z" fill="#7cf4e4" />
            </g>
        </svg>
    );
}
