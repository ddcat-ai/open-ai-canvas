/**
 * de-DE 文案包（自动生成，勿手改）。
 * 首屏只静态加载 zh-CN；其余 5 种语言按需 import()，避免 6 种语言全进首屏。
 */
import type { LocalePack } from "./types";
import { deDE as core } from "../de-DE";
import { deDE as create } from "../areas/create/de-DE";
import { deDE as library } from "../areas/library/de-DE";
import { deDE as account } from "../areas/account/de-DE";
import { deDE as canvasPage } from "../areas/canvasPage/de-DE";
import { deDE as canvasA } from "../areas/canvasA/de-DE";
import { deDE as canvasB } from "../areas/canvasB/de-DE";
import { deDE as canvasC } from "../areas/canvasC/de-DE";
import { deDE as drama } from "../areas/drama/de-DE";
import { deDE as ecommerce } from "../areas/ecommerce/de-DE";

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
