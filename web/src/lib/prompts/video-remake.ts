type RemakeImageReference = { label: string; role?: "character" | "environment" | "prop" | "style" };

export function buildVideoRemakePrompt(images: readonly RemakeImageReference[], shotNotes: readonly string[]) {
    const lead = images.findIndex((image) => image.role === "character");
    const defaultSubject = lead < 0 ? images.findIndex((image) => !image.role) : -1;
    const bindings = images.map(({ label, role }, index) => {
        let direction: string;
        if (role === "environment") direction = "只替换布景和空间材质。把原片的行进路线、出入口和前后景遮挡落实到新场景，人物沿原路线行动。";
        else if (role === "prop") direction = "替换对应的道具或展示产品。各镜保持轮廓、部件比例和可见标识的位置。握持或转动时，让手指贴合新外形，接触阴影跟随移动。";
        else if (role === "style") direction = "只取画风、色彩和表面质感，人物、姿势与取景按各自素材分工。";
        else if (index === lead) direction = "替换承担主要动作的角色。每次出镜都保留此图的脸部特征、发型、服饰和身形，承接原角色的站位、视线和表演，其余人物保留各自身份。";
        else if (role === "character") direction = "只约束对应出镜角色的外观。若是同一人的另一视角，用它补足侧面或背面，维持原片的出镜人数。";
        else if (index === defaultSubject) direction = "替换原片的主要展示对象，贯穿其每次出镜。人物认五官、发型与服饰，动物认体态、毛色与花纹，产品认轮廓、部件与材质。换角度只改变可见面，颜色和标识始终属于同一个对象。背景与姿势取自原片。";
        else direction = "同一主体的另一视角用于补足可见细节。若图中是另一元素，只在原片拍到它的镜头中使用。";
        return `${label} ${direction}`;
    });
    return [
        ["【素材分工】按 @视频1 重拍同一段内容。动作发生的顺序、摄影机的位置和剪辑均以原片为准。下列图片分别指定要替换的元素，在这些元素出现的每一镜采用对应图片的外观。", ...bindings].join("\n"),
        ...(shotNotes.length ? [["【原片镜头笔记】时间码均对应原片。按镜中实际发生的动作衔接，人物和道具外观按上方图片分工。", ...shotNotes].join("\n")] : []),
        "【剪辑】从原片第一帧的动作状态进入，在原片最后一帧对应的动作阶段收尾。一镜到底就保持连续，主体经过遮挡后继续运动。多镜头沿用原有镜序、每镜长短和转场方式。若原片在抬手途中切近景，下一镜从抬到一半的手接起。输出时长有变化时，按比例移动切点，保留停顿和动作重音。",
        "【摄影机】每镜对齐起幅与落幅的景别、视角、主体占幅和入出画方向。固定机位拍主体走近时，机位保持固定，让主体走近镜头。若原片跟拍，保留跟拍方向、速度变化、背景视差和焦点落点。换画幅时优先把关键动作和接触点留在画内。",
        "【动作接续】按原片的起势、接触和收势完成动作。新主体按自身结构完成同一意图，刚性部件围绕实际转轴运动，承重的脚落稳后再换重心。遮挡结束或切回时，承接当时的朝向、持物手和道具位置。",
        "【现场与交付】让新主体受现场光照，投影落在接触面上，旋转时高光随材质和角度移动。保留参考物本身的标识，排除原片叠加的字幕、水印、贴纸和界面文字。启用声音时，脚步和物体接触声落在动作发生的那一拍，原片静音处留静。",
    ].join("\n\n");
}
