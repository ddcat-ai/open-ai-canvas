/** 单语言文案包：i18n/index.ts 只静态加载中文，其余语言按需 import()。 */
export type LocalePack = {
    core: object;
    areas: Record<string, object>;
};
