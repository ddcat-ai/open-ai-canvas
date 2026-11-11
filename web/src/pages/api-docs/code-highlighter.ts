export type DocumentationCodeLanguage = "bash" | "json" | "text";

type Highlighter = Awaited<ReturnType<typeof import("shiki").createHighlighter>>;
let highlighterPromise: Promise<Highlighter> | null = null;

export async function highlightCode(code: string, lang: DocumentationCodeLanguage): Promise<string> {
    if (!highlighterPromise) {
        highlighterPromise = import("shiki")
            .then(({ createHighlighter }) => createHighlighter({ langs: ["bash", "json"], themes: ["github-light", "github-dark"] }))
            .catch((error) => {
                highlighterPromise = null;
                throw error;
            });
    }
    const highlighter = await highlighterPromise;
    return highlighter.codeToHtml(code, { lang, themes: { light: "github-light", dark: "github-dark" }, defaultColor: false, cssVariablePrefix: "--shiki-" });
}
