export const CHARACTER_VOICE_FORMAT_LABEL = "MP3、WAV、M4A/AAC、FLAC、OGG/Opus、WebM";

export const CHARACTER_VOICE_UPLOAD_ACCEPT = [
    "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave",
    "audio/mp4", "audio/x-m4a", "audio/aac", "audio/flac", "audio/x-flac",
    "audio/ogg", "audio/opus", "audio/webm",
    ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".webm", ".weba",
].join(",");

const supportedMimeTypes = new Set([
    "audio/mpeg", "audio/mp3", "audio/x-mpeg",
    "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "audio/x-pn-wav",
    "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/aacp",
    "audio/flac", "audio/x-flac",
    "audio/ogg", "application/ogg", "audio/opus", "audio/webm",
]);

const supportedExtensions = new Set(["mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "opus", "webm", "weba"]);

export function isSupportedCharacterVoiceFile(file: Pick<File, "name" | "type">) {
    const mimeType = file.type.trim().toLowerCase().split(";", 1)[0];
    if (supportedMimeTypes.has(mimeType)) return true;
    if (mimeType && mimeType !== "application/octet-stream") return false;
    return supportedExtensions.has(fileExtension(file.name));
}

export function characterVoiceTitleFromFileName(fileName: string) {
    return fileName.replace(/\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|webm|weba)$/i, "") || "上传声音";
}

export function characterVoiceFormatName(mimeType?: string, fileName = "") {
    const extension = audioFileExtension(mimeType, fileName);
    return extension === "m4a" ? "M4A" : extension === "oga" ? "OGG" : extension === "weba" ? "WebM" : extension.toUpperCase();
}

export function audioFileExtension(mimeType?: string, fileName = "") {
    const extension = fileExtension(fileName);
    if (supportedExtensions.has(extension)) return extension;
    const mime = (mimeType || "").trim().toLowerCase().split(";", 1)[0];
    if (mime.includes("mpeg") || mime === "audio/mp3") return "mp3";
    if (mime.includes("wav") || mime === "audio/vnd.wave") return "wav";
    if (mime.includes("m4a") || mime === "audio/mp4") return "m4a";
    if (mime.includes("aac")) return "aac";
    if (mime.includes("flac")) return "flac";
    if (mime.includes("opus")) return "opus";
    if (mime.includes("ogg")) return "ogg";
    if (mime.includes("webm")) return "webm";
    return "audio";
}

function fileExtension(fileName: string) {
    const match = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
    return match?.[1] || "";
}
