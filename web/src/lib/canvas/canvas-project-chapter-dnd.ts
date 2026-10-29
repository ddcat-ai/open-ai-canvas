import type { ProjectUnit } from "@/services/api/projects";

/** 旧项目空间画布的章节拖放载荷：仍由上传入口解析，已存在的章节节点继续可用。 */
export const CANVAS_PROJECT_CHAPTER_DND_TYPE = "application/x-yingce-project-chapter";
export type CanvasProjectChapterPayload = Pick<ProjectUnit, "id" | "title" | "position"> & { projectId: string; sourceText?: string };
