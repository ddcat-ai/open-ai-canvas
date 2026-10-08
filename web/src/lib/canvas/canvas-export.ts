import { saveAs } from "file-saver";
import { MediaPackage, downloadName, packageSegment, referencedStorageKeys } from "@/lib/media-package";
import { loadCanvasDrawing, loadCanvasDrawingPreview, loadCanvasDrawingRender } from "@/lib/canvas/canvas-drawing-storage";
import type { CanvasDrawingExport, CanvasExportFile, CanvasProjectExportItem } from "@/types/canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

async function addDrawing(archive: MediaPackage, project: CanvasProject, drawingId: string, directory: string): Promise<CanvasDrawingExport | null> {
    const document = await loadCanvasDrawing(project.id, drawingId);
    if (!document) return null;
    const stem = `${directory}/drawings/${packageSegment(drawingId)}`;
    const [preview, generation] = await Promise.all([loadCanvasDrawingPreview(project.id, drawingId), loadCanvasDrawingRender(project.id, drawingId)]);
    const saved: CanvasDrawingExport = { ...document, drawingId };
    if (preview) { saved.previewPath = `${stem}.png`; archive.put(saved.previewPath, preview); }
    if (generation) {
        const { pageId, width, height, mimeType, background } = generation;
        saved.generationRender = { path: `${stem}.generation.png`, pageId, width, height, mimeType, background };
        archive.put(saved.generationRender.path, generation.blob);
    }
    archive.put(`${stem}.json`, JSON.stringify(saved));
    return saved;
}

export async function exportCanvasProjects(projects: CanvasProject[], fileName = "画布", options: { includeLocalDrawings?: boolean } = {}): Promise<void> {
    const archive = new MediaPackage();
    const items: CanvasProjectExportItem[] = [];
    // Snapshot once so edits during asynchronous blob reads cannot change the manifest midway.
    const snapshot = structuredClone(projects);
    const projectIds = new Set<string>();
    for (const project of snapshot) {
        if (projectIds.has(project.id)) throw new Error("不能重复导出同一个画布项目");
        projectIds.add(project.id);
        const directory = `projects/${packageSegment(project.id)}`;
        const files = await archive.collect(referencedStorageKeys(project), `${directory}/files`);
        const drawingDocuments: CanvasDrawingExport[] = [];
        if (options.includeLocalDrawings !== false) {
            const ids = new Set(project.nodes.flatMap((node) => node.type === "drawing" && node.metadata?.drawingId ? [node.metadata.drawingId] : []));
            for (const drawingId of ids) {
                const document = await addDrawing(archive, project, drawingId, directory);
                if (document) drawingDocuments.push(document);
            }
        }
        items.push({ project, files, drawingDocuments });
    }
    const manifest: CanvasExportFile = { app: "yingce", version: 4, exportedAt: new Date().toISOString(), projects: items };
    saveAs(await archive.finish("projects.json", manifest), `${downloadName(fileName)}.zip`);
}
