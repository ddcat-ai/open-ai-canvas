import { registerPlugin } from "../plugin-registry";
import type { RegisteredPlugin } from "../plugin-types";

export const EAGLE_PLUGIN_ID = "eagle-asset-connector";

export const eagleAssetPlugin: RegisteredPlugin = {
    manifest: {
        id: EAGLE_PLUGIN_ID,
        name: "Eagle 素材库",
        version: "0.1.0",
        apiVersion: "1",
        category: "asset-source",
        description: "把 Eagle 作为影策素材管理中的外部素材来源。",
        author: "影策社区",
        surfaces: ["asset-source", "hybrid"],
        permissions: ["asset.read", "asset.search", "asset.import", "asset.upload", "external.open"],
        trusted: true,
    },
};

registerPlugin(eagleAssetPlugin);

