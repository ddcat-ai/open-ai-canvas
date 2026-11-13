import type { AppLocale } from "./locales";

type Messages = { skin: string; avatar: string; site: string; classic: string; whale: string; orb: string };

export const personalAppearanceMessages: Record<AppLocale, Messages> = {
    "zh-CN": { skin: "界面主题", avatar: "助手形象", site: "跟随站点", classic: "经典", whale: "鲸鱼娘", orb: "动态球" },
    "en-US": { skin: "Interface theme", avatar: "Assistant appearance", site: "Site default", classic: "Classic", whale: "Whale girl", orb: "Animated orb" },
    "fr-FR": { skin: "Thème de l’interface", avatar: "Apparence de l’assistant", site: "Réglage du site", classic: "Classique", whale: "Fille baleine", orb: "Orbe animé" },
    "de-DE": { skin: "Oberflächendesign", avatar: "Aussehen des Assistenten", site: "Website-Standard", classic: "Klassisch", whale: "Walmädchen", orb: "Animierte Kugel" },
    "ja-JP": { skin: "画面テーマ", avatar: "アシスタントの外見", site: "サイトの設定に従う", classic: "クラシック", whale: "クジラ娘", orb: "アニメーション球体" },
    "ko-KR": { skin: "화면 테마", avatar: "도우미 외형", site: "사이트 기본값", classic: "클래식", whale: "고래 소녀", orb: "움직이는 구체" },
};
