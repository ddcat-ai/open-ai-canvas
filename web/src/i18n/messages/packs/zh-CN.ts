/**
 * zh-CN 文案包（自动生成，勿手改）。
 * 首屏只静态加载 zh-CN；其余 5 种语言按需 import()，避免 6 种语言全进首屏。
 */
import type { LocalePack } from "./types";
import { zhCN as core } from "../zh-CN";
import { zhCN as create } from "../areas/create/zh-CN";
import { zhCN as library } from "../areas/library/zh-CN";
import { zhCN as account } from "../areas/account/zh-CN";
import { zhCN as canvasPage } from "../areas/canvasPage/zh-CN";
import { zhCN as canvasA } from "../areas/canvasA/zh-CN";
import { zhCN as canvasB } from "../areas/canvasB/zh-CN";
import { zhCN as canvasC } from "../areas/canvasC/zh-CN";
import { zhCN as drama } from "../areas/drama/zh-CN";
import { zhCN as ecommerce } from "../areas/ecommerce/zh-CN";

export const pack: LocalePack = {
    core,
    areas: {
        create,
        library,
        account,
        canvasPage,
        canvasA,
        canvasB,
        canvasC,
        drama,
        ecommerce,
    },
};
