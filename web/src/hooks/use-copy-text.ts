import { App } from "antd";
import copy from "copy-to-clipboard";
import { useTranslation } from "react-i18next";

export function useCopyText() {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();

    return (value: string, successText = t("domain:copied")) => {
        copy(value);
        message.success(successText);
    };
}
