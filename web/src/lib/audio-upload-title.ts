export function audioUploadTitleFromFileName(fileName: string): string {
    const extensionStart = fileName.lastIndexOf(".");
    return extensionStart > 0 && extensionStart < fileName.length - 1 ? fileName.slice(0, extensionStart) : fileName;
}
