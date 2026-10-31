import { test, expect } from "bun:test";
import { validateConfig, errorText, defaultAutoUpdate, publicMirrors, type Config } from "./bridge";
const config: Config = { sourceMode:"official", officialUrl:"https://github.com/ddcat-ai/open-ai-canvas", mirrorUrl:null, port:37890, openBrowser:true, autoUpdate: defaultAutoUpdate };
test("自动更新的时间与间隔必须有效", () => { for (const autoUpdate of [{...defaultAutoUpdate,time:"3:00"},{...defaultAutoUpdate,time:"24:00"},{...defaultAutoUpdate,time:"03:60"},{...defaultAutoUpdate,intervalHours:0},{...defaultAutoUpdate,intervalHours:169},{...defaultAutoUpdate,intervalHours:1.5}]) expect(validateConfig({...config,autoUpdate})).not.toBeNull(); expect(validateConfig({...config,autoUpdate:{...defaultAutoUpdate,enabled:true,time:"23:59",intervalHours:168}})).toBeNull(); });
test("端口必须为非特权有效整数", () => { for (const port of [0,80,65536,3000.5,NaN]) expect(validateConfig({...config,port})).not.toBeNull(); expect(validateConfig(config)).toBeNull(); });
test("公共仓库无需公钥、账号或手工填写下载源", () => { expect(validateConfig({...config,officialUrl:null})).toBeNull(); expect(validateConfig(config)).toBeNull(); });
test("公共镜像只接受已支持的 HTTPS 前缀", () => { for (const mirrorUrl of ["http://ghproxy.net/","https://user:pass@ghproxy.net/","https://ghproxy.net/?token=secret","https://unknown.example/"]) expect(validateConfig({...config,mirrorUrl})).not.toBeNull(); for (const mirrorUrl of publicMirrors.map((host) => `https://${host}/`)) expect(validateConfig({...config,mirrorUrl})).toBeNull(); });
test("不接受另一仓库冒充当前上游", () => expect(validateConfig({...config,officialUrl:"https://github.com/other/repo"})).not.toBeNull());
test("错误保留实际原因", () => expect(errorText(new Error("没有本平台运行包"))).toBe("没有本平台运行包"));
