/** 页面通知小夜做出反应的全局事件；只携带动作，不携带任何用户内容。 */
export const YORU_CHEER_EVENT = "meiye:yoru-cheer";

export function cheerYoru() {
    window.dispatchEvent(new Event(YORU_CHEER_EVENT));
}
