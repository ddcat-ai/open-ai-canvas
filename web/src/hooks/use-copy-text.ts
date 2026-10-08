import copy from "copy-to-clipboard";
import { App } from "antd";

const COPIED_HINT = "已复制";

export function useCopyText() {
    const feedback = App.useApp().message;
    return (value: string, successText = COPIED_HINT) => {
        copy(String(value));
        feedback.success(successText);
    };
}
