export const chapters = [
    { id: "opening", label: "序幕", title: "影策", subtitle: "让一个故事，从文字走向银幕。", description: "面向 AI 影视与短剧创作的开源工作台。" },
    { id: "story", label: "故事", title: "一念，成故事。" },
    { id: "world", label: "角色", title: "让想象，有了面孔。" },
    { id: "shots", label: "分镜", title: "字里行间，皆是镜头。" },
    { id: "motion", label: "生成", title: "这一刻，动起来。" },
    { id: "canvas", label: "画布", title: "一个世界，一张画布。" },
] as const;

export type WelcomeLook = {
    id: string;
    label: string;
    title: string;
    frames: string[];
    screenplay: string[];
    video?: string;
    credit?: string;
};

const reelFrames = (folder: string, names: string[]) => Array.from({ length: 12 }, (_, index) => `/welcome/${folder}/${names[index % names.length]}.webp`);

export const welcomeLooks: WelcomeLook[] = [
    {
        id: "spring", label: "Spring · 奇幻", title: "山谷之春",
        frames: reelFrames("spring", ["1807", "1669", "4336", "3191", "3250"]),
        screenplay: ["外景 · 山谷 · 黎明", "云海漫过山脊。", "她握紧手中的木杖。", "一条小路，通往谷底。", "石壁投下巨大的影子。", "她停下，望向高处。", "风声忽然安静。", "微光落在她的脸上。", "沉睡的山谷开始苏醒。", "她向前迈出一步。", "远处，第一片新叶展开。", "春天，终于来到。"],
        credit: "Spring · Blender 开放电影演示素材",
    },
    {
        id: "charge", label: "Charge · 科幻", title: "最后的电量",
        frames: reelFrames("charge", ["factory-final", "einar", "robot", "character-final", "factory"]),
        screenplay: ["外景 · 能源工厂 · 傍晚", "最后一盏灯闪了一下。", "他望向远处的高塔。", "机械手臂缓缓收紧。", "工厂大门留着一道缝。", "他走进无人值守的走廊。", "警示灯突然亮起。", "一个身影挡住去路。", "电池就在玻璃后面。", "他没有后退。", "微弱的电流重新接通。", "黑暗中，多了一点光。"],
        video: "/welcome/charge/sequence.mp4", credit: "Charge · Blender 开放电影演示素材",
    },
    {
        id: "wing-it", label: "Wing It! · 动画", title: "飞向云端",
        frames: reelFrames("wing-it", ["banner", "pitch", "sky-01", "barn", "sky-04", "sky-06"]),
        screenplay: ["内景 · 谷仓 · 午后", "飞行器还差最后一颗螺丝。", "他拧紧旋钮。", "仪表盘上的指针跳了起来。", "屋顶外，是辽阔的天空。", "引擎轰鸣，尘土飞扬。", "他们终于离开地面。", "一片云从舷窗掠过。", "飞行器向左倾斜。", "他重新握住操纵杆。", "阳光照亮了整片云海。", "下一站，还没有名字。"],
        credit: "Wing It! · Blender 开放电影演示素材",
    },
];

export function getWelcomeLook(search = window.location.search) {
    const id = new URLSearchParams(search).get("look");
    return welcomeLooks.find((look) => look.id === id) ?? welcomeLooks[0];
}

export const showcases = [
    { name: "自由画布", image: "/welcome/workbench-canvas.webp", description: "把灵感连成作品。", detail: "整理参考、连接节点、比较结果，沿着自己的思路继续创作。", href: "/canvas" },
    { name: "即时创作", image: "/welcome/workbench-create.webp", description: "从一句话开始。", detail: "选择模型与参考素材，在对话中逐步完成图片和视频。", href: "/create" },
    { name: "项目工作台", image: "/welcome/workbench-project.webp", description: "让长故事有条理。", detail: "围绕章节、人物与分镜组织制作，随时回到正在推进的故事。", href: "/projects" },
] as const;
