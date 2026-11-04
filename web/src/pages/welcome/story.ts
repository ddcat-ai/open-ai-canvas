/** 界面文案字段（label、title、subtitle 等）保存 i18n 键，渲染时翻译；首幕标题是品牌名，直接显示。 */
export const chapters = [
    { id: "opening", label: "account.welcome.chapters.opening.label", title: "影策", subtitle: "account.welcome.chapters.opening.subtitle", description: "account.welcome.chapters.opening.description" },
    { id: "story", label: "account.welcome.chapters.story.label", title: "account.welcome.chapters.story.title" },
    { id: "world", label: "account.welcome.chapters.world.label", title: "account.welcome.chapters.world.title" },
    { id: "shots", label: "account.welcome.chapters.shots.label", title: "account.welcome.chapters.shots.title" },
    { id: "motion", label: "account.welcome.chapters.motion.label", title: "account.welcome.chapters.motion.title" },
    { id: "canvas", label: "account.welcome.chapters.canvas.label", title: "account.welcome.chapters.canvas.title" },
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

/** 剧本台词保存为 account.welcome.looks.<look>.screenplay.<n> 键，渲染时翻译。 */
const screenplayKeys = (look: string) => Array.from({ length: 12 }, (_, index) => `account.welcome.looks.${look}.screenplay.line${index + 1}`);
const reelFrames = (folder: string, names: string[]) => Array.from({ length: 12 }, (_, index) => `/welcome/${folder}/${names[index % names.length]}.webp`);

export const welcomeLooks: WelcomeLook[] = [
    {
        id: "spring", label: "account.welcome.looks.spring.label", title: "account.welcome.looks.spring.title",
        frames: reelFrames("spring", ["1807", "1669", "4336", "3191", "3250"]),
        screenplay: screenplayKeys("spring"),
        credit: "account.welcome.looks.spring.credit",
    },
    {
        id: "charge", label: "account.welcome.looks.charge.label", title: "account.welcome.looks.charge.title",
        frames: reelFrames("charge", ["factory-final", "einar", "robot", "character-final", "factory"]),
        screenplay: screenplayKeys("charge"),
        video: "/welcome/charge/sequence.mp4", credit: "account.welcome.looks.charge.credit",
    },
    {
        id: "wing-it", label: "account.welcome.looks.wingIt.label", title: "account.welcome.looks.wingIt.title",
        frames: reelFrames("wing-it", ["banner", "pitch", "sky-01", "barn", "sky-04", "sky-06"]),
        screenplay: screenplayKeys("wingIt"),
        credit: "account.welcome.looks.wingIt.credit",
    },
];

export function getWelcomeLook(search = window.location.search) {
    const id = new URLSearchParams(search).get("look");
    return welcomeLooks.find((look) => look.id === id) ?? welcomeLooks[0];
}

export const showcases = [
    { name: "account.welcome.showcases.canvas.name", image: "/welcome/workbench-canvas.webp", description: "account.welcome.showcases.canvas.description", detail: "account.welcome.showcases.canvas.detail", href: "/canvas" },
    { name: "account.welcome.showcases.create.name", image: "/welcome/workbench-create.webp", description: "account.welcome.showcases.create.description", detail: "account.welcome.showcases.create.detail", href: "/create" },
    { name: "account.welcome.showcases.projects.name", image: "/welcome/workbench-project.webp", description: "account.welcome.showcases.projects.description", detail: "account.welcome.showcases.projects.detail", href: "/projects" },
] as const;
