import assert from "node:assert/strict";
import { test } from "bun:test";

async function loadPageWiring(modulePath, ownerExport, fieldsExport, switchExport) {
    const previousVersion = globalThis.__APP_VERSION__;
    const previousChangelog = globalThis.__APP_CHANGELOG__;
    globalThis.__APP_VERSION__ = "test";
    globalThis.__APP_CHANGELOG__ = "";
    try {
        const module = await import(modulePath);
        const owner = module[ownerExport];
        const FieldsComponent = module[fieldsExport];
        const SwitchComponent = module[switchExport];
        assert.equal(typeof owner, "function", `${ownerExport} must be exported by ${modulePath}`);
        assert.equal(typeof FieldsComponent, "function", `${fieldsExport} must be the hook-free fields view actually rendered by ${modulePath}`);
        assert.equal(typeof SwitchComponent, "function", `${switchExport} must be the real page Switch component`);
        return { module, owner, FieldsComponent, SwitchComponent };
    } finally {
        if (previousVersion === undefined) delete globalThis.__APP_VERSION__;
        else globalThis.__APP_VERSION__ = previousVersion;
        if (previousChangelog === undefined) delete globalThis.__APP_CHANGELOG__;
        else globalThis.__APP_CHANGELOG__ = previousChangelog;
    }
}

function findAntdSwitchElement(node, SwitchComponent) {
    if (!node || typeof node !== "object") return null;
    if (node.type && typeof node.type === "object" && node.type.__ANT_SWITCH === true) return node;
    if (node.type === SwitchComponent) return findAntdSwitchElement(SwitchComponent(node.props), SwitchComponent);
    const children = node.props?.children;
    if (Array.isArray(children)) {
        for (const child of children) {
            const match = findAntdSwitchElement(child, SwitchComponent);
            if (match) return match;
        }
        return null;
    }
    return findAntdSwitchElement(children, SwitchComponent);
}

function adminValues(allowLocalChannel) {
    return { name: "Local", baseUrl: "http://127.0.0.1:8000", allowLocalChannel, apiKey: "key" };
}

test("administrator default editor fields render the real Switch and feed the real save payload", { timeout: 30_000 }, async () => {
    const page = await loadPageWiring("../src/pages/admin/channels/channels-page.tsx", "adminLocalChannelFormOwner", "AdminLocalChannelFields", "AdminLocalChannelSwitch");
    assert.equal(typeof page.module.adminChannelSavePayload, "function");

    const values = adminValues(false);
    const form = {
        setFieldValue(name, value) {
            assert.equal(name, "allowLocalChannel");
            values.allowLocalChannel = value;
        },
    };
    const hiddenOwner = page.owner(false, "127.0.0.1", true);
    const hiddenTree = page.FieldsComponent({ visible: hiddenOwner.visible, checked: hiddenOwner.checked, form });
    assert.equal(findAntdSwitchElement(hiddenTree, page.SwitchComponent), null);
    assert.equal(page.module.adminChannelSavePayload(adminValues(true), false, "127.0.0.1").allowLocalChannel, false);

    const initialOwner = page.owner(true, "127.0.0.1", undefined);
    const initialTree = page.FieldsComponent({ visible: initialOwner.visible, checked: initialOwner.checked, form });
    const initialSwitch = findAntdSwitchElement(initialTree, page.SwitchComponent);
    assert.ok(initialSwitch, "default admin editor fields must contain the real AntD Switch");
    assert.equal(initialSwitch.props.checked, false);
    initialSwitch.props.onChange(true);
    assert.equal(values.allowLocalChannel, true, "real admin Switch must write the Form field");
    assert.equal(page.module.adminChannelSavePayload(values, true, "127.0.0.1").allowLocalChannel, true);

    const persistedOwner = page.owner(true, "localhost", true);
    const persistedTree = page.FieldsComponent({ visible: persistedOwner.visible, checked: persistedOwner.checked, form });
    const persistedSwitch = findAntdSwitchElement(persistedTree, page.SwitchComponent);
    assert.ok(persistedSwitch);
    assert.equal(persistedSwitch.props.checked, true);
    persistedSwitch.props.onChange(false);
    assert.equal(values.allowLocalChannel, false, "real admin Switch must clear the Form field");
    assert.equal(page.module.adminChannelSavePayload(values, true, "localhost").allowLocalChannel, false);

    const nonLoopbackOwner = page.owner(true, "canvas.example.com", true);
    assert.equal(findAntdSwitchElement(page.FieldsComponent({ visible: nonLoopbackOwner.visible, checked: nonLoopbackOwner.checked, form }), page.SwitchComponent), null);
    assert.equal(page.module.adminChannelSavePayload(adminValues(true), true, "canvas.example.com").allowLocalChannel, false);
});

