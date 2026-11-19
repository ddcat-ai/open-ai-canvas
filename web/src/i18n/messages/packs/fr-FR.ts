/**
 * fr-FR 文案包（自动生成，勿手改）。
 * 首屏只静态加载 zh-CN；其余 5 种语言按需 import()，避免 6 种语言全进首屏。
 */
import type { LocalePack } from "./types";
import { frFR as core } from "../fr-FR";
import { frFR as create } from "../areas/create/fr-FR";
import { frFR as library } from "../areas/library/fr-FR";
import { frFR as account } from "../areas/account/fr-FR";
import { frFR as canvasPage } from "../areas/canvasPage/fr-FR";
import { frFR as canvasA } from "../areas/canvasA/fr-FR";
import { frFR as canvasB } from "../areas/canvasB/fr-FR";
import { frFR as canvasC } from "../areas/canvasC/fr-FR";
import { frFR as drama } from "../areas/drama/fr-FR";
import { frFR as ecommerce } from "../areas/ecommerce/fr-FR";

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
