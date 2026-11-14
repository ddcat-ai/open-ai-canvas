(function (root) {
    "use strict";

    function registrationPolicy(settings) {
        if (!settings || typeof settings.firstUser !== "boolean" || typeof settings.registrationEnabled !== "boolean") {
            throw new Error("注册策略无效，请重新获取");
        }
        if (!settings.firstUser && !settings.registrationEnabled) return { enabled: false, methods: [] };
        if (settings.firstUser) return { enabled: true, methods: [] };
        const methods = settings.smsAndEmailRegistration ? ["sms_email"] : [
            ...(settings.smsRegistration ? ["sms"] : []),
            ...(settings.emailRegistration || settings.emailCodeRequired ? ["email"] : []),
        ];
        return { enabled: methods.length > 0, methods };
    }

    function registrationInput(settings, values) {
        const policy = registrationPolicy(settings);
        if (!policy.enabled) throw new Error("注册暂不可用");
        if (!values.acceptedTerms) throw new Error("请先同意注册协议");
        const result = { username: values.username.trim(), password: values.password, acceptedTerms: true };
        if (settings.firstUser) {
            if (values.email.trim()) result.email = values.email.trim().toLowerCase();
            return result;
        }
        if (!policy.methods.includes(values.method)) throw new Error("请选择可用的验证方式");
        if (!values.ticket) throw new Error("请获取并填写验证码");
        result.ticket = values.ticket;
        if (values.method !== "sms") {
            if (!values.email.trim()) throw new Error("请输入邮箱");
            result.email = values.email.trim().toLowerCase();
            if (!values.emailCode.trim()) throw new Error("请输入邮箱验证码");
            result.emailCode = values.emailCode.trim();
        }
        if (values.method !== "email") {
            if (!values.phone.trim()) throw new Error("请输入手机号");
            result.phone = values.phone.trim();
            if (!values.smsCode.trim()) throw new Error("请输入短信验证码");
            result.smsCode = values.smsCode.trim();
        }
        return result;
    }

    const api = { registrationPolicy, registrationInput };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.LitePolicy = api;
}(globalThis));
