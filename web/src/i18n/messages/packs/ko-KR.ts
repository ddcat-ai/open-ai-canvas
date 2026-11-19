/**
 * ko-KR 文案包（自动生成，勿手改）。
 * 首屏只静态加载 zh-CN；其余 5 种语言按需 import()，避免 6 种语言全进首屏。
 */
import type { LocalePack } from "./types";
import { koKR as core } from "../ko-KR";
import { koKR as create } from "../areas/create/ko-KR";
import { koKR as library } from "../areas/library/ko-KR";
import { koKR as account } from "../areas/account/ko-KR";
import { koKR as canvasPage } from "../areas/canvasPage/ko-KR";
import { koKR as canvasA } from "../areas/canvasA/ko-KR";
import { koKR as canvasB } from "../areas/canvasB/ko-KR";
import { koKR as canvasC } from "../areas/canvasC/ko-KR";
import { koKR as drama } from "../areas/drama/ko-KR";
import { koKR as ecommerce } from "../areas/ecommerce/ko-KR";

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
