import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelCapabilityEditor } from "../src/components/model-capability-editor";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";

test("后台文本模型引用配置分别说明图片数量零和大小零的含义", () => {
    const html = renderToStaticMarkup(<ModelCapabilityEditor capability="text" section="references" value={defaultModelCapabilityConfig()} />);
    expect(html).toContain("最大参考图片数为 0：不接收图片输入");
    expect(html).toContain("单张图片上限为 0 MB：不额外限制大小，仍受平台上传和读取安全上限约束");
    expect(html).toContain("最大参考图片数");
    expect(html).toContain("单张图片上限 MB");
});
