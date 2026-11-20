// 加载 src/themes/ 下的全部主题包：每个主题文件夹的 index.ts 登记自己并引入样式。
// 新增主题只需放进一个文件夹，不用改这里。只在网页入口引入（测试里直接引入具体主题包）。
import.meta.glob("./*/index.ts", { eager: true });