test("user default channel fields render the real Switch and feed the real update patch", { timeout: 30_000 }, async () => {
    const page = await loadPageWiring("../src/pages/settings/index.tsx", "userLocalChannelFormOwner", "UserLocalChannelFields", "UserLocalChannelSwitch");
    assert.equal(typeof page.module.userLocalChannelChangePatch, "function");
    const channel = { id: "local", name: "Local", baseUrl: "http://127.0.0.1:8000", apiKey: "key", apiFormat: "openai", models: ["model"], allowLocalChannel: true };

    let update;
    const updateChannel = (id, patch) => {
        update = { id, patch };
    };
    const hiddenOwner = page.owner(false, "127.0.0.1", true);
    const hiddenTree = page.FieldsComponent({ channel, visible: hiddenOwner.visible, checked: hiddenOwner.checked, desktopLocalChannelsEnabled: false, hostname: "127.0.0.1", updateChannel });
    assert.equal(findAntdSwitchElement(hiddenTree, page.SwitchComponent), null);
    assert.equal(page.module.userLocalChannelChangePatch(false, "127.0.0.1", true).allowLocalChannel, false);

    const initialOwner = page.owner(true, "127.0.0.1", false);
    const initialTree = page.FieldsComponent({ channel: { ...channel, allowLocalChannel: false }, visible: initialOwner.visible, checked: initialOwner.checked, desktopLocalChannelsEnabled: true, hostname: "127.0.0.1", updateChannel });
    const initialSwitch = findAntdSwitchElement(initialTree, page.SwitchComponent);
    assert.ok(initialSwitch, "default user channel fields must contain the real AntD Switch");
    assert.equal(initialSwitch.props.checked, false);
    initialSwitch.props.onChange(true);
    assert.deepEqual(update, { id: "local", patch: { allowLocalChannel: true } }, "real user Switch must call updateChannel with the projected patch");

    const persistedOwner = page.owner(true, "localhost", true);
    const persistedTree = page.FieldsComponent({ channel, visible: persistedOwner.visible, checked: persistedOwner.checked, desktopLocalChannelsEnabled: true, hostname: "localhost", updateChannel });
    const persistedSwitch = findAntdSwitchElement(persistedTree, page.SwitchComponent);
    assert.ok(persistedSwitch);
    assert.equal(persistedSwitch.props.checked, true);
    persistedSwitch.props.onChange(false);
    assert.deepEqual(update, { id: "local", patch: { allowLocalChannel: false } });

    const nonLoopbackOwner = page.owner(true, "canvas.example.com", true);
    assert.equal(findAntdSwitchElement(page.FieldsComponent({ channel, visible: nonLoopbackOwner.visible, checked: nonLoopbackOwner.checked, desktopLocalChannelsEnabled: true, hostname: "canvas.example.com", updateChannel }), page.SwitchComponent), null);
    assert.deepEqual(page.module.userLocalChannelChangePatch(true, "canvas.example.com", true), { allowLocalChannel: false });
});
