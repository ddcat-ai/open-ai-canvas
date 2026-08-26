import { existsSync, openSync, closeSync, readSync } from "node:fs";
import path from "node:path";

const outputDir = path.resolve(import.meta.dir, "../../web/public");
const outputs = {
    windows: path.join(outputDir, "OpenAICanvas-ComfyBridge.exe"),
    linuxAmd64: path.join(outputDir, "OpenAICanvas-ComfyBridge-linux-amd64"),
    linuxArm64: path.join(outputDir, "OpenAICanvas-ComfyBridge-linux-arm64"),
} as const;

function isWindowsExecutable(file: string) {
    if (!existsSync(file)) return false;
    const descriptor = openSync(file, "r");
    try {
        const header = Buffer.alloc(2);
        return readSync(descriptor, header, 0, header.length, 0) === 2 && header[0] === 0x4d && header[1] === 0x5a;
    } finally {
        closeSync(descriptor);
    }
}

function isLinuxExecutable(file: string) {
    if (!existsSync(file)) return false;
    const descriptor = openSync(file, "r");
    try {
        const header = Buffer.alloc(4);
        return readSync(descriptor, header, 0, header.length, 0) === 4
            && header[0] === 0x7f
            && header[1] === 0x45
            && header[2] === 0x4c
            && header[3] === 0x46;
    } finally {
        closeSync(descriptor);
    }
}

function assertBuildOutput(target: keyof typeof outputs) {
    const valid = target === "windows"
        ? isWindowsExecutable(outputs[target])
        : isLinuxExecutable(outputs[target]);
    if (!valid) throw new Error(`Bridge 构建产物缺失或格式无效：${path.basename(outputs[target])}`);
}

function build(target: keyof typeof outputs, goos: string, goarch: string) {
    const command = Bun.spawnSync({
        cmd: ["go", "build", "-trimpath", "-ldflags=-s -w", "-o", outputs[target], "."],
        cwd: path.resolve(import.meta.dir, "../native/comfy-bridge"),
        env: {
            ...process.env,
            GOOS: goos,
            GOARCH: goarch,
            CGO_ENABLED: "0",
            GOTELEMETRY: "off",
        },
        stdout: "inherit",
        stderr: "inherit",
    });
    if (command.exitCode !== 0) process.exit(command.exitCode);
    assertBuildOutput(target);
}

if (process.env.CANVAS_PREBUILT_BRIDGE === "1") {
    assertBuildOutput("windows");
    assertBuildOutput("linuxAmd64");
    assertBuildOutput("linuxArm64");
    process.exit(0);
}

build("windows", "windows", "amd64");
build("linuxAmd64", "linux", "amd64");
build("linuxArm64", "linux", "arm64");
