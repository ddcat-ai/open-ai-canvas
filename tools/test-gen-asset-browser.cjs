// Go 完成交易的 JSON 从 stdin 进入；只替换 API、媒体读取与浏览器存储边界。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const web = createRequire(path.join(root, 'web/package.json'));
const { transformSync } = web('rolldown/experimental');
const babel = web('@babel/core');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const durable = new Map(), local = new Map(), tails = new Map();
const storage = {
    config() {},
    async getItem(key) { return durable.get(key) ?? null; },
    async setItem(key, value) { durable.set(key, value); return value; },
    async removeItem(key) { durable.delete(key); },
    createInstance() { return storage; },
    async keys() { return [...durable.keys()]; },
};
global.window = {
    localStorage: { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) },
    setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {},
};
Object.defineProperty(global, 'navigator', { configurable: true, value: { locks: {
    async request(key, callback) {
        const previous = tails.get(key) ?? Promise.resolve();
        let release;
        const next = new Promise(resolve => { release = resolve; });
        tails.set(key, previous.then(() => next));
        await previous;
        try { return await callback(); } finally { release(); }
    },
} } });
global.fetch = async () => { throw Error('Unexpected network request'); };
const remoteAssets = new Map((input.remoteAssets || [input.asset]).map(asset => [asset.id, asset]));
if (input.scenario === 'remote-absent') remoteAssets.clear();
const uploadedAssets = [];
let duringAssetGet;
let remoteProject;
class ApiError extends Error {
    constructor(message, options = {}) { super(message); Object.assign(this, options); }
}
const mocks = {
    localforage: { __esModule: true, default: storage },
    '@/services/api/request': { ApiError, apiBaseURL: '/api', http: new Proxy({}, { get: (_, name) => () => { throw Error(`Unexpected HTTP ${name}`); } }) },
    '@/services/api/user-data': {
        getRemoteAsset: async id => {
            if (duringAssetGet) {
                const edit = duringAssetGet;
                duringAssetGet = undefined;
                await edit();
            }
            if (input.scenario === 'remote-unavailable') throw new ApiError('Unavailable', { status: 503 });
            if (!remoteAssets.has(id)) throw new ApiError('Not found', { status: 404 });
            return { asset: structuredClone(remoteAssets.get(id)) };
        },
        getRemoteAssetsByIds: async ids => ({ assets: ids.flatMap(id => remoteAssets.has(id) ? [remoteAssets.get(id)] : []) }),
        getRemoteCanvasProject: async () => ({ project: structuredClone(remoteProject) }),
        upsertRemoteAsset: async asset => {
            uploadedAssets.push(structuredClone(asset));
            remoteAssets.set(asset.id, structuredClone(asset));
            return { asset };
        },
        upsertRemoteCanvasProject: async project => {
            remoteProject = { ...project, revision: (project.revision || 0) + 1 };
            return { project: remoteProject };
        },
    },
    '@/services/image-storage': { resolveImageUrl: async (key) => `https://display.example/${key}?signature=first` },
    '@/services/file-storage': { resolveMediaUrl: async (_key, url) => url },
    '@/services/resource-blob-cache': { getCachedResourceBlob: async () => new Blob(['fixture']) },
};
const modules = new Map();
function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    let source = fs.readFileSync(file, 'utf8');
    const mutations = {
        adoption: ['/services/project-asset-sync.ts', 'if (!asset && options.node.metadata?.assetId)', 'if (false)'],
        managed: ['/services/project-asset-sync.ts', 'if ((options.taskId || options.node.metadata?.taskId) && options.node.metadata?.storageKey?.startsWith("resource:"))', 'if (false)'],
        lookup: ['/services/user-data-sync.ts', 'if (!baseline) {\n            // 空缓存', 'if (false) {\n            // 空缓存'],
        skipPut: ['/services/user-data-sync.ts', 'if (adoptedAssetIds.has(dirty.id)) continue;', ''],
        lookupFailure: ['/services/user-data-sync.ts', 'if (error instanceof ApiError && error.status === 404) continue;', 'if (error instanceof ApiError) continue;'],
        repair: ['/services/canvas-asset-repair.ts', 'if (node.metadata?.taskId && node.metadata.storageKey?.startsWith("resource:")) return undefined;', ''],
        dropLocal: ['/services/user-data-sync.ts', 'const mergedContent = mergeThreeWayValue(content(source), defaults ? content(defaults) : undefined, remoteContent) as Asset;', 'const mergedContent = remoteContent;'],
        dropRemote: ['/services/user-data-sync.ts', 'const mergedContent = mergeThreeWayValue(content(source), defaults ? content(defaults) : undefined, remoteContent) as Asset;', 'const mergedContent = content(source);'],
        ignoreConflict: ['/services/user-data-sync.ts', 'throw assetRemoteVersionConflict();', 'merged = asset;'],
        retryDropsLocal: ['/services/user-data-sync.ts', 'const mergedContent = mergeThreeWayValue(content(source), defaults ? content(defaults) : undefined, remoteContent) as Asset;', 'const mergedContent = remoteContent;'],
        categoryDefault: ['/services/project-asset-sync.ts', 'category: "material",', ''],
        stableMedia: ['/services/user-data-sync.ts', 'if (resourceId) {', 'if (false) {'],
        clientMetadata: ['/services/user-data-sync.ts', 'delete metadata[key];', 'void metadata[key];'],
        storedMetadata: ['/services/user-data-sync.ts', 'merged = applyEdits(asset, source, remoteContent, mergedContent) as Asset;', 'merged = mergedContent;'],
        localContext: ['/services/user-data-sync.ts', 'metadata[key] = source.metadata[key];', 'void source.metadata[key];'],
        staleGet: ['/services/user-data-sync.ts', 'if (!sameEntitySnapshot(current, source)) throw new Error("素材仍在编辑，请重新同步");', ''],
    };
    const mutation = mutations[process.env.CANVAS_TEST_GENERATION_GUARD_MUTATION];
    if (mutation && file.endsWith(mutation[0])) {
        assert(source.includes(mutation[1]), `Mutation target missing: ${mutation[0]}`);
        source = source.replace(mutation[1], mutation[2]);
    }
    // 只用于负对照：改变前端身份，证明真实双写会被数据库笔数断言发现。
    if (process.env.CANVAS_TEST_GENERATION_ID_MUTATION === '1' && file.endsWith('/stores/use-asset-store.ts')) {
        assert(source.includes('new TextEncoder().encode(effectKey)'));
        source = source.replace('new TextEncoder().encode(effectKey)', 'new TextEncoder().encode("different:" + effectKey)');
    }
    const js = transformSync(file, source, { jsx: { runtime: 'automatic' } }).code;
    const code = babel.transformSync(js, { configFile: false, babelrc: false, plugins: [web('@babel/plugin-transform-modules-commonjs')] }).code;
    function req(name) {
        if (name in mocks) return mocks[name];
        if (name.startsWith('@/') || name.startsWith('.')) {
            const base = name.startsWith('@/') ? path.join(root, 'web/src', name.slice(2)) : path.resolve(path.dirname(file), name);
            const resolved = ['', '.ts', '.tsx', '/index.ts'].map(ext => base + ext).find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
            if (!resolved) throw Error(`Cannot resolve ${name} from ${file}`);
            // 延迟读取无关模块，实际调用的业务函数仍执行原始源码。
            return new Proxy({}, { get: (_, key) => key === '__esModule' ? true : load(resolved)[key] });
        }
        return web(name);
    }
    new Function('require', 'module', 'exports', code)(req, module, module.exports);
    return module.exports;
}
const src = file => load(path.join(root, 'web/src', file));

