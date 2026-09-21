/** MiniMax T2A 语音合成节点：常量与节点状态类型。 */

export const MINIMAX_T2A_PLUGIN_ID = "minimax-t2a" as const;
export const MINIMAX_T2A_NODE_TYPE = "minimax-t2a" as const;
export const MINIMAX_T2A_SCHEMA_VERSION = 1 as const;
/** 节点状态在 node.metadata.pluginData 里的 key。 */
export const MINIMAX_T2A_STATE_KEY = "minimaxT2a" as const;

/** T2A 模型。 */
export type T2AModel = "speech-02-hd" | "speech-02" | "speech-02-turbo" | "speech-01-hd" | "speech-01";

/** 声音设置（voice_setting）。 */
export type T2AVoiceSetting = {
    voiceId: string;
    speed: number;   // 0.5 – 2.0
    vol: number;     // 0.1 – 3.0
    pitch: number;   // -12 – 12（仅 speech-02 系列）
    emotion: string; // 情感（仅 speech-02 系列）
    timbre?: string;
};

/** 音频设置（audio_setting）。 */
export type T2AAudioSetting = {
    sampleRate: number; // 8000/16000/32000/44100/48000
    bitrate: number;    // 仅 mp3
    format: "mp3" | "wav" | "pcm";
    channel: 1 | 2;
};

/** 生成结果。 */
export type T2AGenerationResult = {
    storageKey?: string;
    url?: string;
    durationMs?: number;
    bytes?: number;
    mimeType?: string;
};

/** 节点持久化状态（存 node.metadata.pluginData.minimaxT2a）。 */
export type MinimaxT2ANodeState = {
    schemaVersion: typeof MINIMAX_T2A_SCHEMA_VERSION;
    /** 当前 Tab。 */
    tab: "synthesize" | "voice-design" | "voice-clone";
    /** 合成文本（手动 + 可连线上游）。 */
    text: string;
    /** 模型。 */
    model: T2AModel;
    /** 声音设置。 */
    voice: T2AVoiceSetting;
    /** 音频设置。 */
    audio: T2AAudioSetting;
    /** 合成状态。 */
    status: "idle" | "loading" | "success" | "error";
    /** 最近一次合成结果。 */
    result: T2AGenerationResult | null;
    /** 错误信息。 */
    errorDetails?: string;
    /** 音色设计：描述。 */
    voiceDesignPrompt: string;
    /** 音色设计：试听文本。 */
    voiceDesignPreviewText: string;
    /** 音色设计：最近生成的音色 ID。 */
    voiceDesignVoiceId: string;
    /** 音色设计：试听音频。 */
    voiceDesignTrialAudio: T2AGenerationResult | null;
    /** 音色克隆：样本音频存储 key / 文件名。 */
    cloneSampleStorageKey?: string;
    cloneSampleName?: string;
    /** 音色克隆：音频实际朗读文本。 */
    cloneText: string;
    /** 音色克隆：目标音色 ID。 */
    cloneVoiceId: string;
    /** 音色克隆：克隆结果。 */
    cloneStatus: "idle" | "loading" | "success" | "error";
    cloneError?: string;
    /** 我的克隆音色列表。 */
    cloneVoices: Array<{ voiceId: string; name: string }>;
};

export function defaultT2AVoiceSetting(): T2AVoiceSetting {
    return { voiceId: "socialmedia_female_2_v1", speed: 1, vol: 1, pitch: 0, emotion: "" };
}

export function defaultT2AAudioSetting(): T2AAudioSetting {
    return { sampleRate: 32000, bitrate: 128000, format: "mp3", channel: 1 };
}

