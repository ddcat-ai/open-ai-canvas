// 按页面区域拆分的文案目录：每个区域在 messages/areas/<区域>/ 下维护六种语言，
// 合并到同名顶级命名空间（例如 t("create.home.title")），区域之间互不覆盖。
import { catalog as create } from "./messages/areas/create";
import { catalog as library } from "./messages/areas/library";
import { catalog as account } from "./messages/areas/account";
import { catalog as canvasPage } from "./messages/areas/canvasPage";
import { catalog as canvasA } from "./messages/areas/canvasA";
import { catalog as canvasB } from "./messages/areas/canvasB";
import { catalog as canvasC } from "./messages/areas/canvasC";
import { catalog as drama } from "./messages/areas/drama";
import { catalog as ecommerce } from "./messages/areas/ecommerce";

export const AREA_CATALOGS = {
    create,
    library,
    account,
    canvasPage,
    canvasA,
    canvasB,
    canvasC,
    drama,
    ecommerce,
};
