export type TextDiffLine = {
    type: "same" | "add" | "del";
    text: string;
};

/** 轻量行级 diff：适合章节正文预览，不追求最小编辑距离。 */
export function computeLineDiff(before: string, after: string): TextDiffLine[] {
    const left = splitLines(before);
    const right = splitLines(after);
    if (!left.length && !right.length) return [];
    const lcs = longestCommonSubsequence(left, right);
    const result: TextDiffLine[] = [];
    let i = 0;
    let j = 0;
    let k = 0;
    while (i < left.length || j < right.length) {
        if (k < lcs.length && i < left.length && left[i] === lcs[k] && j < right.length && right[j] === lcs[k]) {
            result.push({ type: "same", text: lcs[k] });
            i += 1;
            j += 1;
            k += 1;
            continue;
        }
        if (k < lcs.length && i < left.length && left[i] !== lcs[k]) {
            result.push({ type: "del", text: left[i] });
            i += 1;
            continue;
        }
        if (k < lcs.length && j < right.length && right[j] !== lcs[k]) {
            result.push({ type: "add", text: right[j] });
            j += 1;
            continue;
        }
        if (i < left.length) {
            result.push({ type: "del", text: left[i] });
            i += 1;
            continue;
        }
        if (j < right.length) {
            result.push({ type: "add", text: right[j] });
            j += 1;
        }
    }
    return result;
}

export function splitLines(value: string) {
    if (!value) return [] as string[];
    return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function longestCommonSubsequence(left: string[], right: string[]) {
    const m = left.length;
    const n = right.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 1; i <= m; i += 1) {
        for (let j = 1; j <= n; j += 1) {
            dp[i][j] = left[i - 1] === right[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }
    const sequence: string[] = [];
    let i = m;
    let j = n;
    while (i > 0 && j > 0) {
        if (left[i - 1] === right[j - 1]) {
            sequence.push(left[i - 1]);
            i -= 1;
            j -= 1;
        } else if (dp[i - 1][j] >= dp[i][j - 1]) {
            i -= 1;
        } else {
            j -= 1;
        }
    }
    return sequence.reverse();
}
