# 火山方舟原生图片接口

## 接口与鉴权

POST https://ark.cn-beijing.volces.com/api/v3/images/generations，使用 Bearer API Key。

## Seedream 5.5

模型 ID：doubao-seedream-5-5-261028。普通生成每次输出一张，最多 10 张参考图；不支持组图和流式输出。尺寸支持 1K、1.5K、2K 或合法像素尺寸。项目的比例与分辨率选择先由宿主按保存的预设转换成像素尺寸。

开启 layerDecomposition 后，仅输入一张图；maxImages 为最多输出数量（2–100，包含底图），layerSize 为拆层尺寸（1K、1.5K、2K、auto）。textRecognition 控制文字识别。拆层时不发送 background；普通生成的 background 支持 auto、opaque、transparent，透明背景应选择 PNG。outputFormat 支持 png、jpeg。

## 响应与计费

保留 usage.input_images、usage.generated_images 和每个 data[].size；图层的 z_index、bounding_box、name、description、text_recognition 保存在结果元数据中。计费由宿主的图片用量规则完成，按每张输出的实际像素匹配档位。

官方公开按量价：输入 0.05 元/张；输出不超过 2.61M 像素为 0.13 元/张，超过 2.61M 且不超过 4.63M 为 0.23 元/张。图片生成 API 的输出像素范围为 921600–4624220。失败输入费等未明确规则需通过官方账单核对。

## 官方资料

