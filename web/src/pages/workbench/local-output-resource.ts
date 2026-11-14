import { getActiveUserScope } from "@/lib/user-scope";
import { uploadResourceFile } from "@/services/api/resources";
import { getImageBlob } from "@/services/image-storage";

/** Import an account's locally generated image into its local resource library. */
export async function importLocalOutputResource(storageKey: string, dependencies = { scope: getActiveUserScope, read: getImageBlob, upload: uploadResourceFile }) {
    const scope = dependencies.scope();
    if (!scope || scope === "guest" || !storageKey.startsWith(`generation-image:${scope}:`)) throw new Error("无法读取当前账号以外的生成图片");
    const blob = await dependencies.read(storageKey);
    if (scope !== dependencies.scope()) throw new Error("账号已切换，请重新选择图片");
    if (!blob || !blob.size || !blob.type.startsWith("image/")) throw new Error("本地图片无法读取，请检查本机存储");
    const resource = await dependencies.upload(blob, "image", { fileName: "生成结果" });
    if (scope !== dependencies.scope()) throw new Error("账号已切换，请重新选择图片");
    return resource.id;
}