export function createEmptyMinimaxT2AState(): MinimaxT2ANodeState {
    return {
        schemaVersion: MINIMAX_T2A_SCHEMA_VERSION,
        tab: "synthesize",
        text: "",
        model: "speech-02-hd",
        voice: defaultT2AVoiceSetting(),
        audio: defaultT2AAudioSetting(),
        status: "idle",
        result: null,
        voiceDesignPrompt: "",
        voiceDesignPreviewText: "你好，我是角色名。这是我的声音，请用它为我配音。",
        voiceDesignVoiceId: "",
        voiceDesignTrialAudio: null,
        cloneText: "",
        cloneVoiceId: "my_voice_001",
        cloneStatus: "idle",
        cloneVoices: [],
    };
}

/** 情感选项（speech-02 系列）。 */
export const T2A_EMOTION_OPTIONS = [
    "happy", "sad", "angry", "fearful", "disgusted", "surprised", "neutral",
] as const;

/**
 * MiniMax T2A 预设音色（voice_id）。数据来源：
 * ① 官方「系统音色列表」（https://platform.minimaxi.com/docs/faq/system-voice-id）全部 327 个；
 * ② 常用社媒/语音代理音色（livekit 官方 MiniMax 集成；socialmedia_female_2_v1 已实测可用）。
 * 音色字段支持自由输入任意官方 voice_id（Select 可搜索）。
 */
