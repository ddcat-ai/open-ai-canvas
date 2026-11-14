// PeekReel 激活种子化核心逻辑。
// 激活页（index.html）与 e2e 测试（desktop/scripts/seed-e2e.mjs）共用同一份代码，
// 保证被验证的逻辑就是随应用发行的逻辑。无 DOM 依赖。
(function (global) {
    "use strict";

    // 模型分类：视频 → 图片 → 音频，默认文本。顺序不可换（名字可能同时含 image/video）。
    function classify(modelName) {
        const n = String(modelName || "").toLowerCase();
        if (/(seedance|kling|veo|wan2|sora|pixverse|vidu|hailuo|minimax|jimeng|video|s2v|v2v|ltx|runway|pika)/.test(n)) return { capability: "video", protocol: "newapi-channel-2" };
        if (/(flux|seedream|midjourney|stable-diffusion|stable_diffusion|\bsd3\b|dall-e|dalle|qwen-image|cogview|image|irag|kolors|hidream|imagen|grok-imagine)/.test(n)) return { capability: "image", protocol: "openai-image" };
        if (/(tts|voice|speech|audio|bark|f5-tts|f5tts)/.test(n)) return { capability: "audio", protocol: "openai-audio" };
        return { capability: "text", protocol: "chat-completion" };
    }

    // ===== 能力配置（与管理端默认值一致，后端按协议校验） =====
    function textCapability() {
        return {
            version: 1,
            text: {
                streaming: true, contextWindowTokens: 128000, maxOutputTokens: 16384,
                references: { promptMaxChars: 32000, maxImages: 0, maxImageBytes: 0, maxVideos: 0, maxVideoBytes: 0 },
            },
        };
    }

    // openai-image 档位换算表：3 档 × 10 比例，与管理端默认一致。
    var SIZE_PRESETS = (function () {
        var tiers = [["1k", 0], ["2k", 1], ["4k", 2]];
        var standard = {
            "1:1": ["1024x1024", "2048x2048", "2880x2880"],
            "16:9": ["1824x1024", "2752x1536", "3840x2160"],
            "9:16": ["1024x1824", "1536x2752", "2160x3840"],
            "4:3": ["1360x1024", "2304x1728", "3264x2448"],
            "3:4": ["1024x1360", "1728x2304", "2448x3264"],
            "3:2": ["1536x1024", "2496x1664", "3504x2336"],
            "2:3": ["1024x1536", "1664x2496", "2336x3504"],
            "4:5": ["1024x1280", "1792x2240", "2560x3200"],
            "5:4": ["1280x1024", "2240x1792", "3200x2560"],
            "21:9": ["2048x878", "3136x1344", "3808x1632"],
        };
        var presets = [];
        Object.keys(standard).forEach(function (ratio) {
            tiers.forEach(function (pair) {
                var parts = standard[ratio][pair[1]].split("x");
                presets.push({ tier: pair[0], ratio: ratio, width: Number(parts[0]), height: Number(parts[1]), size: standard[ratio][pair[1]] });
            });
        });
        return presets;
    })();

    function imageCapability() {
        return {
            version: 1,
            image: {
                references: { promptMaxChars: 32000, maxImages: 16, maxImageBytes: 31457280, maskSupported: true },
                size: { parameter: "size", default: "1:1", allowCustom: true, values: ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "21:9", "9:16", "1024x1024", "1360x1024", "1024x1360", "1536x1024", "1024x1536", "1024x1280", "1280x1024", "2048x878", "1824x1024", "1024x1824", "2048x2048", "2304x1728", "1728x2304", "2496x1664", "1664x2496", "1792x2240", "2240x1792", "3136x1344", "2752x1536", "1536x2752", "2880x2880", "3264x2448", "2448x3264", "3504x2336", "2336x3504", "2560x3200", "3200x2560", "3808x1632", "3840x2160", "2160x3840"], presets: SIZE_PRESETS },
                resolution: { supported: false, values: [], default: "auto" },
                quality: { supported: true, values: ["auto", "low", "medium", "high"], default: "auto" },
                transparentBackground: { supported: true, default: false },
                responseFormat: { supported: true, default: "auto" },
                outputFormat: { supported: true },
                maxOutputs: 15,
            },
        };
    }

    function videoCapability() {
        return {
            version: 1,
            video: {
                references: { promptMaxChars: 8000, minImages: 0, maxImages: 9, maxImageBytes: 31457280, maxVideos: 3, maxVideoBytes: 209715200, maxVideoDurationSeconds: 15, maxAudios: 3, maxAudioBytes: 15728640, maxAudioDurationSeconds: 15 },
                duration: { selection: "range", min: 1, max: 15, step: 1, default: 6 },
                ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
                defaultRatio: "16:9",
                resolutions: ["480p", "720p", "1080p", "1440p", "2160p"],
                defaultResolution: "720p",
                generateAudio: { supported: true, default: true },
                watermark: { supported: false, default: false },
                operations: ["text_to_video", "image_to_video"],
                defaultOperation: "text_to_video",
            },
        };
    }

    // ===== Passport：NewAPI 账号直通（注册/登录/自动发令牌/余额/兑换码） =====
    // pp(path, options) 返回 NewAPI 原始信封 {success, data, message}（不解包）；
    // 需鉴权的调用由注入方在 headers 里带上 Authorization: Bearer <access_token>。
    // 端点形状均经 api.peekcart.com 实证（2026-10-27，new-api v1.0.0-rc.47）。
    var QUOTA_PER_UNIT = 1000000;
    var TOKEN_NAME = "PeekReel-桌面端";

    function quotaToUSD(quota) {
        return Math.round(((Number(quota) || 0) / QUOTA_PER_UNIT) * 100) / 100;
    }

    async function ppCall(pp, path, options) {
        var res = await pp(path, options || {});
        if (!res || res.success !== true) {
            throw new Error((res && (res.message || res.error)) || "中转站返回了无法解析的响应");
        }
        return res;
    }

    // 确保存在专用令牌并返回其完整 key。幂等：已有可用令牌则复用。
    // NewAPI rc.47 起令牌列表/详情对普通用户一律返回掩码 key（r8UU****qKjc），
    // 完整密钥须走 POST /api/token/:id/key（服务端有审计与限流，用户只能取自己的令牌）。
    async function ensureToken(ppAuth) {
        function usable(items) {
            if (!Array.isArray(items)) return null;
            return items.filter(function (t) {
                return t.name === TOKEN_NAME && t.status === 1 && (t.unlimited_quota || (Number(t.remain_quota) || 0) > 0);
            })[0] || null;
        }
        function itemsOf(res) {
            var d = res.data;
            if (Array.isArray(d)) return d;
            return (d && d.items) || [];
        }
        function fullKeyOf(t) {
            return t && t.key && t.key.indexOf("*") === -1 ? t.key : null; // 未掩码（老版本服务端）才直接可用
        }
        async function fetchFullKey(id) {
            var res = await ppCall(ppAuth, "/api/token/" + id + "/key", { method: "POST" });
            var key = res && res.data && res.data.key;
            if (!key || key.indexOf("*") !== -1) throw new Error("服务端未返回完整密钥");
            return key;
        }
        var found = usable(itemsOf(await ppCall(ppAuth, "/api/token/?p=1&size=100")));
        if (found) return { key: fullKeyOf(found) || (await fetchFullKey(found.id)), id: found.id, reused: true };
        await ppCall(ppAuth, "/api/token/", {
            method: "POST",
            body: JSON.stringify({ name: TOKEN_NAME, expired_time: -1, unlimited_quota: true, model_limits_enabled: false, group: "" }),
        });
        var created = usable(itemsOf(await ppCall(ppAuth, "/api/token/?p=1&size=100")));
        if (!created) throw new Error("令牌已创建但未能读取密钥");
        return { key: fullKeyOf(created) || (await fetchFullKey(created.id)), id: created.id, reused: false };
    }

    var passport = {
        QUOTA_PER_UNIT: QUOTA_PER_UNIT,
        TOKEN_NAME: TOKEN_NAME,
        quotaToUSD: quotaToUSD,
        ensureToken: ensureToken,

        // 注册：最小载荷 {username, password} 即可（实证无需 password2/邮箱）。
        register: async function (pp, creds) {
            await ppCall(pp, "/api/auth/register", {
                method: "POST",
                body: JSON.stringify({ username: creds.username, password: creds.password, acceptedTerms: true }),
            });
            return true;
        },

        // 登录：返回 {accessToken, user}；user.quota 为配额（500000 = $1）。
        login: async function (pp, creds) {
            var res = await ppCall(pp, "/api/auth/login", {
                method: "POST",
                body: JSON.stringify({ username: creds.username, password: creds.password }),
            });
            var data = res.data || {};
            if (!data.access_token) throw new Error("登录成功但未返回访问令牌");
            return { accessToken: data.access_token, user: data.user || {} };
        },

        // 账户信息：{quota, usedQuota, displayName}。
        self: async function (ppAuth) {
            var res = await ppCall(ppAuth, "/api/wallet?page=1&pageSize=1");
            var u = res.data || {};
            var account = u.account || {};
            return { quota: Number(account.availableMicrocredits) || 0, usedQuota: Number(account.reservedMicrocredits) || 0, displayName: "" };
        },

        // 兑换码充值：返回充值后的新配额。
        redeem: async function (ppAuth, code) {
            var res = await ppCall(ppAuth, "/api/wallet/redeem", {
                method: "POST",
                body: JSON.stringify({ code: code }),
            });
            return Number(res.data && res.data.account && res.data.account.availableMicrocredits) || 0;
        },
    };

    // 中转模型目录刷新（启动自愈）：激活后 relay 新增的模型（如图片渠道上线）自动补进老客户端。
    // 与 runBootstrap 模型段同逻辑：fetch 预览 → import 幂等入库 → 只配置「未配置过」的模型
    // （已配置的跳过，保护管理员在后台改过的价格/能力/启停）。
    async function syncRelayModels(api, opts, onLog) {
        var log = onLog || function () {};
        var relayUrl = opts.relayUrl;
        var apiKey = opts.apiKey;
        if (!relayUrl || !apiKey) return { skipped: true };
        var page = await api("/api/admin/channels?limit=100");
        var existing = (page.channels || []).filter(function (ch) { return ch.name === "PeekReel"; })[0];
        if (!existing) return { skipped: true }; // 渠道未建=未激活，runBootstrap 负责
        // 密钥/地址漂移自愈（换钥后启动即生效）
        await api("/api/admin/channels/" + existing.id, {
            method: "PATCH",
            body: JSON.stringify({ name: "PeekReel", baseUrl: relayUrl, apiKey: apiKey, enabled: true }),
        });
        var fetched = await api("/api/admin/channels/" + existing.id + "/models/fetch", { method: "POST", body: "{}" });
        var catalog = fetched.models || [];
        for (var start = 0; start < catalog.length; start += 500) {
            await api("/api/admin/channels/" + existing.id + "/models/import", {
                method: "POST",
                body: JSON.stringify({ models: catalog.slice(start, start + 500) }),
            });
        }
        var list = await api("/api/admin/channels/" + existing.id + "/models");
        var models = list.models || [];
        var configured = 0;
        for (var i = 0; i < models.length; i++) {
            var item = models[i];
            if (item.enabled && item.capability && item.protocol && item.priceConfigured) continue; // 已配置过
            var kind = classify(item.modelKey);
            var body = {
                modelKey: item.modelKey,
                providerModelKey: item.providerModelKey || item.modelKey,
                displayName: item.modelKey,
                capability: kind.capability,
                protocol: kind.protocol,
                billingMode: "fixed_request",
                unitPriceMicrocredits: 0,
                priceConfigured: true,
                enabled: true,
            };
            if (kind.capability === "text") body.capabilityConfig = textCapability();
            else if (kind.capability === "image") body.capabilityConfig = imageCapability();
            else if (kind.capability === "video") body.capabilityConfig = videoCapability();
            await api("/api/admin/channels/" + existing.id + "/models/" + item.id, {
                method: "PATCH",
                body: JSON.stringify(body),
            });
            configured++;
        }
        if (configured) log("中转模型目录已刷新：新配置 " + configured + " 个（共 " + models.length + "）");
        return { channelId: existing.id, catalogCount: catalog.length, modelCount: models.length, configured: configured };
    }

    // 完整种子化序列。api(path, options) 返回业务信封解包后的 data；
    // onLog(text, isError) 用于进度输出。幂等：重复执行会复用渠道与已有模型。
    async function runBootstrap(api, opts, onLog) {
        var log = onLog || function () {};
        var relayUrl = opts.relayUrl;
        var apiKey = opts.apiKey;

        // 1. 复用或创建系统渠道
        var page = await api("/api/admin/channels?limit=100");
        var existing = (page.channels || []).filter(function (ch) { return ch.name === "PeekReel"; })[0];
        var channelId;
        if (existing) {
            await api("/api/admin/channels/" + existing.id, {
                method: "PATCH",
                body: JSON.stringify({ name: "PeekReel", baseUrl: relayUrl, apiKey: apiKey, enabled: true }),
            });
            channelId = existing.id;
            log("复用已有渠道 PeekReel（" + channelId + "），已更新密钥");
        } else {
            var created = await api("/api/admin/channels", {
                method: "POST",
                body: JSON.stringify({ name: "PeekReel", baseUrl: relayUrl, apiKey: apiKey, enabled: true }),
            });
            channelId = created.channel.id;
            log("已创建系统渠道 PeekReel → " + relayUrl);
        }

        // 2. 从上游拉模型目录（fetch 仅预览不落库，import 才写入渠道模型）
        var fetched = await api("/api/admin/channels/" + channelId + "/models/fetch", { method: "POST", body: "{}" });
        var catalog = fetched.models || [];
        log("从上游拉取到 " + catalog.length + " 个模型");
        for (var start = 0; start < catalog.length; start += 500) {
            await api("/api/admin/channels/" + channelId + "/models/import", {
                method: "POST",
                body: JSON.stringify({ models: catalog.slice(start, start + 500) }),
            });
        }

        // 3. 逐个按能力分类配置并启用
        var list = await api("/api/admin/channels/" + channelId + "/models");
        var models = list.models || [];
        var done = 0;
        for (var i = 0; i < models.length; i++) {
            var item = models[i];
            var kind = classify(item.modelKey);
            var body = {
                modelKey: item.modelKey,
                providerModelKey: item.providerModelKey || item.modelKey,
                displayName: item.modelKey,
                capability: kind.capability,
                protocol: kind.protocol,
                billingMode: "fixed_request",
                unitPriceMicrocredits: 0,
                priceConfigured: true,
                enabled: true,
            };
            if (kind.capability === "text") body.capabilityConfig = textCapability();
            else if (kind.capability === "image") body.capabilityConfig = imageCapability();
            else if (kind.capability === "video") body.capabilityConfig = videoCapability();
            await api("/api/admin/channels/" + channelId + "/models/" + item.id, {
                method: "PATCH",
                body: JSON.stringify(body),
            });
            done++;
            if (done % 10 === 0 || done === models.length) log("已配置 " + done + "/" + models.length + " 个模型");
        }

        // 4. 锁定渠道 + 关闭开源营销页：welcome 是开源项目首页（含 GitHub 外链/贡献者），
        //    桌面单机版整体下线；渠道锁定防用户绕开 PeekReel 中转。
        await api("/api/admin/settings/features", {
            method: "PATCH",
            body: JSON.stringify({ customChannelsEnabled: false, welcomeEnabled: false }),
        });
        log("已锁定渠道设置（仅 PeekReel 中转）并下线 welcome 页");

        // 5. 品牌外观（canvas.agentName 与视频置空是后端默认值兜底之外的第二道保险：
        //    后端默认值已改 PeekReel/空，这里显式写库保证存量库升级后也一致；
        //    PATCH 按 JSON 键覆盖合并，canvas 只给 agentName 不会清掉其余画布配置）
        await api("/api/admin/settings/appearance", {
            method: "PATCH",
            body: JSON.stringify(function () {
                // 白标：品牌来自壳（window.__PEEKREEL_BRAND__，local-server config 下发 app.getName()）
                var b = (typeof window !== "undefined" && window.__PEEKREEL_BRAND__) || "PeekReel";
                var slug = b.toLowerCase().replace(/[^a-z0-9]+/g, "") || "peekreel";
                return {
                    brandName: b,
                    brandSlug: slug,
                    authHeroTitle: "先睹你的故事",
                    authHeroDescription: b + " — 本地优先的 AI 影视创作工作台。文本、图片、视频，全部在你的电脑上生成。",
                    authVideoUrl: "",
                    authVideoPosterUrl: "",
                    seoTitle: b,
                    seoDescription: b + " — 本地优先的 AI 影视与短剧创作工作台。",
                    footerCopyright: "© " + new Date().getFullYear() + " " + b,
                    icpFilingEnabled: false,
                    canvas: { agentName: b },
                };
            }()),
        });
        log("已应用 " + ((typeof window !== "undefined" && window.__PEEKREEL_BRAND__) || "PeekReel") + " 品牌外观（含画布助手命名）");

        return { channelId: channelId, catalogCount: catalog.length, configuredCount: models.length };
    }

    // ===== 直连渠道同步：视频/音频等原生协议渠道（服务器下发目录，含密钥） =====
    // 与 PeekReel 中转互补：走 NewAPI 的模型按用户计费；原生协议（如火山 Seed TTS、
    // MiniMax H3 multipart）NewAPI 无法转发，由本地后端直连上游，密钥经此目录下发、
    // 本地加密落库。目录隐藏 slug + 服务器可随时换钥（无需发新版客户端）。
    // localChannels：本机渠道（local:true）由调用方注入 baseUrl/apiKey，按目录的 localKey 取
    // （例：豆包网页桥 { doubao: { baseUrl: "http://127.0.0.1:8787", apiKey: "<随机令牌>" }}）。
    async function syncDirectChannels(api, catalogUrl, log, localChannels, options) {
        if (!catalogUrl) return { skipped: true };
        options = options || {};
        if (options.signal) options.signal.throwIfAborted();
        var resp = await (options.fetchImpl || fetch)(catalogUrl, { cache: "no-store", signal: options.signal });
        if (!resp.ok) throw new Error("直连目录 HTTP " + resp.status);
        var doc = await resp.json();
        if (options.signal) options.signal.throwIfAborted();
        var channels = doc.channels || [];
        var page = await api("/api/admin/channels?limit=100");
        var byName = {};
        (page.channels || []).forEach(function (ch) { byName[ch.name] = ch; });
        var synced = 0;
        for (var i = 0; i < channels.length; i++) {
            var def = channels[i];
            var baseUrl = def.baseUrl;
            var apiKey = def.apiKey;
            if (def.local) {
                // 本机渠道：目录只带意图（名称/模型/协议/localKey），端点与令牌由调用方注入。
                var local = (localChannels || {})[def.localKey || "doubao"];
                if (!local || !local.baseUrl) {
                    log("跳过本机渠道（未就绪）：" + def.name);
                    continue;
                }
                baseUrl = local.baseUrl;
                apiKey = local.apiKey || "";
            }
            var channelId;
            // 渠道改名兼容：目录里的 name 是「现在该叫什么」，aliases 是「以前叫过什么」。
            // 老客户库里还是旧名，直接按新名匹配会新建一个空渠道、把旧渠道连同模型孤立掉，
            // 于是同一个「豆包」在后台裂成两条。这里先认新名，再认历史名，命中历史名就原地改名。
            var existing = byName[def.name] || null;
            if (!existing && def.aliases) {
                for (var ai = 0; ai < def.aliases.length; ai++) {
                    if (byName[def.aliases[ai]]) { existing = byName[def.aliases[ai]]; break; }
                }
            }
            if (existing) {
                await api("/api/admin/channels/" + existing.id, {
                    method: "PATCH",
                    body: JSON.stringify({ name: def.name, baseUrl: baseUrl, apiKey: apiKey, enabled: def.enabled !== false }),
                });
                channelId = existing.id;
                if (existing.name !== def.name) log("渠道改名：" + existing.name + " → " + def.name);
            } else {
                var created = await api("/api/admin/channels", {
                    method: "POST",
                    body: JSON.stringify({ name: def.name, baseUrl: baseUrl, apiKey: apiKey, enabled: def.enabled !== false }),
                });
                channelId = created.channel.id;
            }
            var list = await api("/api/admin/channels/" + channelId + "/models");
            var byKey = {};
            (list.models || []).forEach(function (m) { byKey[m.modelKey] = m; });
            for (var j = 0; j < (def.models || []).length; j++) {
                var md = def.models[j];
                var body = {
                    modelKey: md.modelKey,
                    providerModelKey: md.providerModelKey || md.modelKey,
                    displayName: md.displayName || md.modelKey,
                    capability: md.capability,
                    protocol: md.protocol,
                    billingMode: "fixed_request",
                    unitPriceMicrocredits: 0,
                    priceConfigured: true,
                    enabled: true,
                };
                if (md.capabilityConfig) body.capabilityConfig = md.capabilityConfig;
                if (byKey[md.modelKey]) {
                    await api("/api/admin/channels/" + channelId + "/models/" + byKey[md.modelKey].id, { method: "PATCH", body: JSON.stringify(body) });
                } else {
                    await api("/api/admin/channels/" + channelId + "/models", { method: "POST", body: JSON.stringify(body) });
                }
            }
            synced++;
            log("直连渠道已同步：" + def.name + "（" + (def.models || []).length + " 模型）");
        }
        // 渠道退役（2026-11-11）：新增模型统一在上游（api.peekcart.com）上架后经中转
        // 下发，客户端不再直连第三方，因此历史遗留的直连渠道要清掉。
        // 只认目录的显式 pruneChannels 白名单——不能「删掉所有不在目录里的渠道」，
        // 中转渠道 PeekReel 不在本目录（由激活/relay 同步管理），那样会误删。
        var pruned = [];
        var pruneList = doc.pruneChannels || [];
        if (pruneList.length) {
            var cur = await api("/api/admin/channels?limit=100");
            var rows = cur.channels || [];
            for (var p = 0; p < pruneList.length; p++) {
                var victim = rows.filter(function (ch) { return ch.name === pruneList[p]; })[0];
                if (!victim) continue;
                try {
                    await api("/api/admin/channels/" + victim.id, { method: "DELETE" });
                    pruned.push(victim.name);
                    log("渠道已退役：" + victim.name);
                } catch (e) {
                    if (options.signal) options.signal.throwIfAborted();
                    log("渠道退役失败（下次启动重试）：" + victim.name + " - " + e.message);
                }
            }
        }
        if (options.signal) options.signal.throwIfAborted();
        return { synced: synced, pruned: pruned };
    }

    global.PeekReelSeed = {
        classify: classify,
        textCapability: textCapability,
        imageCapability: imageCapability,
        videoCapability: videoCapability,
        runBootstrap: runBootstrap,
        syncRelayModels: syncRelayModels,
        syncDirectChannels: syncDirectChannels,
        passport: passport,
    };
})(typeof window !== "undefined" ? window : globalThis);
