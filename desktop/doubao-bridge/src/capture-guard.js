'use strict';
/* capture-guard.js —— 串片防线的纯判定逻辑（无副作用，可单测）
 *
 * 背景（2026-11-11 实测）：豆包同一会话里，上一支生成完成的片子会一直渲染在消息流里；
 * chain 推送又可能带上一个仍在流式输出中的旧任务成品。驱动此前只判断「有视频」就交付，
 * 于是出现：
 *   · 6 秒「出片」（实际是页面残留，物理上不可能生成）
 *   · 「雪山日出」的片子被交付给「一杯咖啡」任务（同一资产指纹 fd6f32908a37）
 *
 * 三种拒绝原因，各自对应一个实证来源：
 *   baseline          — 发送前页面上就已存在的视频（DOM 扫描撞上残留）
 *   already-delivered — 该资产已被之前的任务交付过（跨任务重复认领）
 *   too-fast          — 距发送不足最小生成时间（物理不可能，必然是他人的片子）
 *
 * 这里只做判定；拒绝后由调用方保持 processing 继续等待新视频，绝不静默交付错误内容。
 */

/** TOS 路径整段身份去重：v16/v19 CDN 镜像仅签名目录不同、TOS 路径全同 */
function videoIdentity(url) {
    try {
        const u = new URL(url);
        const parts = u.pathname.split('/').filter(Boolean);
        const i = parts.findIndex((p) => p === 'video' || p === 'tos');
        const tail = i >= 0 ? parts.slice(i).join('/') : u.pathname;
        return u.hostname.includes('doubao') || u.hostname.includes('byte') ? tail : u.hostname + tail;
    } catch (e) {
        return url;
    }
}

/**
 * @param {object} input
 * @param {string} input.url              候选视频地址
 * @param {Set<string>} [input.baseline]  发送前已存在的身份集合
 * @param {Set<string>} [input.delivered] 已交付过的身份集合（跨任务累计）
 * @param {number} [input.sentAt]         本任务发送时刻（毫秒）
 * @param {number} [input.now]            当前时刻（测试可注入）
 * @param {number} [input.minMs]          最小生成时间（毫秒）
 * @returns {null | 'baseline' | 'already-delivered' | 'too-fast'} null = 可以交付
 */
function rejectionReason(input) {
    const { url, baseline, delivered, sentAt, now = Date.now(), minMs } = input || {};
    if (!url) return 'baseline';
    const id = videoIdentity(url);
    if (baseline && baseline.has(id)) return 'baseline';
    if (delivered && delivered.has(id)) return 'already-delivered';
    if (sentAt && minMs && now - sentAt < minMs) return 'too-fast';
    return null;
}

/** 拒绝原因的人类可读文案（直接进任务进度，用户能看懂） */
function rejectionMessage(reason) {
    switch (reason) {
        case 'baseline':
            return '页面上残留的是上一次的视频，不是本次生成';
        case 'already-delivered':
            return '这支片子已经交付给别的任务了，不能重复认领';
        case 'too-fast':
            return '距发送时间太短，不可能已经出片';
        default:
            return '疑似串片';
    }
}

module.exports = { videoIdentity, rejectionReason, rejectionMessage };
