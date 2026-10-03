# 电商智能创作 接口说明

## 插件身份

- `id`: `igo-studio-ecommerce-agent`
- 显示名称：`电商智能创作`
- 类型：官方应用插件，按用户启停
- 入口贡献：`contributes.smartCreation.entry = smart-creation`
- 策略来源：`contributes.smartCreation.planner`、`defaults`、`execution`
- AI 能力：`smart-creation`、`amazon-set-planner`、`amazon-style-lock`
- 权限：`ai.text`、`generation.run`、`media.read`、`asset.read`

官方包由宿主在启动时扫描 `plugin-packages/*.yingce-plugin` 并同步到运行时。开发环境可设置 `CANVAS_OFFICIAL_PLUGIN_DIR` 指向包目录；包更新后重启宿主即可生效。浏览器上传不是这条官方包加载路径。

## 创作入口合同

插件向创作页现有 Composer 贡献一个“智能创作”模式按钮。现有“AI 提示词优化”按钮和能力保持不变；两个插件同时启用时，输入框旁显示两个按钮。智能创作使用同一个 Composer 输入框、对话历史和结果渲染，不创建第二个对话框。只有 电商智能创作 启用时才显示智能创作按钮。

智能创作打开后，Composer 的分辨率、宽高比、质量和生成数量选项不参与请求。Agent 返回的计划是唯一参数来源；模型路由仍由宿主当前创作配置提供。关闭智能创作后，Composer 恢复原有参数行为。

## Agent 请求与计划

Agent 通过宿主 `ai.text` 服务请求结构化工具 `create_smart_creation_plan`。请求上下文包括：

- 当前对话、最近一次已确认的智能创作计划和用户最新消息；
- 生成模式、宿主模型和协议上下文；
- 用户添加的参考素材（带角色说明的多模态图片输入）。

返回对象只要求 `planVersion`、`intent` 和 `tasks`；`targetPlatform`、`targetMarket`、`targetLanguage`、`visualDirection`、`styleBible`、`platformRules`、`assumptions`、`questions` 和任务 `settings` 均可缺省，由插件 manifest 的 `defaults` 补齐。`visualDirection` 是整套复用的高级商业摄影指导；`styleBible` 是结构化风格锁，包含统一色彩、光线、镜头、构图、材质、必须保留项和负面约束，宿主会把它编译进每张图片提示词。`questions` 只用于真正阻塞生成的一个关键问题，`assumptions` 仅记录 Agent 已采用的默认，不得被宿主展示成确认问卷。每个任务包含 `itemId`、`purpose`、`title`、`prompt`，可选 `referenceIds`、`compliance` 与 `settings`（`model`、`size`、`aspectRatio`、`quality`、`count`）。Amazon 多张附图必须按用途拆成独立任务，每个任务默认 `count: 1`；只有用户明确要求同一用途的重复变体时才使用大于 1 的 `count`，宿主会将每个计划数量展开成独立图片请求并归入同一个套图聚合消息。

Agent 应遵循以下规则：

1. 先理解用户意图，再决定任务数量和图片用途；已有提示词或参考图时使用合理默认值直接规划，只有无法推断且会影响结果的关键歧义才追问，每轮最多一个问题。
2. 用户明确给出的市场、语言、卖点、尺寸或风格写入计划，不被默认模板覆盖。
3. Amazon 计划自动纳入目标站点的语言、主图与卖点图约束，并为每个任务选择可解释的尺寸和比例；用户说不要白底时不创建白底主图或纯白背景附图。
4. 事实、功效、认证、对比结论和商品参数必须来自用户输入或参考素材，不得臆造。
5. 计划解析或模型请求失败时返回错误并保留对话，不静默降级为固定提示词或固定张数。

计划确认后会写入当前会话消息的 `agentPlan`，并以 `smart_creation`（显示名“智能创作”）同步到后台 Agent 记忆；后续轮次优先使用这份计划，不要求用户重复输入全部需求。

用户确认计划后，宿主为每个计划任务一次性提交独立生成请求，把计划版本、站点、市场、语言、视觉指导、风格指纹和任务设置写入任务元数据。每次调用 `runBackendGenerationTaskBatch` 时数量为 1；并发窗口由 manifest 的 `execution.maxConcurrency` 和账号 `activeTaskLimit` 共同限制。暂时达到账号活动任务上限时，宿主等待空位并重试，等待超过 `capacityWaitMs` 才把该张计为失败。结果按完成顺序写入同一个套图聚合消息，只有完成数加失败数达到总数时批次才结束；界面显示堆叠缩略图并支持展开完整图库。普通 Composer 的多图请求同样使用聚合预览，任务状态、重试和资源持久化沿用宿主现有运行时。