async function run() {
    src('lib/user-scope.ts').setActiveUserScope('media-user');
    const assets = src('stores/use-asset-store.ts');
    const canvases = src('stores/canvas/use-canvas-store.ts');
    await Promise.all([assets.useAssetStore.persist.rehydrate(), canvases.useCanvasStore.persist.rehydrate()]);
    const pipeline = src('services/project-asset-sync.ts');
    const sync = src('services/user-data-sync.ts');
    const repair = src('services/canvas-asset-repair.ts');
    input.task.clientContext = { ...input.task.clientContext, conversationId: 'conversation', messageId: 'message', batchIndex: 0 };
    const node = input.project?.nodes[0] || { id: 'image-node', type: input.asset.kind, title: '图片', position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { taskId: input.task.id, status: 'loading' } };
    if (input.scenario === 'agent-without-id') delete node.metadata.assetId;
    remoteProject = input.project || { id: 'image-canvas', title: '画布', revision: 1, createdAt: input.task.createdAt, updatedAt: input.task.createdAt, nodes: [node], connections: [], chatSessions: [], activeChatId: null, viewport: { x: 0, y: 0, k: 1 }, directorScenes: [] };
    if (input.scenario === 'open') {
        canvases.useCanvasStore.setState({ projects: [structuredClone(remoteProject)] });
        await canvases.flushCanvasStorePersistence();
    }
    await sync.initializeRemoteUserDataSession('media-user');
    if (input.scenario === 'agent-live') await sync.refreshCanvasAfterAgent(remoteProject.id);
    else if (input.scenario !== 'open') await sync.loadCanvasProjectForEditing(remoteProject.id);
    if (input.scenario === 'reopen-synced') await sync.loadAssetsForUse([input.asset.id]);
    // Agent 已完成节点直接自动保存，不先运行 loading 节点的 materializer。
    let repairCreated = input.project ? 0 : repair.repairMissingCanvasAssets(undefined, true).createdAssets;
    const nodesRef = { current: canvases.useCanvasStore.getState().projects[0].nodes };
    const setNodes = update => { nodesRef.current = typeof update === 'function' ? update(nodesRef.current) : update; };
    const consume = async task => pipeline.consumeGenerationTaskNode(task, node.id, 0, args => src('services/canvas-generation-consumer.ts').applyCanvasGenerationTaskNodeEffect({
        projectId: remoteProject.id, nodeId: node.id, ...args, nodesRef, setNodes,
    }));
    if (!input.project) await consume(input.task);
    if (input.scenario.startsWith('edit-')) {
        // consume 已走真实 addGenerationAsset；仅在 API / storage 边界制造交错。
        const id = assets.useAssetStore.getState().assets[0].id;
        const generated = assets.useAssetStore.getState().assets[0];
        assert.equal(generated.title, input.asset.title, 'backend/frontend title defaults must agree');
        assert.equal(generated.category, 'material', 'generated category must be material');
        assert.equal(generated.source, input.asset.source, 'backend/frontend source defaults must agree');
        const localPatch = input.scenario === 'edit-category' ? { category: 'other' }
            : input.scenario === 'edit-source' ? { source: '我的來源' }
            : { title: '使用者剛改的標題', tags: ['保留我的編輯'] };
        localPatch.metadata = { ...generated.metadata, clientContext: { messageId: 'local-context-message', conversationId: 'local-context-conversation' } };
        if (input.scenario === 'edit-display-url') {
            localPatch.data = { ...generated.data, dataUrl: 'https://display.example/renewed?signature=second' };
            localPatch.coverUrl = localPatch.data.dataUrl;
        }
        if (input.scenario === 'edit-metadata') localPatch.metadata = { ...generated.metadata, conversationId: 'renewed', clientContext: { messageId: 'new-message' } };
        const remoteBefore = structuredClone(remoteAssets.get(id));
        if (input.scenario === 'edit-display-url') {
            remoteBefore.data.dataUrl = 'https://display.example/remote?signature=stored';
            remoteBefore.coverUrl = remoteBefore.data.dataUrl;
            remoteAssets.set(id, structuredClone(remoteBefore));
        }
        const edit = () => assets.useAssetStore.getState().updateAsset(id, localPatch);
        if (input.scenario === 'edit-during-get') {
            duringAssetGet = async () => {
                edit();
                // GET 不能持有 persist lock，否则此处会死锁。
                await assets.flushAssetStorePersistence();
            };
            await assert.rejects(sync.saveRemoteUserDataNow(), /素材仍在编辑/, 'GET edit must stop stale adoption');
            assert.equal(uploadedAssets.length, 0);
        } else {
            edit();
        }
        if (input.scenario === 'edit-disjoint') {
            assets.useAssetStore.getState().updateAsset(id, { tags: ['生成'], coverUrl: 'https://example.test/custom-cover.png' });
            remoteBefore.tags = ['遠端標籤'];
            remoteBefore.metadata.projectIds = ['remote-project'];
            remoteAssets.set(id, structuredClone(remoteBefore));
        }
        if (input.scenario.endsWith('conflict')) {
            if (input.scenario === 'edit-resource-conflict') {
                assets.useAssetStore.getState().updateAsset(id, { data: { ...generated.data, storageKey: 'resource:local-replacement' } });
                remoteBefore.data.storageKey = 'resource:remote-replacement';
            } else remoteBefore.title = '遠端改過的標題';
            remoteAssets.set(id, structuredClone(remoteBefore));
            for (let retry = 0; retry < 2; retry++) {
                await assert.rejects(sync.saveRemoteUserDataNow(), /素材远端版本已变化/, 'both edited must surface the normal asset conflict');
                assert.equal(assets.useAssetStore.getState().assets[0].title, localPatch.title, 'conflict must preserve local edits');
                assert.deepEqual(remoteAssets.get(id), remoteBefore, 'conflict must preserve remote edits');
                assert.equal(uploadedAssets.length, 0, 'conflict must not PUT');
            }
        } else {
            const editedAt = assets.useAssetStore.getState().assets[0].updatedAt;
            await sync.saveRemoteUserDataNow();
            const localAsset = assets.useAssetStore.getState().assets[0];
            assert.equal(localAsset.title, localPatch.title ?? generated.title, 'local edit must survive sync and retry');
            assert.equal(localAsset.category, localPatch.category ?? 'material', 'category edit must survive sync');
            assert.equal(localAsset.source, localPatch.source ?? '生成任务', 'source edit must survive sync');
            if (input.scenario === 'edit-display-url') {
                assert.equal(localAsset.data.dataUrl, remoteBefore.data.dataUrl, 'comparison must preserve the stored remote media URL');
                assert.equal(localAsset.coverUrl, remoteBefore.coverUrl, 'comparison must preserve the stored remote cover URL');
            }
            for (const key of ['clientContext', 'conversationId', 'messageId', 'batchIndex']) {
                const expected = remoteBefore.metadata[key] ?? localPatch.metadata[key];
                assert.deepEqual(localAsset.metadata[key], expected, `stored metadata must survive: ${key}`);
                assert.deepEqual(remoteAssets.get(id).metadata[key], expected, `remote metadata must survive PUT: ${key}`);
            }
            assert.equal(localAsset.updatedAt, editedAt, 'merged edits must retain their update timestamp');
            assert.deepEqual(localAsset.tags, input.scenario === 'edit-disjoint' ? ['遠端標籤'] : localPatch.tags ?? generated.tags, 'field merge must preserve the remote-only edit');
            if (input.scenario === 'edit-disjoint') {
                assert.deepEqual(localAsset.metadata.projectIds, ['remote-project'], 'business metadata must still merge');
                assert.equal(localAsset.coverUrl, 'https://example.test/custom-cover.png', 'custom covers must still merge');
            }
            assert.equal(uploadedAssets.length, 1, 'merged local edits must be saved');
            const expectedPut = input.scenario === 'edit-display-url'
                ? { ...localAsset, data: { ...localAsset.data, dataUrl: input.asset.data.dataUrl } }
                : localAsset;
            assert.deepEqual(uploadedAssets[0], expectedPut, 'PUT must contain the merged content');
            await sync.saveRemoteUserDataNow();
            assert.equal(uploadedAssets.length, 1, 'acknowledged merge must not loop');
        }
        await assets.flushAssetStorePersistence();
        process.stdout.write(JSON.stringify({ assets: uploadedAssets, nodeAssetId: id, repairCreated: 0, localAsset: assets.useAssetStore.getState().assets[0] }));
        return;
    }
    if (input.scenario === 'agent-without-id' || input.scenario === 'remote-unavailable') {
        if (input.scenario === 'agent-without-id') assert.equal(repair.repairMissingCanvasAssets(undefined, true).createdAssets, 0, '修复不能为受管产物建立随机素材');
        await assert.rejects(pipeline.ensureCanvasNodeAsset({ canvasId: remoteProject.id, node: nodesRef.current[0], source: 'canvas-generation', taskId: input.task.id }), input.scenario === 'remote-unavailable' ? /Unavailable/ : /生成素材尚未加载/);
        assert.equal(uploadedAssets.length, 0, '读取失败不能创建素材');
        process.stdout.write(JSON.stringify({ assets: [], nodeAssetId: input.asset.id, repairCreated: 0 }));
        return;
    }
    const saved = await pipeline.ensureCanvasNodeAsset({ canvasId: remoteProject.id, node: nodesRef.current[0], source: 'canvas-generation', taskId: input.task.id });
    if (!input.project) assert.equal(saved.created, false, '自动保存应重用 materialize 记录');
    if (input.project) {
        nodesRef.current[0].metadata.assetId = saved.assetId;
        canvases.useCanvasStore.getState().updateProject(remoteProject.id, { nodes: nodesRef.current });
    }
    repairCreated += repair.repairMissingCanvasAssets(undefined, true).createdAssets;
    if (!input.project) await consume(input.task);
    await sync.saveRemoteUserDataNow();
    const writes = uploadedAssets.length;
    await sync.saveRemoteUserDataNow();
    assert.equal(uploadedAssets.length, writes, 'context-only adoption must not cause another PUT');
    await Promise.all([assets.flushAssetStorePersistence(), canvases.flushCanvasStorePersistence()]);
    assert.equal(assets.useAssetStore.getState().assets.length, 1);
    assert.equal(nodesRef.current[0].metadata.assetId, saved.assetId);
    assert.equal(nodesRef.current[0].metadata.storageKey, input.asset.data.storageKey);
    process.stdout.write(JSON.stringify({ assets: uploadedAssets, nodeAssetId: saved.assetId, repairCreated, localAsset: assets.useAssetStore.getState().assets[0] }));
}
run().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
