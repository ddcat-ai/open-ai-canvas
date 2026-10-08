import { unzipSync as unpack, zipSync as pack } from "fflate";

type ZipSource = BlobPart;

async function toBytes(data: ZipSource): Promise<Uint8Array> {
    const buffer = await new Blob([data]).arrayBuffer();
    return new Uint8Array(buffer);
}

export async function createZip(files: Array<{ name: string; data: ZipSource }>): Promise<Blob> {
    const entries: Record<string, Uint8Array> = {};
    for (const file of files) {
        entries[file.name] = await toBytes(file.data);
    }
    const archive = pack(entries, { level: 0 });
    return new Blob([archive], { type: "application/zip" });
}

export async function readZip(file: Blob): Promise<Map<string, Blob>> {
    const opened = unpack(await toBytes(file));
    const extracted = new Map<string, Blob>();
    for (const [name, bytes] of Object.entries(opened)) {
        extracted.set(name, new Blob([bytes]));
    }
    return extracted;
}
