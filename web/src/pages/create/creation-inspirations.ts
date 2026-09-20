import type { CreationMode } from "./creation-types";

export type CreationInspiration = { title: string; description: string; image: string; mode: CreationMode; prompt: string; featured?: boolean; source?: string };

export const creationFeaturedWorks: CreationInspiration[] = [
    {
        title: "雨夜霓虹 · 电影感开场",
        description: "宽银幕构图、环境反光与缓慢推进镜头",
        image: "/short-drama-styles/cyberpunk-neon.jpg",
        mode: "video",
        prompt: "雨夜城市街口，霓虹灯倒映在湿润路面，主角撑伞穿过人群，镜头从远景缓慢推进到侧脸特写，电影感光影，16:9",
        featured: true,
    },
    {
        title: "港风天台重逢",
        description: "复古色彩与克制的人物情绪",
        image: "/short-drama-styles/retro-hong-kong.jpg",
        mode: "video",
        prompt: "九十年代港风天台，黄昏逆光，两位多年未见的旧友隔着晾衣绳对望，风吹动衣角，镜头轻微手持并缓慢靠近",
    },
    {
        title: "暗巷悬疑追逐",
        description: "高反差黑色电影与紧张节奏",
        image: "/short-drama-styles/suspense-noir.jpg",
        mode: "video",
        prompt: "黑白悬疑电影风格，侦探在狭窄暗巷中追逐神秘人，路灯切割出强烈明暗，低机位跟拍，节奏逐渐加快",
    },
    {
        title: "东方幻想角色设定",
        description: "角色概念图与细腻材质表达",
        image: "/short-drama-styles/fantasy-3d.jpg",
        mode: "image",
        prompt: "东方幻想世界的年轻女剑客角色设定，银白发饰、层叠轻甲与红色披风，山雾背景，细腻材质，电影级概念设计",
    },
    {
        title: "温暖室内对话",
        description: "生活化场景与柔和叙事氛围",
        image: "/welcome/wing-it/barn.webp",
        mode: "text",
        prompt: "请帮我写一场发生在暖色灯光客厅里的母女对话戏：女儿准备离开家乡，母亲表面平静但一直在整理旧物，用动作和潜台词推进情绪。",
    },
    { title: "森林里的最后一封信", description: "童话叙事 · 从角色愿望建立冲突", image: "/short-drama-styles/storybook-fantasy.jpg", mode: "text", source: "Storyteller", prompt: "作为故事讲述者，为亲子观众写一个关于坚持的森林童话。主角是一只替动物送信的小狐狸，它必须在第一场雪之前送出一封没有地址的信。先给出角色的愿望与阻碍，再设计三个递进的事件，最后用一个可见的行动完成情绪转折。避免说教。" },
    { title: "末班车上的陌生人", description: "短剧编剧 · 让对白藏住真正目的", image: "/short-drama-styles/urban-live-action.jpg", mode: "text", source: "Screenwriter", prompt: "作为编剧，设计一段发生在末班公交车上的三分钟短剧。两位陌生人都声称自己丢失了一本笔记，但只有一人说真话。先定义人物动机、场景限制和各自隐瞒的信息，再写动作、对白与反转结尾。全剧限制两个角色、一个场景，适合低成本实拍。" },
    { title: "未来城市的记忆修补师", description: "科幻大纲 · 世界规则与人物代价", image: "/short-drama-styles/future-tech.jpg", mode: "text", source: "Novelist", prompt: "作为小说家，构思一部关于记忆修补师的未来都市短篇。城市居民能删除痛苦记忆，但主角发现每次删除都会遗失一种颜色。建立三条世界规则、主人公的核心缺陷、五个转折和付出代价的结局。先交付故事大纲，不直接铺写长篇。" },
    { title: "把告别写成一场雨", description: "诗性旁白 · 少解释，多感官细节", image: "/short-drama-styles/nature-healing.jpg", mode: "text", source: "Poet", prompt: "作为诗人，为一段雨中离乡的影像写四组中文旁白，每组不超过四十字。分别使用气味、触感、声音与光线表达告别，不直接使用悲伤、不舍或想念等情绪词。用朴素、可朗读的语言，给每组留一个停顿。" },
    { title: "一瓶饮料的夏日故事", description: "广告策划 · 人群、主张与三个镜头", image: "/short-drama-styles/real-life.jpg", mode: "text", source: "Advertiser", prompt: "作为广告策划，为面向年轻通勤者的无糖气泡饮料设计十五秒广告。定义目标人群、核心场景和一句传播主张，再给出三个镜头的画面、时长、音效与字幕。不要虚构营养或功效数据，用下班后一口清爽的体验讲故事。" },
    { title: "独立咖啡店的视觉语言", description: "品牌创意 · 让配色和语气讲同一件事", image: "/short-drama-styles/retro-hong-kong.jpg", mode: "text", source: "Creative Branding Strategist", prompt: "作为品牌策略师，为社区里一家安静的独立咖啡店提出三种视觉方向。品牌重视慢节奏、邻里关系和手作。每种方向包含色彩、摄影氛围、文字语气、三条社交内容主题和差异化理由。不要模仿已有连锁品牌的标识。" },
    { title: "给剧本做一次镜头诊断", description: "创作复盘 · 从叙事到声音提出修改", image: "/short-drama-styles/black-white-noir.jpg", mode: "text", source: "Film Critic", prompt: "请以电影评论者的视角审阅我接下来提供的剧本或分镜，从叙事、人物、构图、运镜和声音五个维度提出反馈。每条意见都引用我提供的片段，并给出一个能实际拍摄的修改方案。还没有收到材料时，先向我索取，不要假装看过影片。" },
    { title: "旧城街景的时代考据", description: "历史场景 · 区分史实、推测和虚构", image: "/short-drama-styles/period-live-action.jpg", mode: "text", source: "Historian", prompt: "作为历史研究者，协助我设计民国早期城市街景的影视场景。先问清具体年份、地点和人物阶层，再列出服饰、交通、招牌、建筑和日常用语的考据清单。明确区分有来源的史实、合理推测与戏剧性虚构，不编造文献。" },
    { title: "月面独行", description: "远景到特写 · 太空探索的孤独感", image: "/short-drama-styles/space-opera.jpg", mode: "video", prompt: "月球背面的荒原，宇航员独自走向一座废弃天线。镜头从极远景缓慢推进，低角度阳光在月尘上拉出长影，步伐沉重，头盔反射星光，克制冷色，宽银幕电影构图，无字幕。" },
    { title: "手作星球早餐", description: "定格动画 · 柔软材质与小动作", image: "/short-drama-styles/clay-stop-motion.jpg", mode: "video", prompt: "黏土定格动画风格，一位小小宇航员在圆形厨房煎一颗星星形状的鸡蛋，鸡蛋轻轻跳起。手作指纹质感、暖奶油色、柔和侧光，固定中景，动作简短连续，可爱但不夸张。" },
    { title: "山水之间的一叶舟", description: "水墨留白 · 横向移镜与轻雾", image: "/short-drama-styles/ink-narrative.jpg", mode: "video", prompt: "中国水墨动画，一叶小舟缓缓穿过层叠远山，薄雾留白，舟上人抬手触碰落下的花瓣。镜头平稳横移，墨色有自然晕染，少量朱红点缀，画面安静，动作节奏舒缓。" },
    { title: "雨后的玻璃花房", description: "治愈场景 · 前景水滴与逆光", image: "/short-drama-styles/nature-healing.jpg", mode: "video", prompt: "清晨雨后的玻璃花房，镜头透过挂着水滴的叶片缓缓推向盛开的白花，阳光从侧后方进入，浅景深，真实植物纹理，空气中薄薄水汽，宁静自然，无人物和文字。" },
    { title: "都市少女角色转面", description: "角色概念 · 统一服装与形体比例", image: "/short-drama-styles/chinese-2d.jpg", mode: "image", prompt: "原创二维动画都市少女角色设定，短发、宽松工装夹克和帆布包，正面、侧面与背面三视图，服装细节和身高比例一致，干净线稿配平涂阴影，暖灰背景，不添加文字，不模仿已有动漫角色。" },
    { title: "梦境里的倒置房间", description: "超现实概念 · 重力反转与柔光", image: "/short-drama-styles/surreal-dream.jpg", mode: "image", prompt: "超现实电影场景概念图，一间漂浮在云海中的倒置卧室，床和书桌悬在天花板上，一扇门通向浅粉色天空。低饱和奶油与雾蓝色，柔和漫反射，精确透视，细腻材质，无人物，无文字。" },
    { title: "海边旅店的黄昏", description: "实拍场景 · 用道具留下人物痕迹", image: "/short-drama-styles/urban-live-action.jpg", mode: "image", prompt: "沿海小城旧旅店房间的电影置景概念图，窗外是黄昏海面，风吹动米白窗帘，桌上有两杯没有喝完的茶和一本翻开的书。暖橙与浅蓝对比，自然胶片颗粒，眼平中广角，没有人物和可读文字。" },
    { title: "鲜亮漫画封面", description: "平面构成 · 大色块与戏剧性透视", image: "/short-drama-styles/comic-pop.jpg", mode: "image", prompt: "原创漫画封面插画，一位骑单车的城市信使跃过雨后积水，戏剧性低角度透视，青蓝、珊瑚红与暖黄色大色块，半调网点，清晰黑色轮廓，背景简洁，为顶部标题留白但不生成文字。" },
    { title: "烘焙店的秘密帮手", description: "三维角色 · 柔和材质与亲切表情", image: "/short-drama-styles/three-d-cartoon.jpg", mode: "image", prompt: "原创三维动画角色概念图，一只穿着面粉围裙的小浣熊站在烘焙台前，鼻尖沾着面粉，手里举着刚烤好的面包。柔软毛发、温暖侧光、自然可爱的比例，橘棕色和奶油白配色，背景轻微虚化。" },
];

export const inspirationSource = {
    repository: "https://github.com/f/awesome-chatgpt-prompts",
    revision: "f78a1c5136fa080155d928e0d7e2b4a41ddef03e",
    license: "CC0-1.0",
    notice: "8 条文本模板依据公开领域提示词翻译改编；其余为本项目编写。封面复用项目已有示意图，不代表实际生成结果。",
};
