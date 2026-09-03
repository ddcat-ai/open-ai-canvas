#!/usr/bin/env tsx
/**
 * Storyboard Benchmark v1 — CLI 入口
 *
 * 用法：
 *   tsx test/benchmark/cli.ts evaluate <recording.json>
 *   tsx test/benchmark/cli.ts evaluate-raw <raw-recording.json> [annotation.json]
 *   tsx test/benchmark/cli.ts compare <baseline.json> <director.json>
 *   tsx test/benchmark/cli.ts prepare-annotation <raw-recording.json>
 *   tsx test/benchmark/cli.ts run-fixture <fixtureId> <baseline|director>
 *   tsx test/benchmark/cli.ts list-fixtures
 */

import * as fs from "fs";
import * as path from "path";
import { evaluateRecording, compareRecordings, evaluateRawRecording, createBlindedAnnotationPacket } from "./evaluator";
import { BENCHMARK_FIXTURES, getFixtureById } from "./fixtures";
import type { BenchmarkAnnotationFile, BenchmarkRecording, EvaluationResult, RawBenchmarkRecording } from "./types";

function loadRecording(filePath: string): BenchmarkRecording {
    const absPath = path.resolve(filePath);
    const content = fs.readFileSync(absPath, "utf-8");
    return JSON.parse(content) as BenchmarkRecording;
}

function printEvaluation(result: EvaluationResult): void {
    console.log("\n" + "=".repeat(60));
    console.log(result.summary);
    console.log("=".repeat(60));
    console.log(`\n总分: ${result.totalScore} / ${result.maxTotalScore}\n`);

    console.log("各指标得分：");
    console.log("-".repeat(40));
    for (const metric of result.metricScores) {
        const bar = "█".repeat(Math.round((metric.score / metric.maxScore) * 20));
        console.log(`  ${metric.name.padEnd(20)} ${String(metric.score).padStart(3)}/${metric.maxScore} ${bar}`);
        for (const v of metric.violations) {
            console.log(`    ⚠  ${v}`);
        }
    }

    if (result.violations.length > 0) {
        console.log(`\n共 ${result.violations.length} 项违规`);
    } else {
        console.log("\n无违规");
    }
    console.log("");
}

function printComparison(baselinePath: string, directorPath: string): void {
    const baseline = evaluateRecording(loadRecording(baselinePath));
    const director = evaluateRecording(loadRecording(directorPath));
    const comparison = compareRecordings(baseline, director);

    console.log("\n" + "=".repeat(70));
    console.log(`Benchmark 比较: ${comparison.fixtureId}`);
    console.log("=".repeat(70));
    console.log(`\n${"指标".padEnd(22)} ${"Baseline".padStart(10)} ${"Director".padStart(10)} ${"Delta".padStart(8)}`);
    console.log("-".repeat(55));
    for (const row of comparison.rows) {
        const deltaStr = row.delta >= 0 ? `+${row.delta}` : `${row.delta}`;
        console.log(`${row.metric.padEnd(22)} ${String(row.baseline).padStart(10)} ${String(row.director).padStart(10)} ${deltaStr.padStart(8)}`);
    }
    console.log("-".repeat(55));
    const totalDelta = comparison.deltaTotal >= 0 ? `+${comparison.deltaTotal}` : `${comparison.deltaTotal}`;
    console.log(`${"TOTAL".padEnd(22)} ${String(comparison.baselineTotal).padStart(10)} ${String(comparison.directorTotal).padStart(10)} ${totalDelta.padStart(8)}`);
    console.log("");
}

