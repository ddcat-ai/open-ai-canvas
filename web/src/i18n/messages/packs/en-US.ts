/**
 * en-US 文案包（自动生成，勿手改）。
 * 首屏只静态加载 zh-CN；其余 5 种语言按需 import()，避免 6 种语言全进首屏。
 */
import type { LocalePack } from "./types";
import { enUS as core } from "../en-US";
import { enUS as create } from "../areas/create/en-US";
import { enUS as library } from "../areas/library/en-US";
import { enUS as account } from "../areas/account/en-US";
import { enUS as canvasPage } from "../areas/canvasPage/en-US";
import { enUS as canvasA } from "../areas/canvasA/en-US";
import { enUS as canvasB } from "../areas/canvasB/en-US";
import { enUS as canvasC } from "../areas/canvasC/en-US";
import { enUS as drama } from "../areas/drama/en-US";
import { enUS as ecommerce } from "../areas/ecommerce/en-US";

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
