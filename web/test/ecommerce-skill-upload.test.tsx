import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { InstallSkillUploadInput, Skill } from "../src/services/api/skills";

const dom = new Window({ url: "https://commerce.example.com/ecommerce" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { message } = await import("antd");
const skills = await import("../src/services/api/skills");
const curation = await import("../src/components/skills/skill-curation-browser");
const { setActiveUserScope } = await import("../src/lib/user-scope");
const { EcommerceSkillPicker } = await import("../src/pages/ecommerce/skill-picker");

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
let selected: string[];
let library: Skill[];
let uploadError: Error | undefined;
const uploads: InstallSkillUploadInput[] = [];
const errors: string[] = [];
const successes: string[] = [];
const changes: string[][] = [];

function Harness({ session = "initial-project" }: { session?: string }) {
    const [ids, setIds] = useState(["existing-skill"]);
    selected = ids;
    return (
        <EcommerceSkillPicker
            key={session}
            selected={ids}
            onChange={(next) => {
                changes.push(next);
                setIds(next);
            }}
        />
    );
}
async function render() {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
        root!.render(<Harness />);
    });
}
async function choose(file: File) {
    const input = host.querySelector<HTMLInputElement>('[aria-label="上传策划 Skill 文件"]')!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(input.value).toBe("");
}

