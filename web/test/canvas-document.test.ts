import { describe, expect, test } from "bun:test";
import { decodeNovelText, splitTextIntoChapters } from "../src/lib/canvas/canvas-document";

describe("splitTextIntoChapters", () => {
    test("识别常见中文、Markdown、装饰符与英文标题", () => {
        const chapters = splitTextIntoChapters(`书名与作者

第 1 章 初入江湖
第一章正文

＃ 第２章 风雨欲来
第二章正文

【第三章】再会故人
第三章正文

卷四 山河故人
第四章正文

Epilogue: 重逢
尾声正文`);

        expect(chapters.map((chapter) => chapter.title)).toEqual(["序章", "第 1 章 初入江湖", "第２章 风雨欲来", "【第三章】再会故人", "卷四 山河故人", "Epilogue: 重逢"]);
        expect(chapters[0].plainText).toBe("书名与作者");
        expect(chapters[2].plainText).toBe("第二章正文");
    });

    test("普通正文和未识别文本保持为单个章节", () => {
        const text = "这是第一章中发生的故事。\n角色继续前行。";
        const chapters = splitTextIntoChapters(text);

        expect(chapters).toHaveLength(1);
        expect(chapters[0].title).toBe("第 1 章");
        expect(chapters[0].plainText).toBe(text);
    });
});

describe("decodeNovelText", () => {
    test("解码带 BOM 的 UTF-16LE", () => {
        const bytes = new Uint8Array([0xff, 0xfe, 0x2c, 0x7b, 0x00, 0x4e, 0xe0, 0x7a]);
        expect(decodeNovelText(bytes.buffer)).toBe("第一章");
    });

    test("UTF-8 严格解码失败后回退到 GB18030", () => {
        const bytes = new Uint8Array([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x0a, 0xd5, 0xfd, 0xce, 0xc4]);
        expect(decodeNovelText(bytes.buffer)).toBe("第一章\n正文");
    });
});
