export type CanvasShortcutCategoryId = "common" | "navigation" | "selection" | "editing";

export type CanvasShortcutCategory = {
    id: CanvasShortcutCategoryId;
    label: string;
    description: string;
};

export type CanvasShortcutItem = {
    id: string;
    category: CanvasShortcutCategoryId;
    title: string;
    description: string;
    keys: string[][];
    keywords?: string[];
};

export const CANVAS_MODIFIER_KEY = "Ctrl / Cmd";

export const CANVAS_SHORTCUT_CATEGORIES: CanvasShortcutCategory[] = [
    { id: "common", label: "常用", description: "搜索、保存与界面" },
    { id: "navigation", label: "视图与导航", description: "平移、缩放与定位" },
    { id: "selection", label: "选择与连接", description: "批量选择和节点连接" },
    { id: "editing", label: "编辑与文件", description: "编辑、撤销与导入" },
];

export const CANVAS_SHORTCUTS: CanvasShortcutItem[] = [
    {
        id: "search",
        category: "common",
        title: "搜索画布节点",
        description: "按名称或内容搜索并定位节点",
        keys: [[CANVAS_MODIFIER_KEY, "F"]],
        keywords: ["查找", "定位", "find", "search"],
    },
    {
        id: "shortcuts",
        category: "common",
        title: "打开快捷键中心",
        description: "查看画布中的键盘和鼠标操作",
        keys: [["?"]],
        keywords: ["帮助", "说明", "help"],
    },
    {
        id: "save",
        category: "common",
        title: "保存画布",
        description: "保存当前画布布局和节点位置",
        keys: [[CANVAS_MODIFIER_KEY, "S"]],
        keywords: ["存储", "save"],
    },
    {
        id: "focus",
        category: "common",
        title: "进入或退出专注模式",
        description: "隐藏界面干扰，聚焦当前画布",
        keys: [["Shift", CANVAS_MODIFIER_KEY, "F"]],
        keywords: ["沉浸", "全屏", "focus"],
    },
    {
        id: "pan",
        category: "navigation",
        title: "平移视图",
        description: "在画布空白处拖动，或使用空格键与中键拖动",
        keys: [["空白处拖动"], ["Space", "拖动"], ["中键拖动"]],
        keywords: ["移动", "画布", "pan"],
    },
    {
        id: "zoom-wheel",
        category: "navigation",
        title: "缩放画布",
        description: "以鼠标所在位置为中心缩放",
        keys: [["滚轮"]],
        keywords: ["放大", "缩小", "zoom"],
    },
    {
        id: "zoom-controls",
        category: "navigation",
        title: "精确调整缩放",
        description: "使用画布缩放滑杆调整比例",
        keys: [["缩放滑杆"]],
        keywords: ["比例", "zoom"],
    },
    {
        id: "zoom-steps",
        category: "navigation",
        title: "步进缩放画布",
        description: "按固定步长放大或缩小画布",
        keys: [[CANVAS_MODIFIER_KEY, "+"], [CANVAS_MODIFIER_KEY, "-"]],
        keywords: ["放大", "缩小", "zoom"],
    },
    {
        id: "zoom-presets",
        category: "navigation",
        title: "快速调整视图",
        description: "0/1 恢复 100%，2 适应画布，3 适应选择",
        keys: [[CANVAS_MODIFIER_KEY, "0"], [CANVAS_MODIFIER_KEY, "1"], [CANVAS_MODIFIER_KEY, "2"], [CANVAS_MODIFIER_KEY, "3"]],
        keywords: ["100%", "适应", "居中", "缩放", "fit"],
    },
    {
        id: "box-select",
        category: "selection",
        title: "框选多个节点",
        description: "按住修饰键后拖动选区",
        keys: [["Shift", "拖动"], [CANVAS_MODIFIER_KEY, "拖动"]],
        keywords: ["多选", "范围", "selection"],
    },
    {
        id: "box-select-tool",
        category: "selection",
        title: "使用框选工具",
        description: "完成框选后自动回到移动与选择工具",
        keys: [["框选工具", "拖动"]],
        keywords: ["工具栏", "多选", "selection"],
    },
    {
        id: "add-selection",
        category: "selection",
        title: "追加选择节点",
        description: "保留已有选择并加入更多节点",
        keys: [["Shift", "点击"], [CANVAS_MODIFIER_KEY, "点击"]],
        keywords: ["多选", "添加", "selection"],
    },
    {
        id: "remove-selection",
        category: "selection",
        title: "移除选择节点",
        description: "从当前选择中移除点击或框选的节点",
        keys: [["Alt", "点击 / 框选"]],
        keywords: ["取消", "排除", "selection"],
    },
    {
        id: "select-all",
        category: "selection",
        title: "全选节点",
        description: "选择画布中的全部节点",
        keys: [[CANVAS_MODIFIER_KEY, "A"]],
        keywords: ["全部", "select all"],
    },
    {
        id: "batch-connect",
        category: "selection",
        title: "批量连接节点",
        description: "为两个或更多已选节点进入批量连接模式",
        keys: [["Alt", "L"]],
        keywords: ["连线", "连接", "link"],
    },
    {
        id: "copy",
        category: "editing",
        title: "复制节点",
        description: "复制当前选中的节点",
        keys: [[CANVAS_MODIFIER_KEY, "C"]],
        keywords: ["copy"],
    },
    {
        id: "paste",
        category: "editing",
        title: "粘贴节点或剪贴板内容",
        description: "粘贴已复制节点、文本或图片",
        keys: [[CANVAS_MODIFIER_KEY, "V"]],
        keywords: ["剪贴板", "paste"],
    },
    {
        id: "delete",
        category: "editing",
        title: "删除选中内容",
        description: "删除选中的节点或连线",
        keys: [["Delete"], ["Backspace"]],
        keywords: ["移除", "delete"],
    },
    {
        id: "undo",
        category: "editing",
        title: "撤销",
        description: "撤销上一步画布编辑",
        keys: [[CANVAS_MODIFIER_KEY, "Z"]],
        keywords: ["undo"],
    },
    {
        id: "redo",
        category: "editing",
        title: "重做",
        description: "恢复刚刚撤销的画布编辑",
        keys: [[CANVAS_MODIFIER_KEY, "Shift", "Z"], [CANVAS_MODIFIER_KEY, "Y"]],
        keywords: ["恢复", "redo"],
    },
    {
        id: "escape",
        category: "editing",
        title: "取消当前操作",
        description: "取消选择、关闭浮层或退出专注模式",
        keys: [["Esc"]],
        keywords: ["关闭", "退出", "cancel"],
    },
    {
        id: "import-media",
        category: "editing",
        title: "导入媒体",
        description: "将图片、视频或音频文件拖入画布",
        keys: [["拖入媒体"]],
        keywords: ["上传", "文件", "图片", "视频", "音频", "upload"],
    },
];

export function filterCanvasShortcuts(query: string, category?: CanvasShortcutCategoryId | "all") {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);

    return CANVAS_SHORTCUTS.filter((shortcut) => {
        if (category && category !== "all" && shortcut.category !== category) return false;
        if (!terms.length) return true;

        const categoryLabel = CANVAS_SHORTCUT_CATEGORIES.find((entry) => entry.id === shortcut.category)?.label || "";
        const searchableText = [shortcut.title, shortcut.description, categoryLabel, shortcut.keys.flat().join(" "), ...(shortcut.keywords || [])]
            .join(" ")
            .toLocaleLowerCase();
        return terms.every((term) => searchableText.includes(term));
    });
}
