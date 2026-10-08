/**
 * 创作类型。放在共享层是因为灵感目录（lib/inspirations）和创作页都要用它，
 * 而 lib 不该反向依赖 pages。creation-assets 仍然转出这个名字，原有 import 不用改。
 */
export type CreationMode = "text" | "image" | "video";
