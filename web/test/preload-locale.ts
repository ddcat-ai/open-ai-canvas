// 测试断言按简体中文源文案编写；happy-dom 的 navigator 默认是英文，首次访问会按浏览器语言选成 en-US。
// 这里在任何测试模块加载前把界面语言固定为 zh-CN；需要验证其他语言的测试自行调用 setLocale。
import { useLocaleStore } from "@/stores/use-locale-store";

useLocaleStore.setState({ locale: "zh-CN" });
