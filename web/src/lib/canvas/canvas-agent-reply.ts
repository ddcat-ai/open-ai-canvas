export type CanvasAgentQuickAction = { label: string; prompt: string };
export type CanvasAgentReplyBlock = { kind: "text"; text: string } | { kind: "choices"; actions: CanvasAgentQuickAction[] };

// Parse and replace the same spans so an option cannot disappear without a button.
export function parseCanvasAgentReply(text: string): CanvasAgentReplyBlock[] {
    const blocks: CanvasAgentReplyBlock[] = [];
    let pending: string[] = [];
    let fence: string | undefined;
    let choiceContext = false;
    const flush = () => {
        const content = pending.join("\n").trim();
        if (content) blocks.push({ kind: "text", text: content });
        pending = [];
    };
    for (const line of text.split(/\r?\n/u)) {
        const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
        if (marker) {
            if (!fence) fence = marker[0];
            else if (fence === marker[0]) fence = undefined;
            pending.push(line);
            continue;
        }
        if (fence || line.includes("`") || /^\s*\|/.test(line)) {
            pending.push(line);
            continue;
        }
        if (/(请选择|选择|选项|哪种|什么类型|确认.*(?:要素|信息|项目|项))/u.test(line)) choiceContext = true;
        const matches = [...line.matchAll(/(?<!!)\[([^\[\]\n]{1,96})\](?:\(\s*#\s*\))?(?!\()/gu)];
        const firstIndex = matches[0]?.index ?? 0;
        const prefix = line.slice(0, firstIndex).trim();
        const residual = line.slice(firstIndex).replace(/(?<!!)\[([^\[\]\n]{1,96})\](?:\(\s*#\s*\))?(?!\()/gu, "");
        const heading = prefix.replace(/[*_]/g, "");
        const validPrefix = !prefix || /^[-*+]$/.test(prefix) || /[:：]$/.test(heading);
        const numbered = choiceContext ? /^\s*[-*]\s*\d{1,2}[.)、]\s*(.{1,96})\s*$/u.exec(line) : null;
        const lettered = choiceContext ? /^\s*(?:[-*]\s*)?([A-Z])[.)、]?\s+(.{1,96})\s*$/u.exec(line) : null;
        let labels: string[] = [];
        if (matches.length && validPrefix && /^[\s|｜·•、/;；]*$/u.test(residual) && (matches.length > 1 || choiceContext || /[:：]$/.test(heading))) {
            if (prefix && !/^[-*+]$/.test(prefix)) pending.push(prefix);
            labels = matches.map((match) => match[1].trim()).filter(Boolean);
        } else if (numbered && !/[\[\]]/.test(numbered[1])) {
            labels = [numbered[1].replace(/^[*_\s]+|[*_\s]+$/gu, "")];
        } else if (lettered && !/[\[\]]/.test(lettered[2])) {
            labels = [`${lettered[1]} ${lettered[2].replace(/^[*_\s]+|[*_\s]+$/gu, "")}`];
        }
        if (!labels.length) { pending.push(line); continue; }
        flush();
        const actions = [...new Set(labels)].map((label) => ({ label, prompt: label }));
        const previous = blocks[blocks.length - 1];
        if (previous?.kind === "choices") previous.actions.push(...actions.filter((action) => !previous.actions.some((item) => item.label === action.label)));
        else blocks.push({ kind: "choices", actions });
    }
    flush();
    return blocks;
}

export function extractCanvasAgentQuickActions(text: string): CanvasAgentQuickAction[] {
    return parseCanvasAgentReply(text).flatMap((block) => block.kind === "choices" ? block.actions : []);
}

export function composeCanvasAgentAnswers(blocks: CanvasAgentReplyBlock[], selections: Record<number, string>, customValues: Record<number, string> = {}): string | null {
    const answers: string[] = [];
    for (let index = 0; index < blocks.length; index++) {
        const block = blocks[index];
        if (block.kind !== "choices") continue;
        const selected = block.actions.find((action) => action.label === selections[index]);
        if (!selected) return null;
        const previous = blocks[index - 1];
        const heading = previous?.kind === "text" ? previous.text.split("\n").at(-1)?.replace(/[*_#]/g, "").trim() : "";
        const value = /自定义/u.test(selected.label) ? customValues[index]?.trim() : selected.prompt;
        if (!value) return null;
        answers.push(heading && /[:：]$/.test(heading) ? `${heading}${value}` : value);
    }
    return answers.length ? answers.join("\n") : null;
}
