import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseContributors } from "../src/pages/welcome/contributors-parse";

const identityAvatar = (path: string) => path;

test("welcome contributors parse the README HTML table", () => {
    const readme = readFileSync(resolve(import.meta.dir, "../../README.md"), "utf8");
    const people = parseContributors(readme, identityAvatar);

    expect(people.length).toBeGreaterThanOrEqual(20);
    expect(people[0]).toMatchObject({
        name: "ddCat",
        avatar: "assets/user-ddcat.jpg",
        email: "ddcat666@126.com",
        wechat: "ddcat0829",
        isFounder: true,
    });
    expect(people[0]?.signature).toContain("没有任何黑魔法");
    expect(people.some((person) => person.name === "爱笑的毛毛虫")).toBe(true);
    expect(people.some((person) => person.name === "morrow" && person.email === "3201190041@qq.com" && person.signature === "最难不过坚持")).toBe(true);
    expect(people.filter((person) => person.isFounder)).toHaveLength(1);
});

test("welcome contributors still parse markdown pipe tables", () => {
    const markdown = `## 贡献者与团队

| 头像 | 昵称 | 邮箱 | 签名 |
| --- | --- | --- | --- |
| <img src="assets/user-ddcat.jpg" alt="ddCat"> | ddCat<br>项目发起者 · 微信：ddcat0829 | founder@example.com | 把故事搬上银幕 |
| <img src="assets/user-ken.jpg" alt="ken"> | ken | ken@example.com | 走自己的路 |

## 下一章
`;
    expect(parseContributors(markdown, identityAvatar)).toEqual([
        {
            name: "ddCat",
            avatar: "assets/user-ddcat.jpg",
            signature: "把故事搬上银幕",
            email: "founder@example.com",
            wechat: "ddcat0829",
            isFounder: true,
        },
        {
            name: "ken",
            avatar: "assets/user-ken.jpg",
            signature: "走自己的路",
            email: "ken@example.com",
            wechat: undefined,
            isFounder: false,
        },
    ]);
});