beforeEach(() => {
    uploads.length = 0;
    errors.length = 0;
    successes.length = 0;
    changes.length = 0;
    uploadError = undefined;
    setActiveUserScope("upload-owner");
    library = [{ skillId: "existing-skill", skillName: "已有策划方法", description: "已有说明", isAdded: true, isPrivate: true } as Skill];
    spyOn(curation, "useSkillCuration").mockReturnValue({ curation: null, error: "", retry: () => {} });
    spyOn(skills, "listAddedSkills").mockImplementation(async () => ({ skills: library }));
    spyOn(skills, "listSkills").mockResolvedValue({ skills: [], totalCount: 0, hasMore: false, nextOffset: 0, page: 1, pageSize: 30, categories: [] });
    spyOn(skills, "installSkillUpload").mockImplementation(async (input) => {
        uploads.push(input);
        if (uploadError) throw uploadError;
        const skill = { skillId: `uploaded-${uploads.length}`, skillName: input.file.name, description: "来自用户上传的策划方法", isAdded: true, isPrivate: true } as Skill;
        library = [...library, skill];
        return { skill };
    });
    spyOn(message, "error").mockImplementation(((text: unknown) => {
        errors.push(String(text));
        return () => {};
    }) as typeof message.error);
    spyOn(message, "success").mockImplementation(((text: unknown) => {
        successes.push(String(text));
        return () => {};
    }) as typeof message.success);
});
afterEach(async () => {
    await act(async () => {
        root?.unmount();
    });
    root = undefined;
    host?.remove();
    mock.restore();
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

describe("电商 Skills 文件上传", () => {
    for (const [fileName, sourceType] of [
        ["commerce.zip", "zip"],
        ["SKILL.md", "markdown"],
        ["brand.markdown", "markdown"],
    ] as const) {
        test(`${fileName} 保存到个人库，成功后自动选择并保留已有选择`, async () => {
            await render();
            const file = new File(["skill contents"], fileName);
            await choose(file);
            expect(uploads).toHaveLength(1);
            expect(uploads[0]).toEqual({ file, sourceType, tag: "others", isPrivate: true });
            expect(selected).toEqual(["existing-skill", "uploaded-1"]);
            expect(host.textContent).toContain("已选择 2 个 Skills");
            expect(errors).toEqual([]);
            expect(successes).toEqual(["Skill 已上传并加入本轮策划"]);
            const pickerButton = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("已选择 2"))!;
            await act(async () => {
                pickerButton.click();
            });
            expect(document.querySelector(".ecommerce-skill-list")?.textContent).toContain(fileName);
            expect(document.querySelectorAll('.ecommerce-skill-list input[type="checkbox"]:checked')).toHaveLength(2);
        });
    }
    test("上传失败显示服务端错误，不新增选择或伪报成功，之后仍可重试", async () => {
        uploadError = new Error("技能包缺少 SKILL.md");
        await render();
        const file = new File(["broken zip"], "broken.zip");
        await choose(file);
        expect(selected).toEqual(["existing-skill"]);
        expect(errors).toEqual(["技能包缺少 SKILL.md"]);
        expect(successes).toEqual([]);
        uploadError = undefined;
        await choose(file);
        expect(uploads).toHaveLength(2);
        expect(selected).toEqual(["existing-skill", "uploaded-2"]);
    });
    test("超过 20 MB 的技能包被拦截，不发出安装请求", async () => {
        await render();
        const file = new File(["large"], "too-large.zip");
        Object.defineProperty(file, "size", { value: 20 * 1024 * 1024 + 1 });
        await choose(file);
        expect(uploads).toEqual([]);
        expect(selected).toEqual(["existing-skill"]);
        expect(errors).toEqual(["技能文件不能超过 20 MB"]);
    });
    test("非 Markdown 或 ZIP 的文件被拦截，不发出安装请求", async () => {
        await render();
        await choose(new File(["image"], "reference.png", { type: "image/png" }));
        expect(uploads).toEqual([]);
        expect(selected).toEqual(["existing-skill"]);
        expect(errors).toEqual(["请上传 Markdown 文件或 ZIP 技能包"]);
    });
    test("上传期间切换项目，旧组件完成后不回写新项目的 Skills", async () => {
        let finish: ((result: { skill: Skill }) => void) | undefined;
        spyOn(skills, "installSkillUpload").mockImplementation((input) => {
            uploads.push(input);
            return new Promise((resolve) => {
                finish = resolve;
            });
        });
        await render();
        await choose(new File(["skill"], "late.zip"));
        expect(uploads).toHaveLength(1);
        await act(async () => {
            root!.render(<Harness session="new-project" />);
        });
        await act(async () => {
            finish!({ skill: { skillId: "old-project-upload", skillName: "late.zip", isAdded: true, isPrivate: true } as Skill });
        });
        expect(changes).toEqual([]);
        expect(selected).toEqual(["existing-skill"]);
        expect(host.textContent).toContain("已选择 1 个 Skills");
        expect(successes).toEqual([]);
    });
    test("上传期间切换账号，即使旧组件尚未卸载也不回写或继续旧账号操作", async () => {
        let finish: ((result: { skill: Skill }) => void) | undefined;
        spyOn(skills, "installSkillUpload").mockImplementation((input) => {
            uploads.push(input);
            return new Promise((resolve) => {
                finish = resolve;
            });
        });
        await render();
        await choose(new File(["skill"], "owner.md"));
        setActiveUserScope("another-account");
        await act(async () => {
            finish!({ skill: { skillId: "owner-upload", skillName: "owner.md", isAdded: true, isPrivate: true } as Skill });
        });
        expect(changes).toEqual([]);
        expect(successes).toEqual([]);
        await choose(new File(["new skill"], "stale-component.md"));
        expect(uploads).toHaveLength(1);
    });
    test("上传期间选满八个技能，保留已有选择且只报告上传到个人库", async () => {
        let finish: ((result: { skill: Skill }) => void) | undefined;
        spyOn(skills, "installSkillUpload").mockImplementation((input) => {
            uploads.push(input);
            return new Promise((resolve) => {
                finish = resolve;
            });
        });
        await render();
        const current = Array.from({ length: 7 }, (_, index) => `selected-${index}`);
        const onChange = (ids: string[]) => {
            changes.push(ids);
        };
        await act(async () => {
            root!.render(<EcommerceSkillPicker selected={current} onChange={onChange} />);
        });
        await choose(new File(["skill"], "ninth.md"));
        await act(async () => {
            root!.render(<EcommerceSkillPicker selected={[...current, "eighth"]} onChange={onChange} />);
        });
        await act(async () => {
            finish!({ skill: { skillId: "ninth", skillName: "ninth.md", isAdded: true, isPrivate: true } as Skill });
        });
        expect(changes).toEqual([]);
        expect(successes).toEqual(["Skill 已保存到个人库，本轮已选满，请取消一个后再选择"]);
        expect(host.textContent).toContain("已选择 8 个 Skills");
    });
});
