/**
 * ja-JP 文案包（自动生成，勿手改）。
 * 首屏只静态加载 zh-CN；其余 5 种语言按需 import()，避免 6 种语言全进首屏。
 */
import type { LocalePack } from "./types";
import { jaJP as core } from "../ja-JP";
import { jaJP as create } from "../areas/create/ja-JP";
import { jaJP as library } from "../areas/library/ja-JP";
import { jaJP as account } from "../areas/account/ja-JP";
import { jaJP as canvasPage } from "../areas/canvasPage/ja-JP";
import { jaJP as canvasA } from "../areas/canvasA/ja-JP";
import { jaJP as canvasB } from "../areas/canvasB/ja-JP";
import { jaJP as canvasC } from "../areas/canvasC/ja-JP";
import { jaJP as drama } from "../areas/drama/ja-JP";
import { jaJP as ecommerce } from "../areas/ecommerce/ja-JP";

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