- [官方模型价格](https://console.volcengine.com/ark/region:cn-beijing/docs/model-pricing)
- [图片生成 API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh)

## Manifest 完整接口定义

<!-- YINGCE_MANIFEST_CONTRACT_START -->

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "volcengine-ark-seedream",
  "name": "Volcengine Ark Seedream Images",
  "version": "2.1.0",
  "author": "Volcengine / 影策",
  "description": "Volcengine Ark Seedream Images 独立请求协议插件。",
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "volcengine-ark-image",
        "label": "Volcengine Ark Seedream Images",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://ark.cn-beijing.volces.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "图片模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "图片提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "provider image/reference fields",
            "description": "参考图或编辑源图，role 由业务层确定。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "n/sample_count",
            "description": "输出数量。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "size/aspect_ratio",
            "description": "比例或尺寸，语义按协议说明。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution/imageSize",
            "description": "分辨率档位。"
          },
          {
            "name": "quality",
            "type": "string",
            "required": false,
            "mapping": "quality",
            "description": "质量档位。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "插件命名空间内的厂商扩展字段。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/api/v3/images/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "size": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.volcengine-ark-image.layer_decomposition"
                    },
                    true
                  ]
                },
                "then": {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.volcengine-ark-image.layer_size"
                    },
                    "auto"
                  ]
                },
                "else": {
                  "$omitEmpty": {
                    "$switch": {
                      "cases": [
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "request.aspectRatio"
                              },
                              "auto"
                            ]
                          },
                          "then": "2k"
                        },
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "request.aspectRatio"
                              },
                              "1:1"
                            ]
                          },
                          "then": "2048x2048"
                        },
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "request.aspectRatio"
                              },
                              "4:3"
                            ]
                          },
                          "then": "2304x1728"
                        },
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "request.aspectRatio"
                              },
                              "3:4"
                            ]
                          },
                          "then": "1728x2304"
                        },
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "request.aspectRatio"
                              },
                              "16:9"
                            ]
                          },
                          "then": "2560x1440"
                        },
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "request.aspectRatio"
                              },
                              "9:16"
                            ]
                          },
                          "then": "1440x2560"
                        },
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "request.aspectRatio"
                              },
                              "3:2"
                            ]
                          },
                          "then": "2496x1664"
                        },
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "request.aspectRatio"
                              },
                              "2:3"
                            ]
                          },
                          "then": "1664x2496"
                        },
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "request.aspectRatio"
                              },
                              "21:9"
                            ]
                          },
                          "then": "3024x1296"
                        }
                      ],
                      "default": {
                        "$ref": "request.aspectRatio"
                      }
                    }
                  }
                }
              }
            },
            "image": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$len": {
                          "$ref": "request.images"
                        }
                      },
                      1
                    ]
                  },
                  "then": {
                    "$first": {
                      "$map": {
                        "from": {
                          "$ref": "request.images"
                        },
                        "as": "media",
                        "in": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  },
                  "else": {
                    "$if": {
                      "condition": {
                        "$gt": [
                          {
                            "$len": {
                              "$ref": "request.images"
                            }
                          },
                          1
                        ]
                      },
                      "then": {
                        "$map": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "in": {
                            "$ref": "media.value"
                          }
                        }
                      },
                      "else": null
                    }
                  }
                }
              }
            },
            "sequential_image_generation": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-image.sequential_image_generation"
              }
            },
            "sequential_image_generation_options": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-image.sequential_image_generation_options"
              }
            },
            "watermark": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.volcengine-ark-image.watermark"
                },
                {
                  "$ref": "request.watermark"
                },
                false
              ]
            },
            "seed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-image.seed"
              }
            },
            "response_format": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.volcengine-ark-image.response_format"
                },
                "b64_json"
              ]
            },
            "layer_decomposition": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-image.layer_decomposition"
              }
            },
            "layer_decomposition_options": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$ref": "request.providerOptions.volcengine-ark-image.layer_decomposition"
                      },
                      true
                    ]
                  },
                  "then": {
                    "max_images": {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.volcengine-ark-image.max_images"
                        },
                        30
                      ]
                    },
                    "text_recognition": {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.volcengine-ark-image.text_recognition"
                        },
                        false
                      ]
                    }
                  },
                  "else": null
                }
              }
            },
            "background": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$ref": "request.providerOptions.volcengine-ark-image.layer_decomposition"
                      },
                      true
                    ]
                  },
                  "then": null,
                  "else": {
                    "$ref": "request.providerOptions.volcengine-ark-image.background"
                  }
                }
              }
            },
            "output_format": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-image.output_format"
              }
            }
          }
        },
        "response": {
          "status": "succeeded",
          "images": {
            "$ref": "response.data"
          },
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error.code"
          ],
          "messagePaths": [
            "error.message"
          ]
        },
        "imageParameters": [
          {
            "name": "size",
            "label": "画幅 / 尺寸",
            "type": "string",
            "pricing": true,
            "binding": "aspectRatio",
            "encoding": "pixels",
            "models": [
              "doubao-seedream-5-5-261028"
            ]
          },
          {
            "name": "imageResolution",
            "label": "分辨率",
            "type": "string",
            "values": [
              "1k",
              "1.5k",
              "2k"
            ],
            "default": "2k",
            "pricing": true,
            "binding": "resolution",
            "models": [
              "doubao-seedream-5-5-261028"
            ]
          },
          {
            "name": "layerDecomposition",
            "label": "图层拆分",
            "type": "boolean",
            "default": false,
            "pricing": true,
            "binding": "providerOptions.volcengine-ark-image.layer_decomposition",
            "models": [
              "doubao-seedream-5-5-261028"
            ]
          },
          {
            "name": "maxImages",
            "label": "最多输出张数（含底图）",
            "type": "integer",
            "min": 2,
            "max": 100,
            "step": 1,
            "default": 30,
            "binding": "providerOptions.volcengine-ark-image.max_images",
            "models": [
              "doubao-seedream-5-5-261028"
            ]
          },
          {
            "name": "layerSize",
            "label": "拆层输出尺寸",
            "type": "string",
            "values": [
              "1K",
              "1.5K",
              "2K",
              "auto"
            ],
            "default": "auto",
            "binding": "providerOptions.volcengine-ark-image.layer_size",
            "models": [
              "doubao-seedream-5-5-261028"
            ]
          },
          {
            "name": "background",
            "label": "图片背景",
            "type": "string",
            "values": [
              "auto",
              "opaque",
              "transparent"
            ],
            "default": "auto",
            "binding": "providerOptions.volcengine-ark-image.background",
            "models": [
              "doubao-seedream-5-5-261028"
            ]
          },
          {
            "name": "outputFormat",
            "label": "输出格式",
            "type": "string",
            "values": [
              "png",
              "jpeg"
            ],
            "default": "png",
            "binding": "providerOptions.volcengine-ark-image.output_format",
            "models": [
              "doubao-seedream-5-5-261028"
            ]
          },
          {
            "name": "textRecognition",
            "label": "拆层时识别文字",
            "type": "boolean",
            "default": false,
            "binding": "providerOptions.volcengine-ark-image.text_recognition",
            "models": [
              "doubao-seedream-5-5-261028"
            ]
          }
        ]
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