function main(): void {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command || command === "help" || command === "--help") {
        console.log(`
Storyboard Benchmark v1 CLI

用法:
  evaluate <recording.json>              评估单个recording（含annotations）
  evaluate-raw <raw.json> [annotation.json]  评估原始录制（可选附带标注）
  compare <baseline.json> <director.json>    比较baseline和director
  prepare-annotation <raw.json>           生成盲标注包（隐藏mode/score）
  run-fixture <fixtureId> <baseline|director>  打印fixture运行步骤和prompt
  list-fixtures                           列出所有fixtures
  help                                    显示此帮助
`);
        return;
    }

    if (command === "list-fixtures") {
        console.log("\nBenchmark Fixtures:");
        console.log("-".repeat(50));
        for (const f of BENCHMARK_FIXTURES) {
            console.log(`  ${f.id.padEnd(30)} ${f.requestedShotCount} shots  [${f.category}]`);
            console.log(`    ${f.name}`);
        }
        console.log("");
        return;
    }

    if (command === "evaluate") {
        const recordingPath = args[1];
        if (!recordingPath) {
            console.error("错误: 请指定recording文件路径");
            process.exit(1);
        }
        const result = evaluateRecording(loadRecording(recordingPath));
        printEvaluation(result);
        return;
    }

    if (command === "evaluate-raw") {
        const rawPath = args[1];
        const annotationPath = args[2];
        if (!rawPath) {
            console.error("错误: 请指定raw recording文件路径");
            process.exit(1);
        }
        const raw = JSON.parse(fs.readFileSync(path.resolve(rawPath), "utf-8")) as RawBenchmarkRecording;
        let annotation: BenchmarkAnnotationFile | undefined;
        if (annotationPath) {
            annotation = JSON.parse(fs.readFileSync(path.resolve(annotationPath), "utf-8")) as BenchmarkAnnotationFile;
        }
        const result = evaluateRawRecording(raw, annotation);
        printEvaluation(result);
        return;
    }

    if (command === "prepare-annotation") {
        const rawPath = args[1];
        if (!rawPath) {
            console.error("错误: 请指定raw recording文件路径");
            process.exit(1);
        }
        const raw = JSON.parse(fs.readFileSync(path.resolve(rawPath), "utf-8")) as RawBenchmarkRecording;
        const packet = createBlindedAnnotationPacket(raw);
        console.log(JSON.stringify(packet, null, 2));
        console.log("\n# 盲标注包已生成。runId:", packet.runId);
        console.log("# 已隐藏: mode, score, effectiveSkillIds, metadata");
        console.log("# 请按position标注beatTags和continuityTags，然后保存为annotation JSON");
        return;
    }

    if (command === "run-fixture") {
        const fixtureId = args[1];
        const mode = args[2] as "baseline" | "director";
        if (!fixtureId || !mode) {
            console.error("错误: 请指定 fixtureId 和 mode (baseline|director)");
            console.error("用法: run-fixture <fixtureId> <baseline|director>");
            process.exit(1);
        }
        const fixture = getFixtureById(fixtureId);
        if (!fixture) {
            console.error(`错误: 未找到fixture: ${fixtureId}`);
            process.exit(1);
        }

        const benchmarkMode = mode === "baseline" ? "baseline" : "normal";
        const recordingMode = mode === "baseline" ? "baseline" : "storyboard-director";

        console.log("\n" + "=".repeat(60));
        console.log(`Fixture: ${fixture.name}`);
        console.log(`Mode: ${mode} (benchmarkSkillMode=${benchmarkMode}, recordingMode=${recordingMode})`);
        console.log("=".repeat(60));
        console.log("\n【设置步骤】");
        console.log(`1. 打开浏览器DevTools Console，执行：`);
        console.log(`   localStorage.setItem("__benchmark_skill_mode", "${benchmarkMode}")`);
        console.log(`   localStorage.setItem("__benchmark_capture_enabled", "1")`);
        console.log(`   localStorage.setItem("__benchmark_fixture_id", "${fixture.id}")`);
        console.log(`   localStorage.setItem("__benchmark_mode", "${recordingMode}")`);
        console.log(`2. 刷新页面，确认本地Agent已连接`);
        console.log(`3. 确保项目处于干净状态（无之前的分镜数据）`);
        console.log(`\n【提交Prompt】（直接复制以下内容）：`);
        console.log("-".repeat(40));
        console.log(fixture.script);
        console.log(`\n拆成${fixture.requestedShotCount}个专业分镜，只做分镜，不生成图片或视频。`);
        if (fixture.totalDurationMs) {
            console.log(`总时长约${fixture.totalDurationMs / 1000}秒。`);
        }
        console.log("-".repeat(40));
        console.log(`\n【完成后】`);
        console.log(`- turn完成后会自动下载 raw recording JSON`);
        console.log(`- 用 prepare-annotation 生成盲标注包`);
        console.log(`- 标注后用 evaluate-raw 评估`);
        console.log(`- 清理localStorage: localStorage.removeItem("__benchmark_capture_enabled")`);
        console.log("");
        return;
    }

    if (command === "compare") {
        const baselinePath = args[1];
        const directorPath = args[2];
        if (!baselinePath || !directorPath) {
            console.error("错误: 请指定baseline和director文件路径");
            process.exit(1);
        }
        printComparison(baselinePath, directorPath);
        return;
    }

    console.error(`未知命令: ${command}`);
    process.exit(1);
}

main();
