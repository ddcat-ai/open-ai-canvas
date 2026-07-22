export type CameraMovePreset = {
    id: string;
    label: string;
    prompt: string;
};

export type TimeSequencePreset = {
    id: string;
    label: string;
    seconds: string;
    prompt: string;
};

export const CAMERA_MOVE_PRESETS: CameraMovePreset[] = [
    { id: "push_in", label: "缓慢推近", prompt: "镜头从中景缓慢推近至主体近景，逐步压缩背景空间，强化情绪聚焦。" },
    { id: "pull_out", label: "缓慢后拉", prompt: "镜头从主体近景缓慢后拉至环境中景，逐步显露空间关系和人物处境。" },
    { id: "pan_left", label: "向左摇镜", prompt: "镜头水平向左平稳摇动，跟随主体视线或动作方向展开场景信息。" },
    { id: "pan_right", label: "向右摇镜", prompt: "镜头水平向右平稳摇动，带出主体与周围环境的关系。" },
    { id: "tilt_up", label: "向上仰拍", prompt: "镜头由低处向上缓慢倾斜，突出主体的高度、压迫感或神圣感。" },
    { id: "tilt_down", label: "向下俯拍", prompt: "镜头由高处向下缓慢倾斜，揭示主体位置和环境布局。" },
    { id: "truck_left", label: "左移跟拍", prompt: "镜头沿水平方向向左移动，与主体保持稳定距离，形成横向跟拍。" },
    { id: "truck_right", label: "右移跟拍", prompt: "镜头沿水平方向向右移动，与主体保持稳定距离，形成流畅侧向运动。" },
    { id: "dolly_forward", label: "前移穿入", prompt: "镜头向前移动穿入场景，经过前景层次后靠近主体，形成沉浸式进入感。" },
    { id: "dolly_backward", label: "后退撤离", prompt: "镜头向后移动远离主体，空间逐渐扩大，制造疏离或揭示全局。" },
    { id: "crane_up", label: "升起俯视", prompt: "镜头从人物高度缓慢升起，转为俯视视角，展示环境规模。" },
    { id: "crane_down", label: "下降贴近", prompt: "镜头从高位缓慢下降至主体高度，逐步进入人物情绪空间。" },
    { id: "orbit_left", label: "左环绕", prompt: "镜头围绕主体向左半环绕运动，保持主体居中，展示轮廓和空间层次。" },
    { id: "orbit_right", label: "右环绕", prompt: "镜头围绕主体向右半环绕运动，保持主体清晰，增强戏剧张力。" },
    { id: "handheld", label: "手持微晃", prompt: "镜头带轻微手持晃动，保留真实摄影的不稳定呼吸感，但主体始终清晰。" },
    { id: "steadicam", label: "稳定跟随", prompt: "镜头以稳定器方式跟随主体移动，运动平滑连续，保持电影感节奏。" },
    { id: "tracking_forward", label: "正面跟拍", prompt: "镜头在主体正前方后退跟拍，主体朝镜头方向移动，表情和动作保持稳定可见。" },
    { id: "tracking_behind", label: "背后跟拍", prompt: "镜头在主体背后跟随前进，观众与主体同向进入场景。" },
    { id: "whip_pan", label: "甩镜转场", prompt: "镜头快速水平甩动形成运动模糊，并在动作结束时重新稳定到新构图。" },
    { id: "rack_focus", label: "焦点转移", prompt: "镜头焦点从前景缓慢转移到主体，或从主体转移到关键道具，景深变化自然。" },
    { id: "zoom_in", label: "光学变焦推进", prompt: "镜头进行轻微光学变焦推进，画面压缩感增强，但机位保持稳定。" },
    { id: "zoom_out", label: "光学变焦后退", prompt: "镜头进行轻微光学变焦后退，逐步展现更多环境信息。" },
    { id: "low_angle_push", label: "低角度推近", prompt: "低机位镜头缓慢推近主体，增强力量感、压迫感和戏剧性。" },
    { id: "top_down_reveal", label: "俯拍揭示", prompt: "镜头从垂直俯拍角度缓慢移动或下降，揭示人物与场景布局。" },
    { id: "foreground_pass", label: "前景掠过", prompt: "镜头移动时有前景物体从画面边缘掠过，增加空间深度和电影遮挡感。" },
    { id: "static_hold", label: "定镜凝视", prompt: "镜头保持稳定不移动，只让主体动作和环境细节产生变化，形成凝视感。" },
];

export const TIME_SEQUENCE_PRESETS: TimeSequencePreset[] = [
    {
        id: "short_6s",
        label: "6秒",
        seconds: "6",
        prompt: `[0s] 主体处于起始画面，交代动作、景别和空间关系
[2s] 镜头运动或主体动作发生明显变化
[4s] 情绪、动作或构图进入结果阶段
[6s] 动作落点，保持角色、服装和场景一致`,
    },
    {
        id: "short_9s",
        label: "9秒",
        seconds: "9",
        prompt: `[0s] 起始画面，明确主体、景别和环境关系
[3s] 主体动作展开，镜头保持连续
[6s] 动作或情绪进入转折与收束阶段
[9s] 结束画面，动作自然落点并保持角色与场景一致`,
    },
    {
        id: "standard_10s",
        label: "10秒",
        seconds: "10",
        prompt: `[0s] 起始画面，明确主体位置、景别和环境
[2s] 主体开始动作或表情变化，镜头保持连贯
[4s] 镜头推进、横移或环绕，展示关键细节
[6s] 动作进入转折点，人物与场景关系发生变化
[8s] 情绪或视觉重点收束到主体
[10s] 结束画面，动作自然停住并保持一致性`,
    },
    {
        id: "seedance_15s",
        label: "15秒",
        seconds: "15",
        prompt: `[0s] 起始画面，交代主体、景别、机位和环境氛围
[3s] 主体开始主要动作，表情和身体姿态发生变化
[6s] 镜头运动进入第二阶段，展示空间层次或关键道具
[9s] 动作出现转折，主体与场景互动增强
[12s] 镜头收束到情绪重点或叙事结果
[15s] 结束画面，动作自然完成，角色、服装、场景和光线保持一致`,
    },
];

export const TIME_SEQUENCE_TEMPLATE = TIME_SEQUENCE_PRESETS[2].prompt;

export function appendPromptSnippet(prompt: string, snippet: string) {
    const base = prompt.trimEnd();
    if (!base) return snippet;
    return `${base}\n${snippet}`;
}
