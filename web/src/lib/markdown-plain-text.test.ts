import assert from "node:assert/strict";
import test from "node:test";
import { markdownPlainText } from "./markdown-plain-text";

test("markdownPlainText 剥离标题、加粗和列表记号", () => {
    assert.equal(markdownPlainText("## 结论先行\n\n**没有创建任何节点**\n- 第一点\n- 第二点"), "结论先行 没有创建任何节点 第一点 第二点");
});

test("markdownPlainText 围栏代码块替换为占位词，包括未闭合的围栏", () => {
    assert.equal(markdownPlainText("看这段：\n```json\n{\"a\":1}\n```"), "看这段： 代码块");
    assert.equal(markdownPlainText("开头 ```js\nconst a = 1;"), "开头 代码块");
});

test("markdownPlainText 链接保留文案，图片保留 alt", () => {
    assert.equal(markdownPlainText("[文档](https://example.com) 和 ![分镜](a.png)"), "文档 和 分镜");
});

test("markdownPlainText 表格压缩为单元格文本", () => {
    assert.equal(markdownPlainText("| 镜头 | 时长 |\n| --- | --- |\n| 1 | 3s |"), "镜头 时长 1 3s");
});

test("markdownPlainText 行内代码与引用块只保留内容", () => {
    assert.equal(markdownPlainText("> 引用 `generate_media` 工具"), "引用 generate_media 工具");
});
