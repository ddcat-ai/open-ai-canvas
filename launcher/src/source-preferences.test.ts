import { expect, test } from "bun:test";
import { setMirrorEnabled } from "./source-preferences";
import type { Config } from "./bridge";
const config: Config = {sourceMode:"auto", officialUrl:"https://official.example/releases/", mirrorUrl:"https://mirror.example/releases/", port:37890, openBrowser:true};
test("关闭镜像严格使用官方源，保留地址但不改变原配置", () => {
  const result = setMirrorEnabled(config, false);
  expect(result.sourceMode).toBe("official");
  expect(result.mirrorUrl).toBe(config.mirrorUrl);
  expect(result.officialUrl).toBe(config.officialUrl);
  expect(config.sourceMode).toBe("auto");
});
test("主动开启镜像默认仅走镜像，不暗中回退到 GitHub", () => {
  expect(setMirrorEnabled({...config,sourceMode:"official"},true).sourceMode).toBe("mirror");
});
