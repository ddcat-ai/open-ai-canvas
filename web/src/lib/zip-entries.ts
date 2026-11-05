import { inflateSync } from "fflate";

/**
 * 按中央目录随机读取 ZIP 条目，只读取需要的字节，适合打开含视频的大资产包。
 * 支持 ZIP64、存储（method 0）与 Deflate（method 8）；文件名优先按 UTF-8 解码，未标记 UTF-8 且解码失败时按 GBK（Windows 中文系统压缩）。
 */
export type ZipEntry = {
    name: string;
    method: number;
    compressedSize: number;
    size: number;
    localHeaderOffset: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 65_535 + 22;
const MAX_INFLATE_BYTES = 64 << 20;

async function bytesAt(file: Blob, start: number, end: number) {
    return new DataView(await file.slice(start, end).arrayBuffer());
}

function uint64(view: DataView, offset: number) {
    const value = view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 2 ** 32;
    if (!Number.isSafeInteger(value)) throw new Error("压缩包过大，无法读取");
    return value;
}

function decodeName(bytes: Uint8Array, utf8Flag: boolean) {
    if (utf8Flag) return new TextDecoder("utf-8").decode(bytes);
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return new TextDecoder("gbk").decode(bytes);
    }
}

export async function listZipEntries(file: Blob): Promise<ZipEntry[]> {
    if (file.size < 22) throw new Error("不是有效的 ZIP 压缩包");
    const tailStart = Math.max(0, file.size - MAX_EOCD_SEARCH);
    const tail = await bytesAt(file, tailStart, file.size);
    let eocd = -1;
    for (let offset = tail.byteLength - 22; offset >= 0; offset--) {
        if (tail.getUint32(offset, true) === EOCD_SIGNATURE) {
            eocd = offset;
            break;
        }
    }
    if (eocd < 0) throw new Error("不是有效的 ZIP 压缩包");
    let count = tail.getUint16(eocd + 10, true);
    let directorySize = tail.getUint32(eocd + 12, true);
    let directoryOffset = tail.getUint32(eocd + 16, true);
    if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
        const locator = eocd - 20;
        if (locator < 0 || tail.getUint32(locator, true) !== ZIP64_LOCATOR_SIGNATURE) throw new Error("ZIP64 目录缺失，压缩包可能已损坏");
        const recordOffset = uint64(tail, locator + 8);
        const record = await bytesAt(file, recordOffset, recordOffset + 56);
        if (record.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) throw new Error("ZIP64 目录无效，压缩包可能已损坏");
        count = uint64(record, 32);
        directorySize = uint64(record, 40);
        directoryOffset = uint64(record, 48);
    }
    if (directoryOffset + directorySize > file.size) throw new Error("压缩包目录超出文件范围，可能未下载完整");
    const directory = await bytesAt(file, directoryOffset, directoryOffset + directorySize);
    const raw = new Uint8Array(directory.buffer, directory.byteOffset, directory.byteLength);
    const entries: ZipEntry[] = [];
    let cursor = 0;
    for (let index = 0; index < count; index++) {
        if (cursor + 46 > directory.byteLength || directory.getUint32(cursor, true) !== CENTRAL_SIGNATURE) throw new Error("压缩包目录损坏");
        const flags = directory.getUint16(cursor + 8, true);
        const method = directory.getUint16(cursor + 10, true);
        let compressedSize = directory.getUint32(cursor + 20, true);
        let size = directory.getUint32(cursor + 24, true);
        const nameLength = directory.getUint16(cursor + 28, true);
        const extraLength = directory.getUint16(cursor + 30, true);
        const commentLength = directory.getUint16(cursor + 32, true);
        let localHeaderOffset = directory.getUint32(cursor + 42, true);
        const name = decodeName(raw.subarray(cursor + 46, cursor + 46 + nameLength), (flags & 0x800) !== 0);
        let extra = cursor + 46 + nameLength;
        const extraEnd = extra + extraLength;
        while (extra + 4 <= extraEnd) {
            const id = directory.getUint16(extra, true);
            const length = directory.getUint16(extra + 2, true);
            if (id === 0x0001) {
                let field = extra + 4;
                if (size === 0xffffffff) {
                    size = uint64(directory, field);
                    field += 8;
                }
                if (compressedSize === 0xffffffff) {
                    compressedSize = uint64(directory, field);
                    field += 8;
                }
                if (localHeaderOffset === 0xffffffff) localHeaderOffset = uint64(directory, field);
            }
            extra += 4 + length;
        }
        if (!name.endsWith("/")) entries.push({ name, method, compressedSize, size, localHeaderOffset });
        cursor = extraEnd + commentLength;
    }
    return entries;
}

/** 读取一个条目；存储条目直接切片，不复制字节。 */
export async function readZipEntry(file: Blob, entry: ZipEntry, type = ""): Promise<Blob> {
    const header = await bytesAt(file, entry.localHeaderOffset, entry.localHeaderOffset + 30);
    if (header.getUint32(0, true) !== LOCAL_SIGNATURE) throw new Error(`压缩包条目损坏：${entry.name}`);
    const start = entry.localHeaderOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    const data = file.slice(start, start + entry.compressedSize, type);
    if (entry.method === 0) return data;
    if (entry.method !== 8) throw new Error(`不支持的压缩方式：${entry.name}`);
    if (entry.size > MAX_INFLATE_BYTES) throw new Error(`文件过大，无法在浏览器中解压：${entry.name}`);
    const inflated = inflateSync(new Uint8Array(await data.arrayBuffer()), { out: new Uint8Array(entry.size) });
    return new Blob([inflated], { type });
}
