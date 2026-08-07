import { describe, expect, test } from "bun:test";
import { parseCharacterBreakdown } from "../src/lib/canvas/canvas-character-reference";

describe("parseCharacterBreakdown", () => {
    test("忽略推理文字中的 JSON 碎片，读取最终角色契约对象", () => {
        const result = `让我先分析正文。\n\naliases: []（正文未提供别名）\n\n最终结果：\n\n\`\`\`json
{
  "characters": [
    {
      "name": "林夏",
      "aliases": [],
      "role": "女主角，26岁，加班晚归的都市上班族",
      "appearance": "26岁东亚女性，面带疲态",
      "clothing": "米色风衣，背深色帆布工作包",
      "physique": "年轻女性常规体态",
      "personality": "善良内敛，观察力强",
      "props": "深色帆布工作包，磁吸小夜灯",
      "consistencyPrompt": "26岁东亚女性，米色风衣，深色帆布工作包",
      "multiViewPrompt": "正面、侧面、背面保持风衣和帆布包一致",
      "voiceLanguage": "中文普通话",
      "voiceAge": "26岁青年女性",
      "voiceTimbre": "温和、略带疲惫感"
    },
    {
      "name": "吴奶奶",
      "aliases": [],
      "role": "林夏的对门邻居，七十岁出头老人",
      "appearance": "七十岁出头东亚老年女性，银灰短发",
      "clothing": "深绿色针织开衫",
      "physique": "老年女性体态",
      "personality": "独立谨慎，感恩含蓄",
      "props": "米色布袋和钥匙",
      "consistencyPrompt": "银灰短发，深绿色针织开衫，米色布袋",
      "multiViewPrompt": "正面、侧面、背面保持短发和开衫一致",
      "voiceLanguage": "中文普通话",
      "voiceAge": "七十岁出头老年女性",
      "voiceTimbre": "语速偏慢的老年女性声线"
    }
  ]
}
\`\`\``;

        expect(parseCharacterBreakdown(result).map((character) => character.name)).toEqual(["林夏", "吴奶奶"]);
    });
});
