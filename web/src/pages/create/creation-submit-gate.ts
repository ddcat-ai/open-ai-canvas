/**
 * 创作页的提交闸门：只防止「同一次创建任务」被重复触发（快速连点、回车连击）。
 *
 * 它必须只覆盖提交阶段，不能覆盖整个生成过程——否则上一条还在生成时，
 * 后面的提交会被静默丢弃。释放用令牌确认持有者，避免并发提交互相解锁。
 */
export function createCreationSubmitGate() {
    let owner: symbol | null = null;

    return {
        /** 取到提交权时返回令牌；已被占用返回 null。 */
        tryAcquire(): symbol | null {
            if (owner) return null;
            const token = Symbol("creation-submit");
            owner = token;
            return token;
        },
        /** 只有仍持有该令牌的调用方才能解锁。 */
        release(token: symbol) {
            if (owner === token) owner = null;
        },
    };
}
