# 实时对话功能组件（第一阶段 MVP）
本目录实现第一阶段（MVP）：**本地语音录制 + 浏览器语音识别转写**。点击"实时对话"按钮 → 输入行内展开波形录制条 → 停止后自动转写为文字 → 文字填入输入框或直接发送。

## 零配置说明

第一阶段**不接入语音大模型、不依赖后端与 API Key**：录音完成后直接使用浏览器内置 Web Speech API（`SpeechRecognition`）识别，转写全程在前端完成。

- 支持的浏览器：Chrome / Edge（Chromium 内核）
- 不支持时录制条内会明确提示，并可取消
- 识别语言默认 `zh-CN`，见 `useSpeechRecognition` 的 `lang` 参数

---

## 组件列表

### 1. `VoiceRecordingButton` - 语音输入按钮

点击后输入行内展开波形录制条（不弹窗），自动开始录音；停止后自动转写并回调文本。使用局部状态，多个输入行可独立使用。

**使用示例：**
```tsx
import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";

<VoiceRecordingButton
  disabled={isBusy}
  onTranscribed={(text) => setPrompt((prev) => (prev.trim() ? `${prev} ${text}` : text))}
/>
```

### 2. `VoiceRecordingInline` - 内联波形录制条

输入行内展示的录制控件：波形动画 + 时长 + 停止/取消按钮；停止后自动转写，失败可重试。`VoiceRecordingButton` 默认使用本组件。

**使用示例：**
```tsx
import { VoiceRecordingInline } from "@/components/conversation/voice-recording-inline";

<VoiceRecordingInline
  onTranscribed={(text) => setPrompt((prev) => (prev.trim() ? `${prev} ${text}` : text))}
  onCancel={() => setOpen(false)}
/>
```

### 3. `AudioWaveform` - 音频波形可视化

SVG 波形可视化组件，支持实时数据更新。

---

## Hook

### `useVoiceRecording` - 语音录制 Hook

封装 MediaRecorder API 和 AnalyserNode，提供录制状态、波形数据、控制方法（供波形动画与时长展示）。

### `useSpeechRecognition` - 浏览器语音识别 Hook

封装 Web Speech API（`SpeechRecognition`/`webkitSpeechRecognition`），提供 `start()` / `stop(): Promise<string>` / `cancel()`，返回是否支持、识别错误。转写不依赖后端。

---

## 完整集成示例

```tsx
import { useState } from "react";
import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";

function ChatInput() {
  const [prompt, setPrompt] = useState("");

  const handleTranscribed = (text: string) => {
    // 转写结果填入输入框，用户确认后发送
    setPrompt((current) => (current.trim() ? `${current} ${text}` : text));
  };

  return (
    <div className="flex items-center gap-2">
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="输入消息..." />
      {/* 点击后输入行内展开波形录制条，停止后自动转写 */}
      <VoiceRecordingButton onTranscribed={handleTranscribed} />
      <button>发送</button>
    </div>
  );
}
```

## 接入位置

- 创建页主输入行：`web/src/pages/create/index.tsx`（`CreationComposer` 的 `creation-chat-controls`）
- 画布助手面板：`canvas-assistant-panel.tsx`、`canvas-local-agent-panel.tsx`（输入行 left 插槽）
- 测试页：`web/src/pages/test-voice-recording.tsx`

## 下一步
- [x] 内联波形录制（不弹窗），停止后自动转写
- [x] 移除第二阶段实验代码（WebSocket / Realtime API / 旧浮层组件）
- [x] 移除后端 STT 接口与数据库表（第一阶段不接入语音大模型）
- [ ] 语音播放功能（TTS）
- [ ] 语音消息发送和显示
- [ ] 多模态对话（图片、视频）
- [ ] 真正实时对话（WebSocket + WebRTC + Realtime API，后续阶段）
