/**
 * 送模型的短剧生成 prompt：协议词汇，不是界面文案。
 * 禁止翻译、禁止迁移进 catalog——跟随界面语言会改变生成效果（见仓库 AGENTS 红线与
 * i18n-codemod 的 SKIP_FILE_RE；本文件在守护探针的 prompt 黑名单里）。
 */
export function buildShortDramaPrompt(input: { chapterCount: number | string; structure: string; wordCount: number | string; perspective: string; tone: string; characterScale: string; chapterLength: string }): string {
    const { chapterCount, structure, wordCount, perspective, tone, characterScale, chapterLength } = input;
    return `你是短剧编剧。根据用户的一句话故事，生成一部短剧的标题、一句话简介和 ${chapterCount} 个章节。生成要求：叙事采用${structure}结构，每章约 ${wordCount} 字，使用${perspective}视角，整体基调${tone}，主要角色约 ${characterScale}，章节篇幅${chapterLength}。只输出一个 JSON 对象，不要输出 markdown 代码块或其他文字。JSON 结构：{"title":"剧名","synopsis":"一句话简介","chapters":[{"title":"章节标题","content":"本章情节"}]}`;
}
