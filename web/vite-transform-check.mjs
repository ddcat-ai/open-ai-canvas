import { createServer } from "vite";
const server = await createServer({ server: { middlewareMode: true }, logLevel: "error" });
try {
  const result = await server.transformRequest("/src/i18n/index.ts");
  const code = result.code;
  const stillHasGlobCall = /import\.meta\.glob\s*\(/.test(code);
  const hasLocaleInline = code.includes("admin.json") || code.includes("locales/zh-CN");
  console.log("transform 后是否仍含 import.meta.glob 调用:", stillHasGlobCall);
  console.log("transform 后是否内联了 locale:", hasLocaleInline);
  const idx = code.indexOf("loadViteLocaleModules");
  console.log("--- loadViteLocaleModules 转换后 ---");
  console.log(code.slice(idx, idx + 500));
} finally {
  await server.close();
}
