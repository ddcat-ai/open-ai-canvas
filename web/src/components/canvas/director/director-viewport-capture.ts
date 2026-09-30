// 导演台画面截帧与预演录制（MediaRecorder），以及录制时长探测。

import { type DirectorRenderMode } from "@/types/director";
import { MeshBasicMaterial, MeshDepthMaterial, MeshNormalMaterial } from "three";
import { applyClaySceneMaterials } from "@/lib/canvas/director/director-clay-materials";
import type { CaptureContext } from "./director-viewport";

export async function captureFrame(context: CaptureContext | null, mode: DirectorRenderMode) {
    if (!context) throw new Error("3D 视口尚未就绪");
    const { gl, scene, camera } = context;
    const resumeDisplayMaterialOverride = context.suspendDisplayMaterialOverride();
    const previous = scene.overrideMaterial;
    const override = mode === "depth" ? new MeshDepthMaterial() : mode === "normal" ? new MeshNormalMaterial() : mode === "pose" ? new MeshBasicMaterial({ color: "#ffffff", wireframe: true }) : null;
    const restoreClayMaterials = mode === "clay" ? applyClaySceneMaterials(scene) : null;
    try {
        scene.overrideMaterial = override;
        gl.render(scene, camera);
        return await canvasToBlob(gl.domElement);
    } finally {
        scene.overrideMaterial = previous;
        restoreClayMaterials?.();
        override?.dispose();
        resumeDisplayMaterialOverride();
        gl.render(scene, camera);
    }
}

export async function recordCanvas(context: CaptureContext | null, duration: number, fps: number) {
    if (!context) throw new Error("3D 视口尚未就绪");
    if (!context.gl.domElement.captureStream || typeof MediaRecorder === "undefined") throw new Error("当前浏览器不支持视频录制，请导出帧序列");
    const resumeDisplayMaterialOverride = context.suspendDisplayMaterialOverride();
    const previousMaterial = context.scene.overrideMaterial;
    const restoreClayMaterials = applyClaySceneMaterials(context.scene);
    context.scene.overrideMaterial = null;
    context.gl.render(context.scene, context.camera);
    const stream = context.gl.domElement.captureStream(fps);
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    // captureStream 依赖渲染循环持续产出新帧；循环里任何未捕获异常都会让剩余录制变成空帧，
    // 与其 5 秒后静默产出残缺视频回写画布，不如捕获到首个错误就立刻中止并报错。
    let renderError: Error | null = null;
    const onRenderError = () => {
        renderError ??= new Error("白膜视频录制期间发生渲染错误，请重试");
        if (recorder.state !== "inactive") recorder.stop();
    };
    window.addEventListener("error", onRenderError);
    const result = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => {
            if (event.data.size) chunks.push(event.data);
        };
        recorder.onerror = () => reject(new Error("白膜视频录制失败"));
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
    });
    recorder.start(250);
    const stopTimer = window.setTimeout(
        () => {
            if (recorder.state !== "inactive") recorder.stop();
        },
        Math.max(250, duration * 1000 + 120),
    );
    try {
        const blob = await result;
        if (renderError) throw renderError;
        const recorded = await probeRecordedDuration(blob);
        if (!Number.isFinite(recorded) || recorded < Math.max(0.25, duration * 0.5)) throw new Error("白膜视频时长异常，录制可能不完整，请重试");
        return blob;
    } finally {
        window.clearTimeout(stopTimer);
        window.removeEventListener("error", onRenderError);
        stream.getTracks().forEach((track) => track.stop());
        restoreClayMaterials();
        context.scene.overrideMaterial = previousMaterial;
        resumeDisplayMaterialOverride();
        context.gl.render(context.scene, context.camera);
    }
}

export async function probeRecordedDuration(blob: Blob) {
    // Chrome MediaRecorder 产出的 webm 不带时长头，loaded metadata 时 duration 是 Infinity，
    // 只有 seek 到末尾触发收尾后 duration 才是真实值；这是校验录制完整性的唯一途径。
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    try {
        video.src = url;
        await new Promise<void>((resolve, reject) => {
            video.onloadedmetadata = () => resolve();
            video.onerror = () => reject(new Error("白膜视频无法解析"));
        });
        if (video.duration !== Infinity) return video.duration;
        await new Promise<void>((resolve) => {
            const finish = () => {
                video.removeEventListener("seeked", finish);
                resolve();
            };
            video.addEventListener("seeked", finish);
            video.currentTime = 1e6;
            window.setTimeout(finish, 1000);
        });
        return video.duration;
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function canvasToBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("3D 预览图导出失败"))), "image/png"));
}
