// seed-audio-1.0 的 speaker 使用语音合成 2.0 音色；音频生成版本号不代表音色版本。
// 来源：https://docs.volcengine.com/docs/doubao-voice/audio-generation-http?lang=zh

export type DoubaoAudioVoiceOption = {
    scene: string;
    value: string;
    label: string;
    language: string;
};

export const doubaoDefaultAudioVoice = "zh_female_vv_uranus_bigtts";

export const doubaoAudioVoiceOptions: DoubaoAudioVoiceOption[] = [
    { scene: "通用场景", value: "zh_female_vv_uranus_bigtts", label: "Vivi 2.0", language: "中文、英文" },
    { scene: "通用场景", value: "zh_female_xiaohe_uranus_bigtts", label: "小何 2.0", language: "中文、英文" },
    { scene: "通用场景", value: "zh_male_m191_uranus_bigtts", label: "云舟 2.0", language: "中文、英文" },
    { scene: "通用场景", value: "zh_male_taocheng_uranus_bigtts", label: "小天 2.0", language: "中文、英文" },
    { scene: "通用场景", value: "zh_female_qingxinnvsheng_uranus_bigtts", label: "清新女声 2.0", language: "中文、英文" },
    { scene: "通用场景", value: "zh_female_shuangkuaisisi_uranus_bigtts", label: "爽快思思 2.0", language: "中文、英文" },
    { scene: "视频配音", value: "zh_male_ruyayichen_uranus_bigtts", label: "儒雅逸辰 2.0", language: "中文、英文" },
    { scene: "角色扮演", value: "zh_male_qingcang_uranus_bigtts", label: "擎苍 2.0", language: "中文、英文" },
];
