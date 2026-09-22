import { describe, expect, test } from "bun:test";

import { storyboardRowsFromTask } from "../src/lib/canvas/canvas-project-domain";
import { storyboardRowsToProjectShots } from "../src/pages/projects/detail/chapter-storyboard-production";
import type { GenerationTask } from "../src/services/api/task-center";

function storyboardTask(resultJson: string): GenerationTask {
    return { id: "task-1", resultJson } as GenerationTask;
}

// 后端 canvas_text 任务统一落 {mode, reasoning, text} 包装，模型输出正文嵌在 text 里；
// 分镜解析必须穿透包装取内层 {title, rows}，同时兼容模板路径直接落顶层的结构。
describe("storyboardRowsFromTask", () => {
    test("从 {mode, reasoning, text} 包装的 text 内层解析分镜行", () => {
        const payload = { title: "桃源三结义", rows: [
            { shotNumber: 1, durationSeconds: 8, plotDescription: "朝堂开篇", dialogue: "", characters: ["刘备"], mustHave: ["列队"], optionalDetails: [] },
            { shotNumber: 2, durationSeconds: 10, plotDescription: "告示墙前叹气", dialogue: "唉……", characters: ["刘备", "关羽"] },
        ] };
        const task = storyboardTask(JSON.stringify({ mode: "text", reasoning: "思考过程", text: JSON.stringify(payload) }));
        const result = storyboardRowsFromTask(task);
        expect(result.title).toBe("桃源三结义");
        expect(result.rows).toHaveLength(2);
        expect(result.rows[0].shotNumber).toBe(1);
        expect(result.rows[0].status).toBe("idle");
        expect(result.rows[0].characters).toEqual(["刘备"]);
        expect(result.rows[1].characters).toEqual(["刘备", "关羽"]);
    });

    test("text 内层被 ```json 代码块包裹时仍可解析", () => {
        const payload = { title: "章节", rows: [{ shotNumber: 1, plotDescription: "单镜头" }] };
        const wrappedText = "```json\n" + JSON.stringify(payload) + "\n```";
        const task = storyboardTask(JSON.stringify({ mode: "text", text: wrappedText }));
        expect(storyboardRowsFromTask(task).rows).toHaveLength(1);
    });

    test("text 内层混入解释文字时按首尾大括号截取解析", () => {
        const payload = { title: "章节", rows: [{ shotNumber: 1, plotDescription: "单镜头" }] };
        const noisyText = "以下是分镜表：\n" + JSON.stringify(payload) + "\n如需调整请告知。";
        const task = storyboardTask(JSON.stringify({ mode: "text", text: noisyText }));
        expect(storyboardRowsFromTask(task).rows).toHaveLength(1);
    });

    test("兼容顶层直接落 {title, rows} 的结构", () => {
        const task = storyboardTask(JSON.stringify({ title: "章节", rows: [{ shotNumber: 1, plotDescription: "单镜头" }] }));
        expect(storyboardRowsFromTask(task).rows).toHaveLength(1);
    });

    test("title 不是字符串时仍可恢复任务结果", () => {
        const task = storyboardTask(JSON.stringify({ title: { value: "章节" }, rows: [{ shotNumber: 1, plotDescription: "单镜头" }] }));
        expect(storyboardRowsFromTask(task).title).toBeUndefined();
        expect(storyboardRowsFromTask(task).rows).toHaveLength(1);
    });

    test("text 为结构化对象时仍可解析分镜行", () => {
        const task = storyboardTask(JSON.stringify({ text: { title: "章节", rows: [{ shotNumber: 1, plotDescription: "单镜头" }] } }));
        expect(storyboardRowsFromTask(task).rows).toHaveLength(1);
    });

    test("镜头文本字段不是字符串时仍可继续落库", () => {
        const task = storyboardTask(JSON.stringify({ rows: [{
            plotDescription: { text: "对象形式的剧情" },
            dialogue: ["台词一", "台词二"],
            camera: { value: "中景" },
            motion: { description: "缓慢推进" },
            timeBeats: 3,
        }] }));
        const result = storyboardRowsFromTask(task);
        const shots = storyboardRowsToProjectShots(result.rows);
        expect(shots[0]?.description).toBe("对象形式的剧情");
        expect(shots[0]?.revision.dialogue).toBe("台词一、台词二");
        expect(shots[0]?.revision.cameraAngle).toBe("中景");
        expect(shots[0]?.revision.cameraMovement).toBe("缓慢推进");
        expect(shots[0]?.revision.actionBeats).toEqual([{ description: "3" }]);
    });

    test("text 内层不是 JSON 时抛出缺行错误", () => {
        // 无契约时期模型返回 Markdown 表格的真实场景。
        const task = storyboardTask(JSON.stringify({ mode: "text", text: "| 7-41 | 全景/拉远 | 桃园结义 |" }));
        expect(() => storyboardRowsFromTask(task)).toThrow("分镜任务没有返回镜头行");
    });

    test("rows 为空数组时抛出缺行错误", () => {
        const task = storyboardTask(JSON.stringify({ mode: "text", text: JSON.stringify({ title: "空", rows: [] }) }));
        expect(() => storyboardRowsFromTask(task)).toThrow("分镜任务没有返回镜头行");
    });
});
