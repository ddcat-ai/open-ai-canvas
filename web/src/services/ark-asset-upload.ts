// 方舟素材组图片上传：先在本地校验格式、大小和尺寸，再上传为资源并提交到素材组。
// 用户端与管理员端共用，提交接口由调用方传入（用户自建组走审核，平台组由管理员直传）。

import { translate } from "@/i18n";
import { readImageMeta } from "@/lib/image-utils";
import { uploadResourceFile } from "@/services/api/resources";
import type { ArkPortraitAsset } from "@/services/api/ark-portraits";

export const ARK_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/bmp,image/gif,image/tiff,image/heic,image/heif";
const ARK_IMAGE_MAX_BYTES = 30 * 1024 * 1024;
const ARK_IMAGE_MIN_SIDE = 300;
const ARK_IMAGE_MAX_SIDE = 6000;

/** 尺寸不满足方舟要求时返回提示文案，满足时返回空串。 */
export function arkImageSizeProblem(name: string, width: number, height: number) {
    if (!(width > 0 && height > 0)) return translate("library.ark.upload.unreadable", { name });
    const shortSide = Math.min(width, height);
    const longSide = Math.max(width, height);
    if (shortSide < ARK_IMAGE_MIN_SIDE || longSide > ARK_IMAGE_MAX_SIDE) return translate("library.ark.upload.badSize", { name, width, height });
    return "";
}

async function readArkImageSize(file: File) {
    const url = URL.createObjectURL(file);
    try {
        const meta = await readImageMeta(url);
        return { width: meta.width, height: meta.height };
    } catch {
        return { width: 0, height: 0 };
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** 校验一批文件；任一文件不符合要求时整体拒绝，避免部分提交。 */
export async function validateArkImageFiles(files: File[]) {
    const checked: Array<{ file: File; width: number; height: number }> = [];
    for (const file of files) {
        if (!file.type.startsWith("image/")) throw new Error(translate("library.ark.upload.notImage", { name: file.name }));
        if (file.size > ARK_IMAGE_MAX_BYTES) throw new Error(translate("library.ark.upload.tooLarge", { name: file.name }));
        const size = await readArkImageSize(file);
        const problem = arkImageSizeProblem(file.name, size.width, size.height);
        if (problem) throw new Error(problem);
        checked.push({ file, ...size });
    }
    return checked;
}

/** 校验后逐张上传并提交；返回已提交的素材。上传中途失败时已提交的保留，错误继续抛出。 */
export async function uploadArkGroupImages(files: File[], submit: (input: { resourceId: string; name: string }) => Promise<{ asset: ArkPortraitAsset }>) {
    const checked = await validateArkImageFiles(files);
    const submitted: ArkPortraitAsset[] = [];
    for (const item of checked) {
        const resource = await uploadResourceFile(item.file, "image", { fileName: item.file.name, width: item.width, height: item.height });
        const { asset } = await submit({ resourceId: resource.id, name: item.file.name });
        submitted.push(asset);
    }
    return submitted;
}