export const T2A_PRESET_VOICES = [
    // 社媒/语音代理（livekit 官方集成；socialmedia_female_2_v1 已实测可用）
    { id: "socialmedia_female_2_v1", label: "社媒·女声 2（默认）" },
    { id: "socialmedia_female_1_v1", label: "社媒·女声 1" },
    { id: "voice_agent_Female_Phone_4", label: "语音代理·女声 4" },
    { id: "voice_agent_Male_Phone_1", label: "语音代理·男声 1" },
    { id: "voice_agent_Male_Phone_2", label: "语音代理·男声 2" },
    { id: "japanese_male_social_media_1_v2", label: "日语·社媒男声" },
    { id: "japanese_female_social_media_1_v2", label: "日语·社媒女声" },
    // 中文 (普通话)
    { id: "male-qn-qingse", label: "青涩青年音色" },
    { id: "male-qn-jingying", label: "精英青年音色" },
    { id: "male-qn-badao", label: "霸道青年音色" },
    { id: "male-qn-daxuesheng", label: "青年大学生音色" },
    { id: "female-shaonv", label: "少女音色" },
    { id: "female-yujie", label: "御姐音色" },
    { id: "female-chengshu", label: "成熟女性音色" },
    { id: "female-tianmei", label: "甜美女性音色" },
    { id: "male-qn-qingse-jingpin", label: "青涩青年音色-beta" },
    { id: "male-qn-jingying-jingpin", label: "精英青年音色-beta" },
    { id: "male-qn-badao-jingpin", label: "霸道青年音色-beta" },
    { id: "male-qn-daxuesheng-jingpin", label: "青年大学生音色-beta" },
    { id: "female-shaonv-jingpin", label: "少女音色-beta" },
    { id: "female-yujie-jingpin", label: "御姐音色-beta" },
    { id: "female-chengshu-jingpin", label: "成熟女性音色-beta" },
    { id: "female-tianmei-jingpin", label: "甜美女性音色-beta" },
    { id: "clever_boy", label: "聪明男童" },
    { id: "cute_boy", label: "可爱男童" },
    { id: "lovely_girl", label: "萌萌女童" },
    { id: "cartoon_pig", label: "卡通猪小琪" },
    { id: "bingjiao_didi", label: "病娇弟弟" },
    { id: "junlang_nanyou", label: "俊朗男友" },
    { id: "chunzhen_xuedi", label: "纯真学弟" },
    { id: "lengdan_xiongzhang", label: "冷淡学长" },
    { id: "badao_shaoye", label: "霸道少爷" },
    { id: "tianxin_xiaoling", label: "甜心小玲" },
    { id: "qiaopi_mengmei", label: "俏皮萌妹" },
    { id: "wumei_yujie", label: "妩媚御姐" },
    { id: "diadia_xuemei", label: "嗲嗲学妹" },
    { id: "danya_xuejie", label: "淡雅学姐" },
    { id: "Chinese (Mandarin)_Reliable_Executive", label: "沉稳高管" },
    { id: "Chinese (Mandarin)_News_Anchor", label: "新闻女声" },
    { id: "Chinese (Mandarin)_Mature_Woman", label: "傲娇御姐" },
    { id: "Chinese (Mandarin)_Unrestrained_Young_Man", label: "不羁青年" },
    { id: "Arrogant_Miss", label: "嚣张小姐" },
    { id: "Robot_Armor", label: "机械战甲" },
    { id: "Chinese (Mandarin)_Kind-hearted_Antie", label: "热心大婶" },
    { id: "Chinese (Mandarin)_HK_Flight_Attendant", label: "港普空姐" },
    { id: "Chinese (Mandarin)_Humorous_Elder", label: "搞笑大爷" },
    { id: "Chinese (Mandarin)_Gentleman", label: "温润男声" },
    { id: "Chinese (Mandarin)_Warm_Bestie", label: "温暖闺蜜" },
    { id: "Chinese (Mandarin)_Male_Announcer", label: "播报男声" },
    { id: "Chinese (Mandarin)_Sweet_Lady", label: "甜美女声" },
    { id: "Chinese (Mandarin)_Southern_Young_Man", label: "南方小哥" },
    { id: "Chinese (Mandarin)_Wise_Women", label: "阅历姐姐" },
    { id: "Chinese (Mandarin)_Gentle_Youth", label: "温润青年" },
    { id: "Chinese (Mandarin)_Warm_Girl", label: "温暖少女" },
    { id: "Chinese (Mandarin)_Kind-hearted_Elder", label: "花甲奶奶" },
    { id: "Chinese (Mandarin)_Cute_Spirit", label: "憨憨萌兽" },
    { id: "Chinese (Mandarin)_Radio_Host", label: "电台男主播" },
    { id: "Chinese (Mandarin)_Lyrical_Voice", label: "抒情男声" },
    { id: "Chinese (Mandarin)_Straightforward_Boy", label: "率真弟弟" },
    { id: "Chinese (Mandarin)_Sincere_Adult", label: "真诚青年" },
    { id: "Chinese (Mandarin)_Gentle_Senior", label: "温柔学姐" },
    { id: "Chinese (Mandarin)_Stubborn_Friend", label: "嘴硬竹马" },
    { id: "Chinese (Mandarin)_Crisp_Girl", label: "清脆少女" },
    { id: "Chinese (Mandarin)_Pure-hearted_Boy", label: "清澈邻家弟弟" },
    { id: "Chinese (Mandarin)_Soft_Girl", label: "柔和少女" },
    // 中文 (粤语)
    { id: "Cantonese_ProfessionalHost（F)", label: "粤语·专业女主持" },
    { id: "Cantonese_GentleLady", label: "粤语·温柔女声" },
    { id: "Cantonese_ProfessionalHost（M)", label: "粤语·专业男主持" },
    { id: "Cantonese_PlayfulMan", label: "粤语·活泼男声" },
    { id: "Cantonese_CuteGirl", label: "粤语·可爱女孩" },
    { id: "Cantonese_KindWoman", label: "粤语·善良女声" },
    // 英文
    { id: "Santa_Claus", label: "Santa Claus" },
    { id: "Grinch", label: "Grinch" },
    { id: "Rudolph", label: "Rudolph" },
    { id: "Arnold", label: "Arnold" },
    { id: "Charming_Santa", label: "Charming Santa" },
    { id: "Charming_Lady", label: "Charming Lady" },
    { id: "Sweet_Girl", label: "Sweet Girl" },
    { id: "Cute_Elf", label: "Cute Elf" },
    { id: "Attractive_Girl", label: "Attractive Girl" },
    { id: "Serene_Woman", label: "Serene Woman" },
    { id: "English_Trustworthy_Man", label: "Trustworthy Man" },
    { id: "English_Graceful_Lady", label: "Graceful Lady" },
    { id: "English_Aussie_Bloke", label: "Aussie Bloke" },
    { id: "English_Whispering_girl", label: "Whispering girl" },
    { id: "English_Diligent_Man", label: "Diligent Man" },
    { id: "English_Gentle-voiced_man", label: "Gentle-voiced man" },
    // 日文
    { id: "Japanese_IntellectualSenior", label: "Intellectual Senior" },
    { id: "Japanese_DecisivePrincess", label: "Decisive Princess" },
    { id: "Japanese_LoyalKnight", label: "Loyal Knight" },
    { id: "Japanese_DominantMan", label: "Dominant Man" },
    { id: "Japanese_SeriousCommander", label: "Serious Commander" },
    { id: "Japanese_ColdQueen", label: "Cold Queen" },
    { id: "Japanese_DependableWoman", label: "Dependable Woman" },
    { id: "Japanese_GentleButler", label: "Gentle Butler" },
    { id: "Japanese_KindLady", label: "Kind Lady" },
    { id: "Japanese_CalmLady", label: "Calm Lady" },
    { id: "Japanese_OptimisticYouth", label: "Optimistic Youth" },
    { id: "Japanese_GenerousIzakayaOwner", label: "Generous Izakaya Owner" },
    { id: "Japanese_SportyStudent", label: "Sporty Student" },
    { id: "Japanese_InnocentBoy", label: "Innocent Boy" },
    { id: "Japanese_GracefulMaiden", label: "Graceful Maiden" },
    // 韩文
    { id: "Korean_SweetGirl", label: "Sweet Girl" },
    { id: "Korean_CheerfulBoyfriend", label: "Cheerful Boyfriend" },
    { id: "Korean_EnchantingSister", label: "Enchanting Sister" },
    { id: "Korean_ShyGirl", label: "Shy Girl" },
    { id: "Korean_ReliableSister", label: "Reliable Sister" },
    { id: "Korean_StrictBoss", label: "Strict Boss" },
    { id: "Korean_SassyGirl", label: "Sassy Girl" },
    { id: "Korean_ChildhoodFriendGirl", label: "Childhood Friend Girl" },
    { id: "Korean_PlayboyCharmer", label: "Playboy Charmer" },
    { id: "Korean_ElegantPrincess", label: "Elegant Princess" },
    { id: "Korean_BraveFemaleWarrior", label: "Brave Female Warrior" },
    { id: "Korean_BraveYouth", label: "Brave Youth" },
    { id: "Korean_CalmLady", label: "Calm Lady" },
    { id: "Korean_EnthusiasticTeen", label: "Enthusiastic Teen" },
    { id: "Korean_SoothingLady", label: "Soothing Lady" },
    { id: "Korean_IntellectualSenior", label: "Intellectual Senior" },
    { id: "Korean_LonelyWarrior", label: "Lonely Warrior" },
    { id: "Korean_MatureLady", label: "Mature Lady" },
    { id: "Korean_InnocentBoy", label: "Innocent Boy" },
    { id: "Korean_CharmingSister", label: "Charming Sister" },
    { id: "Korean_AthleticStudent", label: "Athletic Student" },
    { id: "Korean_BraveAdventurer", label: "Brave Adventurer" },
    { id: "Korean_CalmGentleman", label: "Calm Gentleman" },
    { id: "Korean_WiseElf", label: "Wise Elf" },
    { id: "Korean_CheerfulCoolJunior", label: "Cheerful Cool Junior" },
    { id: "Korean_DecisiveQueen", label: "Decisive Queen" },
    { id: "Korean_ColdYoungMan", label: "Cold Young Man" },
    { id: "Korean_MysteriousGirl", label: "Mysterious Girl" },
    { id: "Korean_QuirkyGirl", label: "Quirky Girl" },
    { id: "Korean_ConsiderateSenior", label: "Considerate Senior" },
    { id: "Korean_CheerfulLittleSister", label: "Cheerful Little Sister" },
    { id: "Korean_DominantMan", label: "Dominant Man" },
    { id: "Korean_AirheadedGirl", label: "Airheaded Girl" },
    { id: "Korean_ReliableYouth", label: "Reliable Youth" },
    { id: "Korean_FriendlyBigSister", label: "Friendly Big Sister" },
    { id: "Korean_GentleBoss", label: "Gentle Boss" },
    { id: "Korean_ColdGirl", label: "Cold Girl" },
    { id: "Korean_HaughtyLady", label: "Haughty Lady" },
    { id: "Korean_CharmingElderSister", label: "Charming Elder Sister" },
    { id: "Korean_IntellectualMan", label: "Intellectual Man" },
    { id: "Korean_CaringWoman", label: "Caring Woman" },
    { id: "Korean_WiseTeacher", label: "Wise Teacher" },
    { id: "Korean_ConfidentBoss", label: "Confident Boss" },
    { id: "Korean_AthleticGirl", label: "Athletic Girl" },
    { id: "Korean_PossessiveMan", label: "Possessive Man" },
    { id: "Korean_GentleWoman", label: "Gentle Woman" },
    { id: "Korean_CockyGuy", label: "Cocky Guy" },
    { id: "Korean_ThoughtfulWoman", label: "Thoughtful Woman" },
    { id: "Korean_OptimisticYouth", label: "Optimistic Youth" },
    // 西班牙文
    { id: "Spanish_SereneWoman", label: "Serene Woman" },
    { id: "Spanish_MaturePartner", label: "Mature Partner" },
    { id: "Spanish_CaptivatingStoryteller", label: "Captivating Storyteller" },
    { id: "Spanish_Narrator", label: "Narrator" },
    { id: "Spanish_WiseScholar", label: "Wise Scholar" },
    { id: "Spanish_Kind-heartedGirl", label: "Kind-hearted Girl" },
    { id: "Spanish_DeterminedManager", label: "Determined Manager" },
    { id: "Spanish_BossyLeader", label: "Bossy Leader" },
    { id: "Spanish_ReservedYoungMan", label: "Reserved Young Man" },
    { id: "Spanish_ConfidentWoman", label: "Confident Woman" },
    { id: "Spanish_ThoughtfulMan", label: "Thoughtful Man" },
    { id: "Spanish_Strong-WilledBoy", label: "Strong-willed Boy" },
    { id: "Spanish_SophisticatedLady", label: "Sophisticated Lady" },
    { id: "Spanish_RationalMan", label: "Rational Man" },
    { id: "Spanish_AnimeCharacter", label: "Anime Character" },
    { id: "Spanish_Deep-tonedMan", label: "Deep-toned Man" },
    { id: "Spanish_Fussyhostess", label: "Fussy hostess" },
    { id: "Spanish_SincereTeen", label: "Sincere Teen" },
    { id: "Spanish_FrankLady", label: "Frank Lady" },
    { id: "Spanish_Comedian", label: "Comedian" },
    { id: "Spanish_Debator", label: "Debator" },
    { id: "Spanish_ToughBoss", label: "Tough Boss" },
    { id: "Spanish_Wiselady", label: "Wise Lady" },
    { id: "Spanish_Steadymentor", label: "Steady Mentor" },
    { id: "Spanish_Jovialman", label: "Jovial Man" },
    { id: "Spanish_SantaClaus", label: "Santa Claus" },
    { id: "Spanish_Rudolph", label: "Rudolph" },
    { id: "Spanish_Intonategirl", label: "Intonate Girl" },
    { id: "Spanish_Arnold", label: "Arnold" },
    { id: "Spanish_Ghost", label: "Ghost" },
    { id: "Spanish_HumorousElder", label: "Humorous Elder" },
    { id: "Spanish_EnergeticBoy", label: "Energetic Boy" },
    { id: "Spanish_WhimsicalGirl", label: "Whimsical Girl" },
    { id: "Spanish_StrictBoss", label: "Strict Boss" },
    { id: "Spanish_ReliableMan", label: "Reliable Man" },
    { id: "Spanish_SereneElder", label: "Serene Elder" },
    { id: "Spanish_AngryMan", label: "Angry Man" },
    { id: "Spanish_AssertiveQueen", label: "Assertive Queen" },
    { id: "Spanish_CaringGirlfriend", label: "Caring Girlfriend" },
    { id: "Spanish_PowerfulSoldier", label: "Powerful Soldier" },
    { id: "Spanish_PassionateWarrior", label: "Passionate Warrior" },
    { id: "Spanish_ChattyGirl", label: "Chatty Girl" },
    { id: "Spanish_RomanticHusband", label: "Romantic Husband" },
    { id: "Spanish_CompellingGirl", label: "Compelling Girl" },
    { id: "Spanish_PowerfulVeteran", label: "Powerful Veteran" },
    { id: "Spanish_SensibleManager", label: "Sensible Manager" },
    { id: "Spanish_ThoughtfulLady", label: "Thoughtful Lady" },
    // 葡萄牙文
    { id: "Portuguese_SentimentalLady", label: "Sentimental Lady" },
    { id: "Portuguese_BossyLeader", label: "Bossy Leader" },
    { id: "Portuguese_Wiselady", label: "Wise lady" },
    { id: "Portuguese_Strong-WilledBoy", label: "Strong-willed Boy" },
    { id: "Portuguese_Deep-VoicedGentleman", label: "Deep-voiced Gentleman" },
    { id: "Portuguese_UpsetGirl", label: "Upset Girl" },
    { id: "Portuguese_PassionateWarrior", label: "Passionate Warrior" },
    { id: "Portuguese_AnimeCharacter", label: "Anime Character" },
    { id: "Portuguese_ConfidentWoman", label: "Confident Woman" },
    { id: "Portuguese_AngryMan", label: "Angry Man" },
    { id: "Portuguese_CaptivatingStoryteller", label: "Captivating Storyteller" },
    { id: "Portuguese_Godfather", label: "Godfather" },
    { id: "Portuguese_ReservedYoungMan", label: "Reserved Young Man" },
    { id: "Portuguese_SmartYoungGirl", label: "Smart Young Girl" },
    { id: "Portuguese_Kind-heartedGirl", label: "Kind-hearted Girl" },
    { id: "Portuguese_Pompouslady", label: "Pompous lady" },
    { id: "Portuguese_Grinch", label: "Grinch" },
    { id: "Portuguese_Debator", label: "Debator" },
    { id: "Portuguese_SweetGirl", label: "Sweet Girl" },
    { id: "Portuguese_AttractiveGirl", label: "Attractive Girl" },
    { id: "Portuguese_ThoughtfulMan", label: "Thoughtful Man" },
    { id: "Portuguese_PlayfulGirl", label: "Playful Girl" },
    { id: "Portuguese_GorgeousLady", label: "Gorgeous Lady" },
    { id: "Portuguese_LovelyLady", label: "Lovely Lady" },
    { id: "Portuguese_SereneWoman", label: "Serene Woman" },
    { id: "Portuguese_SadTeen", label: "Sad Teen" },
    { id: "Portuguese_MaturePartner", label: "Mature Partner" },
    { id: "Portuguese_Comedian", label: "Comedian" },
    { id: "Portuguese_NaughtySchoolgirl", label: "Naughty Schoolgirl" },
    { id: "Portuguese_Narrator", label: "Narrator" },
    { id: "Portuguese_ToughBoss", label: "Tough Boss" },
    { id: "Portuguese_Fussyhostess", label: "Fussy hostess" },
    { id: "Portuguese_Dramatist", label: "Dramatist" },
    { id: "Portuguese_Steadymentor", label: "Steady Mentor" },
    { id: "Portuguese_Jovialman", label: "Jovial Man" },
    { id: "Portuguese_CharmingQueen", label: "Charming Queen" },
    { id: "Portuguese_SantaClaus", label: "Santa Claus" },
    { id: "Portuguese_Rudolph", label: "Rudolph" },
    { id: "Portuguese_Arnold", label: "Arnold" },
    { id: "Portuguese_CharmingSanta", label: "Charming Santa" },
    { id: "Portuguese_CharmingLady", label: "Charming Lady" },
    { id: "Portuguese_Ghost", label: "Ghost" },
    { id: "Portuguese_HumorousElder", label: "Humorous Elder" },
    { id: "Portuguese_CalmLeader", label: "Calm Leader" },
    { id: "Portuguese_GentleTeacher", label: "Gentle Teacher" },
    { id: "Portuguese_EnergeticBoy", label: "Energetic Boy" },
    { id: "Portuguese_ReliableMan", label: "Reliable Man" },
    { id: "Portuguese_SereneElder", label: "Serene Elder" },
    { id: "Portuguese_GrimReaper", label: "Grim Reaper" },
    { id: "Portuguese_AssertiveQueen", label: "Assertive Queen" },
    { id: "Portuguese_WhimsicalGirl", label: "Whimsical Girl" },
    { id: "Portuguese_StressedLady", label: "Stressed Lady" },
    { id: "Portuguese_FriendlyNeighbor", label: "Friendly Neighbor" },
    { id: "Portuguese_CaringGirlfriend", label: "Caring Girlfriend" },
    { id: "Portuguese_PowerfulSoldier", label: "Powerful Soldier" },
    { id: "Portuguese_FascinatingBoy", label: "Fascinating Boy" },
    { id: "Portuguese_RomanticHusband", label: "Romantic Husband" },
    { id: "Portuguese_StrictBoss", label: "Strict Boss" },
    { id: "Portuguese_InspiringLady", label: "Inspiring Lady" },
    { id: "Portuguese_PlayfulSpirit", label: "Playful Spirit" },
    { id: "Portuguese_ElegantGirl", label: "Elegant Girl" },
    { id: "Portuguese_CompellingGirl", label: "Compelling Girl" },
    { id: "Portuguese_PowerfulVeteran", label: "Powerful Veteran" },
    { id: "Portuguese_SensibleManager", label: "Sensible Manager" },
    { id: "Portuguese_ThoughtfulLady", label: "Thoughtful Lady" },
    { id: "Portuguese_TheatricalActor", label: "Theatrical Actor" },
    { id: "Portuguese_FragileBoy", label: "Fragile Boy" },
    { id: "Portuguese_ChattyGirl", label: "Chatty Girl" },
    { id: "Portuguese_Conscientiousinstructor", label: "Conscientious Instructor" },
    { id: "Portuguese_RationalMan", label: "Rational Man" },
    { id: "Portuguese_WiseScholar", label: "Wise Scholar" },
    { id: "Portuguese_FrankLady", label: "Frank Lady" },
    { id: "Portuguese_DeterminedManager", label: "Determined Manager" },
    // 法文
    { id: "French_Male_Speech_New", label: "Level-Headed Man" },
    { id: "French_Female_News Anchor", label: "Patient Female Presenter" },
    { id: "French_CasualMan", label: "Casual Man" },
    { id: "French_MovieLeadFemale", label: "Movie Lead Female" },
    { id: "French_FemaleAnchor", label: "Female Anchor" },
    { id: "French_MaleNarrator", label: "Male Narrator" },
    // 印尼文
    { id: "Indonesian_SweetGirl", label: "Sweet Girl" },
    { id: "Indonesian_ReservedYoungMan", label: "Reserved Young Man" },
    { id: "Indonesian_CharmingGirl", label: "Charming Girl" },
    { id: "Indonesian_CalmWoman", label: "Calm Woman" },
    { id: "Indonesian_ConfidentWoman", label: "Confident Woman" },
    { id: "Indonesian_CaringMan", label: "Caring Man" },
    { id: "Indonesian_BossyLeader", label: "Bossy Leader" },
    { id: "Indonesian_DeterminedBoy", label: "Determined Boy" },
    { id: "Indonesian_GentleGirl", label: "Gentle Girl" },
    // 德文
    { id: "German_FriendlyMan", label: "Friendly Man" },
    { id: "German_SweetLady", label: "Sweet Lady" },
    { id: "German_PlayfulMan", label: "Playful Man" },
    // 俄文
    { id: "Russian_HandsomeChildhoodFriend", label: "Handsome Childhood Friend" },
    { id: "Russian_BrightHeroine", label: "Bright Queen" },
    { id: "Russian_AmbitiousWoman", label: "Ambitious Woman" },
    { id: "Russian_ReliableMan", label: "Reliable Man" },
    { id: "Russian_CrazyQueen", label: "Crazy Girl" },
    { id: "Russian_PessimisticGirl", label: "Pessimistic Girl" },
    { id: "Russian_AttractiveGuy", label: "Attractive Guy" },
    { id: "Russian_Bad-temperedBoy", label: "Bad-tempered Boy" },
    // 意大利文
    { id: "Italian_BraveHeroine", label: "Brave Heroine" },
    { id: "Italian_Narrator", label: "Narrator" },
    { id: "Italian_WanderingSorcerer", label: "Wandering Sorcerer" },
    { id: "Italian_DiligentLeader", label: "Diligent Leader" },
    // 阿拉伯文
    { id: "Arabic_CalmWoman", label: "Calm Woman" },
    { id: "Arabic_FriendlyGuy", label: "Friendly Guy" },
    // 土耳其文
    { id: "Turkish_CalmWoman", label: "Calm Woman" },
    { id: "Turkish_Trustworthyman", label: "Trustworthy man" },
    // 乌克兰文
    { id: "Ukrainian_CalmWoman", label: "Calm Woman" },
    { id: "Ukrainian_WiseScholar", label: "Wise Scholar" },
    // 荷兰文
    { id: "Dutch_kindhearted_girl", label: "Kind-hearted girl" },
    { id: "Dutch_bossy_leader", label: "Bossy leader" },
    // 越南文
    { id: "Vietnamese_kindhearted_girl", label: "Kind-hearted girl" },
    // 泰文
    { id: "Thai_male_1_sample8", label: "Serene Man" },
    { id: "Thai_male_2_sample2", label: "Friendly Man" },
    { id: "Thai_female_1_sample1", label: "Confident Woman" },
    { id: "Thai_female_2_sample2", label: "Energetic Woman" },
    // 波兰文
    { id: "Polish_male_1_sample4", label: "Male Narrator" },
    { id: "Polish_male_2_sample3", label: "Male Anchor" },
    { id: "Polish_female_1_sample1", label: "Calm Woman" },
    { id: "Polish_female_2_sample3", label: "Casual Woman" },
    // 罗马尼亚文
    { id: "Romanian_male_1_sample2", label: "Reliable Man" },
    { id: "Romanian_male_2_sample1", label: "Energetic Youth" },
    { id: "Romanian_female_1_sample4", label: "Optimistic Youth" },
    { id: "Romanian_female_2_sample1", label: "Gentle Woman" },
    // 希腊文
    { id: "greek_male_1a_v1", label: "Thoughtful Mentor" },
    { id: "Greek_female_1_sample1", label: "Gentle Lady" },
    { id: "Greek_female_2_sample3", label: "Girl Next Door" },
    // 捷克文
    { id: "czech_male_1_v1", label: "Assured Presenter" },
    { id: "czech_female_5_v7", label: "Steadfast Narrator" },
    { id: "czech_female_2_v2", label: "Elegant Lady" },
    // 芬兰文
    { id: "finnish_male_3_v1", label: "Upbeat Man" },
    { id: "finnish_male_1_v2", label: "Friendly Boy" },
    { id: "finnish_female_4_v1", label: "Assetive Woman" },
    // 印地文
    { id: "hindi_male_1_v2", label: "Trustworthy Advisor" },
    { id: "hindi_female_2_v1", label: "Tranquil Woman" },
    { id: "hindi_female_1_v2", label: "News Anchor" },
] as const;
