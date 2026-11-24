import { registerPlugin } from "../plugin-registry";
import { PLUGIN_API_VERSION, type PluginManifest, type RegisteredPlugin } from "../plugin-types";

export const OFFICIAL_ASSET_LIBRARY_PLUGIN_ID = "official-asset-library";

const manifest: PluginManifest = {
    apiVersion: PLUGIN_API_VERSION,
    id: OFFICIAL_ASSET_LIBRARY_PLUGIN_ID,
    name: "官方素材库",
    version: "1.0.0",
    description: "由平台管理员维护的官方图片、视频素材库，所有用户可浏览并导入个人素材库或当前项目。",
    author: "出彩团队",
    permissions: ["asset.read", "asset.search", "asset.import"],
    trusted: true,
    contributes: { assetSources: ["official"] },
};

export const officialAssetLibraryPlugin: RegisteredPlugin = { manifest, source: "bundled" };

registerPlugin(officialAssetLibraryPlugin);