## 卸载边界

卸载插件只移除 `igo-studio` 命名空间和入口状态；已生成资产、任务、历史对话以及提示词优化插件的数据由宿主保留。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "igo-studio-ecommerce-agent",
  "name": "电商智能创作",
  "version": "0.2.0",
  "author": "iGO Studio",
  "description": "创作输入框里的对话式智能创作 Agent，支持 Amazon 套图规划。",
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
  "permissions": [
    "ai.text",
    "generation.run",
    "media.read",
    "asset.read"
  ],
  "contributes": {
    "aiCapabilities": [
      "smart-creation",
      "amazon-set-planner",
      "amazon-style-lock"
    ],
    "smartCreation": {
      "entry": "smart-creation",
      "label": "智能创作",
      "planner": {
        "systemPrompt": [
          "你是电商智能创作 Agent。你要理解用户想创作什么，而不是把输入机械改写成一段提示词。",
          "参考图默认是 reference image，用来锁定主体的可见外观、风格或构图；只有用户明确要求修改原图时才当作 edit target。按 imagegen 的简洁提示词规范把场景/背景、主体、关键细节、风格、构图、光线和约束整理进 task.prompt，只填写有用字段，不把它们变成向用户索取的参数表。",
          "完整读取 conversation，之前的用户要求、参考图、Agent 计划和用户回答都视为当前上下文；已经确定的内容不得重复询问。用户说‘确定’‘按默认’‘直接生成’或‘不要管细节’代表接受当前默认并立即执行，questions 必须为空。只有一个关键事实缺失且确实会改变主体或交付时，才在 questions 中提出一个简短问题；尺寸、画幅、质量、数量、场景、材质、颜色、容量、Logo、认证和平台规则都由 Agent/宿主默认或从参考图推断，不得为填字段而提问。",
          "Amazon 未指定站点时默认美国站 en-US；英国站用 en-GB，德国站用 de-DE。只说‘产品主图’默认一个 hero 任务；明确说套图、全套、多张、附图或列出多个用途时，必须按用户要求的张数拆成同数量的独立 tasks，每个 task 对应一个卖点、场景或细节，并为每张写不同的构图与风格提示词，settings.count 设为 1。只有用户明确要求同一用途的重复变体时，才允许用一个 task 的 count 表示数量。用户说‘不要白底图’或‘不要白色背景’时，不要创建白底 hero 主图，也不要在任何 task.prompt 中加入纯白背景；改为规划生活方式、场景、细节或信息表达的附图。不要编造产品事实、功效、认证、容量、品牌或文案。",
          "Amazon 套图必须追求高级橱窗图和商业产品摄影质感，而不是普通生活方式快照。先为整套输出一条 visualDirection，锁定产品身份、外观比例、材质、颜色、受控主光与轮廓光、镜头语言、场景陈列、留白和高级色彩关系；每个 task.prompt 都要复用这条指导并补充本张的卖点构图。使用精致棚拍布光、真实材质细节、柔和阴影、克制道具、清晰视觉层级和高端品牌广告审美，让每张图像像经过艺术指导的 Amazon showroom campaign；避免廉价库存图、杂乱桌面、随手拍构图、过度道具、塑料感和不一致的产品外观。需要文字时只写用户提供的事实，文字排版简洁克制，不用无法保证准确的长文案。",
          "同一批次多于一张图时，必须同时输出 styleBible：globalPrompt 概括整套统一视觉，palette、lighting、camera、composition、material 写成可复用的具体描述，preserve 列出不可变化的产品特征，avoid 与 negativePrompt 写出需要排除的元素；宿主会把 styleBible 编译进每张图，所以 task.prompt 只写本张的差异化卖点、场景和构图，不要重复整套风格描述。",
          "只通过 create_smart_creation_plan 返回 JSON。planVersion、intent、tasks 是唯一必填字段；targetPlatform、targetMarket、targetLanguage、visualDirection、platformRules、assumptions、questions、settings 和 compliance 都是可选的内部计划信息，缺省由宿主补齐。",
          "只通过 create_smart_creation_plan 返回 JSON，不要输出 Markdown 或额外解释。"
        ],
        "tool": {
          "name": "create_smart_creation_plan",
          "description": "理解用户创作意图并返回最小可执行的结构化图片生成计划；非必要参数由 Agent 和宿主默认，不向用户索取表单字段。",
          "parameters": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "planVersion",
              "intent",
              "tasks"
            ],
            "properties": {
              "planVersion": {
                "type": "string",
                "enum": [
                  "1"
                ]
              },
              "intent": {
                "type": "string"
              },
              "targetPlatform": {
                "type": "string",
                "enum": [
                  "amazon",
                  "generic"
                ]
              },
              "targetMarket": {
                "type": "string",
                "enum": [
                  "US",
                  "UK",
                  "DE",
                  "UNKNOWN"
                ]
              },
              "targetLanguage": {
                "type": "string"
              },
              "visualDirection": {
                "type": "string",
                "description": "套图级视觉指导：高级商业摄影、产品身份锁定、灯光、材质、构图和统一色彩。"
              },
              "styleBible": {
                "type": "object",
                "additionalProperties": false,
                "description": "多张图时必须给出的结构化风格锁；宿主会把它编译进每张图的提示词，保证同一批次色彩、光线、镜头、材质与产品外观一致。",
                "required": [
                  "globalPrompt"
                ],
                "properties": {
                  "summary": {
                    "type": "string"
                  },
                  "globalPrompt": {
                    "type": "string",
                    "description": "整套图共享的视觉总述。"
                  },
                  "negativePrompt": {
                    "type": "string"
                  },
                  "palette": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  },
                  "lighting": {
                    "type": "string"
                  },
                  "camera": {
                    "type": "string"
                  },
                  "composition": {
                    "type": "string"
                  },
                  "material": {
                    "type": "string"
                  },
                  "preserve": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "description": "不可变化的产品特征。"
                  },
                  "avoid": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                }
              },
              "platformRules": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "assumptions": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "description": "Agent 已采用的默认，不是向用户提出的问题。"
              },
              "questions": {
                "type": "array",
                "maxItems": 1,
                "items": {
                  "type": "string"
                },
                "description": "仅在关键事实缺失且阻塞生成时提出一个最小问题。"
              },
              "tasks": {
                "type": "array",
                "minItems": 1,
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "itemId",
                    "purpose",
                    "title",
                    "prompt"
                  ],
                  "properties": {
                    "itemId": {
                      "type": "string"
                    },
                    "purpose": {
                      "type": "string",
                      "enum": [
                        "hero",
                        "bullet",
                        "scene",
                        "detail",
                        "text",
                        "custom"
                      ]
                    },
                    "title": {
                      "type": "string"
                    },
                    "prompt": {
                      "type": "string"
                    },
                    "targetLanguage": {
                      "type": "string"
                    },
                    "referenceIds": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "compliance": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "settings": {
                      "type": "object",
                      "additionalProperties": false,
                      "properties": {
                        "model": {
                          "type": "string"
                        },
                        "size": {
                          "type": "string"
                        },
                        "aspectRatio": {
                          "type": "string"
                        },
                        "quality": {
                          "type": "string"
                        },
                        "count": {
                          "type": "integer",
                          "minimum": 1
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "defaults": {
        "taskSettings": {
          "size": "auto",
          "aspectRatio": "1:1",
          "quality": "auto"
        },
        "platforms": {
          "amazon": {
            "market": "US",
            "visualDirection": "高级商业产品摄影与品牌橱窗陈列；保持产品身份、外观比例、材质和颜色一致；使用受控的主光、轮廓光和柔和阴影，精致材质纹理、克制道具、明确视觉层级、留白和高级色彩关系；每张图像像经过艺术指导的 Amazon showroom campaign，而不是普通生活方式快照、杂乱桌面或廉价库存图",
            "platformRules": [
              "明确要求主图时才使用纯白背景；用户要求不要白底时，所有附图都不得使用纯白背景",
              "卖点图只使用参考素材或用户明确提供的事实",
              "平台目标尺寸必须先与当前图片模型能力归一化"
            ]
          }
        }
      },
      "execution": {
        "maxTasks": 12,
        "maxConcurrency": 4,
        "anchorFirst": false,
        "capacityWaitMs": 600000
      }
    }
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
