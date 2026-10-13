# 影视剧作工坊 · 本地可选脚本说明

## 适用范围

本目录的 `.py` 文件是随下载包提供的可选本地工具，需要用户自己的 Python 3.8+ 环境（仅标准库依赖）。它们不属于小影 Agent 的可执行工具；Agent 不能运行这些文件。若 Agent 使用了脚本所对应的规则，应改为读取本包 Markdown 并人工逐项核对，不得声称脚本或回归测试已通过。

下载包用户可以在自己的环境中按各脚本的参数说明执行工具。脚本结果只说明该本地运行的输入和环境，不会自动传回小影。

## 工具范围

- `chain.py`、`wfkit/cli.py`：路由、提示词拼装、字段校验、分镜规划、交付与合规等命令行入口。
- `wfkit/axis.py`、`style.py`、`render.py`、`scene.py`、`frame.py`、`performance.py`：识别、风格、渲染、场景、单帧和表演辅助校验。
- `wfkit/lens.py`、`shotlist.py`、`moves.py`、`audio.py`、`shots.py`、`review.py`：焦距、分镜、运镜、声音、组接与返修辅助校验。
- `wfkit/delivery.py`、`compliance.py`、`jimeng_t2i.py`：提示词交付拼装及规则检查。
- `wfkit/assets.py`、`integrity.py`、`provenance.py`、`stress.py`：包内资产读取、完整性检查、来源检索和本地压力测试。
- 故事板子目录另含校验、渲染、分段、回归、风格及一致性辅助脚本。
- `影视剧作工坊-07-分镜头设计/storyboard/analyze_source.py` 与 `estimate_timeline.py`：本地文本统计和时长估算辅助工具。

全包共有 31 个可执行 Python 文件，另有 `wfkit/__init__.py` 包初始化文件；初始化文件不计作可执行脚本。`PKG_VERSION.json` 中的 `machine_scripts: 31` 按此口径统计。

## 来源检索配置

`sources.json` 默认不包含作者机器路径。下载包用户可在本机设置自己有权读取的来源目录，或使用工具支持的临时根目录参数。内置技能不携带这些源文件，也不会写回源目录。

## 小影 Agent 的替代流程

1. 使用 `skill_read_file` 读取当前阶段对应的 Markdown 规则、Schema、模板和质量清单。
2. 按清单逐项比对当前文本或结构化产物，并标注人工核对的项目及证据。
3. 无法从可读内容核实的项目标记为未核对或受阻；不猜测脚本输出，不报告机器 PASS。
