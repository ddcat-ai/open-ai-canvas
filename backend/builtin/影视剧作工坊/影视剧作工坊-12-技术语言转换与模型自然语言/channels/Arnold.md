---
name: 影视剧作工坊-12-通道-Arnold
description: Arnold 通道（离线渲染通道，按类目/画面对象划分子通道）技术词→画面语言映射表。本文件为数据，非独立技能，由模块 12 路由层调用。
agent_created: true
---
# Arnold 通道映射表（离线渲染通道 · 按类目划分子通道）

> 渲染模式：**离线渲染（Offline Rendering）**——Arnold 为离线/路径追踪渲染器，本通道即「离线渲染通道」。
> 通道识别词：Path Tracer、Standard Surface、Transmission、Caustics、Atmosphere Volume、离线渲染（输入出现即走 Arnold 通道）。
> 构建逻辑：本通道按画面对象/类目划分子通道，每个子通道收一类画面元素在所有渲染环节涉及的技术词；皮肤、眼睛、毛发等对象子通道从标准着色器中提取对应术语，目标画面一致即归入同一子通道。
> 用途：把下列 Arnold 技术词映射为即梦可直接执行的画面语言（视觉结果词）。技术词本身不进入提示词，只写画面看得见的。

## 光照
- **天空穹顶光（Skydome Light）**：来自半球形天空的光，模拟户外环境光，天空有自然的色彩渐变，环境光均匀柔和。
- **物理天空（Physical Sky）**：物理正确的太阳和天空，日光方向准确，天空有大气散射的渐变，地面有大气雾。
- **物理天空浑浊度（Physical Sky Turbidity）**：大气中有薄雾，阳光穿透大气时有暖色散射，远景有大气透视。
- **物理天空太阳方向（Physical Sky Solar Direction）**：太阳方向准确，光线有明确的方向性，地面阴影方向一致。
- **区域光（Area Light）**：面光源，光线柔和，阴影边缘有自然的羽化过渡，高光形状为矩形。
- **区域光形状矩形（Area Light Rectangle）**：矩形面光源，高光为矩形，光线方向明确。
- **区域光形状圆盘（Area Light Disk）**：圆形面光源，高光为圆形，光线柔和均匀。
- **区域光形状圆柱（Area Light Cylinder）**：圆柱形面光源，高光为长条形，适合模拟灯管。
- **区域光扩散（Area Light Spread）**：光线扩散角度控制，光锥边缘柔和，光线集中或分散。
- **点光源（Point Light）**：点光源，光线从单一位置向所有方向发射，物体有硬阴影和清晰的高光点。
- **聚光灯（Spot Light）**：聚光灯，光线呈锥形，光锥边缘有柔和过渡，物体有明确的光照方向。
- **聚光灯半影角（Spot Light Penumbra Angle）**：光锥边缘的柔化程度，笔触边缘柔和，过渡自然。
- **聚光灯锥角（Spot Light Cone Angle）**：光锥的张开角度，决定光照范围。
- **平行光（Distant Light）**：平行光，模拟太阳光，光线平行，阴影方向一致，没有透视衰减。
- **网格灯光（Mesh Light）**：使用几何体作为光源，能产生非常复杂和真实的光照与阴影形状，适合模拟霓虹灯、屏幕光、窗户透光。
- **网格灯光可见（Mesh Light Light Visible）**：光源物体自身可见，有发光效果，光线投射到周围环境。
- **光度学灯光（Photometric Light）**：使用IES文件，能精确模拟真实世界灯具的光照分布，适合模拟路灯、台灯。
- **灯光门户（Light Portal）**：室内场景中，光线通过窗户或门口进入，室内有来自开口的自然光照，暗部有柔和的间接光。
- **灯光衰减（Light Decay）**：光线随距离自然衰减，远近感真实，光线强度随距离递减。
- **灯光阻挡（Light Blocker）**：遮挡光源的某些部分，产生有形状的阴影。
- **图案投影（Gobo）**：投射图案到场景中，产生有形状的光斑和阴影。
- **挡光板（Barndoor）**：控制光线的照射范围，边缘有柔和的过渡。

## 标准表面着色器
物理基础着色器，可产生塑料、木材、石材等多种材质，包含漫反射层、镜面反射层、玻璃透射、皮肤次表面散射、水冰薄壁散射、清漆层和自发光，共计十个组件分层混合。

### 基础层（Base）
- **基础权重（Base Weight）**：基础层的强度，材质有自然的漫反射衰减，暗部有环境色反弹。
- **基础颜色（Base Color）**：材质的基本颜色，表面有自然的漫反射。
- **漫反射粗糙度（Diffuse Roughness）**：漫反射的粗糙程度，值越高漫反射越柔和。值为0时使用Lambert BRDF，大于0时使用Oren-Nayar BRDF。
- **金属度（Metalness）**：金属材质有彩色镜面反射和暗色漫反射，金属表面反射周围环境。中间值可创建复杂材质，如金、银、铁、车漆。

### 镜面层（Specular）
- **镜面权重（Specular Weight）**：镜面反射的强度，表面有镜面高光。
- **镜面颜色（Specular Color）**：镜面反射的颜色，金属有彩色高光，绝缘体有白色高光。
- **镜面粗糙度（Specular Roughness）**：镜面反射的粗糙度，影响反射的清晰度和折射的模糊度。
- **镜面折射率（Specular IOR）**：镜面折射率，控制反射强度，Fresnel反射自然。
- **镜面各向异性（Specular Anisotropy）**：各向异性，拉丝金属有沿固定方向拉伸的反光。
- **镜面旋转（Specular Rotation）**：各向异性高光的旋转方向。

### 透射（Transmission）
- **透射权重（Transmission Weight）**：透射强度，玻璃和水有真实的折射和透射。
- **透射颜色（Transmission Color）**：透射颜色，光线穿透透明物体时染上颜色。
- **透射深度（Transmission Depth）**：透射深度，控制光线在物体内部穿透的距离。
- **透射散射（Transmission Scatter）**：透射散射，光线在透射物体内部散射，产生体积感。
- **透射色散（Transmission Dispersion）**：色散，光线穿透钻石、玻璃时彩虹色分离。
- **透射额外粗糙度（Transmission Extra Roughness）**：透射额外粗糙度，玻璃表面有磨砂质感，毛玻璃效果自然。

### 次表面散射（Subsurface）
- **次表面权重（Subsurface Weight）**：次表面散射强度，皮肤通透有血色。
- **次表面颜色（Subsurface Color）**：次表面散射颜色，皮肤有血色透光感。
- **次表面半径（Subsurface Radius）**：光线在皮肤内部的散射距离，红色通道散射最远，皮肤有真实的血色层次。
- **次表面缩放（Subsurface Scale）**：次表面缩放，控制次表面散射的整体强度。

### 薄壁（Thin Walled）
- **薄壁（Thin Walled）**：纸张、树叶、肥皂泡等薄壁物体有透光感，光线从背面透出，薄壁物体有双面透光。

### 清漆层（Coat）
- **清漆权重（Coat Weight）**：清漆层强度，表面有一层透明清漆。
- **清漆颜色（Coat Color）**：清漆颜色，清漆层有独立的颜色。
- **清漆粗糙度（Coat Roughness）**：清漆粗糙度，清漆层的高光锐利程度。
- **清漆折射率（Coat IOR）**：清漆折射率，清漆层的反射强度。

### 光泽（Sheen）
- **光泽权重（Sheen Weight）**：光泽强度，织物边缘有柔和绒光。
- **光泽颜色（Sheen Color）**：光泽颜色，织物有柔和的散射颜色。
- **光泽粗糙度（Sheen Roughness）**：光泽粗糙度，天鹅绒和绸缎表面有柔和散射。

### 自发光（Emission）
- **自发光权重（Emission Weight）**：自发光强度，物体自身发光。
- **自发光颜色（Emission Color）**：自发光颜色，光源有可见的体积感。

### 薄膜（Thin Film）
- **薄膜厚度（Thin Film Thickness）**：薄膜厚度，肥皂泡、油膜等薄膜干涉产生的彩虹色。

### 几何（Geometry）
- **不透明度（Opacity）**：不透明度，透明物体控制透光程度。
- **法线（Normal）**：法线，表面有凹凸细节。
- **切线（Tangent）**：切线，各向异性方向控制。

### 高级（Advanced）
- **焦散（Caustics）**：焦散开关，水面或玻璃折射出波光粼粼的光斑。
- **内部反射（Internal Reflections）**：内部反射开关，透明物体内部有反射。

## 标准毛发着色器
物理基础毛发着色器，基于d'Eon镜面反射模型和Zinke漫反射模型，发丝有真实的镜面高光和透射散射，毛发间支持多重散射。
- **基础权重（Base Weight）**：毛发整体亮度。
- **基础颜色（Base Color）**：毛发的颜色，控制毛发纤维内部的吸收。
- **基础粗糙度（Base Roughness）**：毛发的粗糙度。
- **黑色素（Melanin）**：黑色素含量，范围从金色到黑色，发丝有自然的颜色变化。
- **黑色素泛红（Melanin Redness）**：泛红程度，数值越高泛红效果越明显。
- **黑色素随机化（Melanin Randomize）**：黑色素随机化，发丝有自然的颜色变化，发丝之间有细微的色差。
- **镜面权重（Specular Weight）**：镜面反射强度，发丝沿毛流形成方向性高光。
- **镜面粗糙度（Specular Roughness）**：高光有锐利的第一层和柔和的第二层。
- **镜面折射率（Specular IOR）**：发丝有真实的反射。
- **镜面偏移（Specular Shift）**：高光沿发丝方向移动。
- **镜面颜色（Specular Tint）**：发丝有彩色高光。
- **透射权重（Transmission Weight）**：透射强度，光线穿过发丝边缘。
- **透射颜色（Transmission Color）**：发丝有自然的透光颜色。
- **透射粗糙度（Transmission Roughness）**：发丝透光有柔和的边缘。
- **透射扩散（Transmission Spread）**：控制透射光的角度扩散。
- **漫反射权重（Diffuse Weight）**：漫反射强度，脏发有自然的漫反射。
- **漫反射颜色（Diffuse Color）**：漫反射的颜色。
- **不透明度（Opaque）**：毛发是否完全不透明。

## 皮肤
从标准表面着色器中提取所有能影响皮肤质感的技术词。
- **次表面权重（Subsurface Weight）**：皮肤通透有血色。
- **次表面颜色（Subsurface Color）**：皮肤有血色透光感。
- **次表面半径（Subsurface Radius）**：光线在皮肤内部的散射距离，Arnold官方推荐皮肤使用R:1.0, G:0.35, B:0.2。
- **次表面缩放（Subsurface Scale）**：控制次表面散射的整体强度。
- **漫反射粗糙度（Diffuse Roughness）**：漫反射的粗糙程度。
- **镜面粗糙度（Specular Roughness）**：皮肤表面反射的清晰程度。
- **镜面折射率（Specular IOR）**：皮肤折射率约为1.4，Fresnel反射正确。
- **清漆层（Coat）**：皮肤表面有一层极薄的透明层，模拟皮肤油脂膜。
- **清漆粗糙度（Coat Roughness）**：清漆层的粗糙度。
- **光泽（Sheen）**：皮肤边缘有柔和的光泽。
- **光泽粗糙度（Sheen Roughness）**：光泽的柔和程度。

## 眼睛
- **角膜着色器（Cornea Shader）**：角膜有折射和反射层次。
- **镜面粗糙度（Specular Roughness）**：角膜表面极度光滑，粗糙度接近0，反射清晰。
- **镜面折射率（Specular IOR）**：角膜折射率约为1.33-1.55，有真实的折射效果。
- **透射权重（Transmission Weight）**：角膜有透射效果，虹膜在角膜下可见。
- **次表面颜色（Subsurface Color）**：眼白有自然的血色。
- **次表面半径（Subsurface Radius）**：眼白的次表面散射半径。

## 体积与大气
- **标准体积（Standard Volume）**：基于物理的体积着色器，对体积密度、散射颜色和透明颜色提供独立控制。
- **大气体积（Atmosphere Volume）**：模拟薄而均匀的大气散射，光束穿透尘埃形成光柱，物体投射体积阴影。
- **雾（Fog）**：远景物体对比度下降，空气中有雾的散射感，空间层次增加。
- **体积散射（Volume Scattering）**：体积散射，光线在介质中散射，烟雾和雾气有真实的密度变化。
- **体积采样浮点（Volume Sample Float）**：从体积对象中采样数据。
- **体积采样RGB（Volume Sample RGB）**：从体积对象中采样颜色数据。

## 置换与细分
- **置换（Displacement）**：表面有真实的凹凸细节，置换改变几何体，有正确的轮廓和自阴影效果。
- **细分Catmull-Clark（Subdivision Catmull-Clark）**：模型表面平滑，置换细节有足够的分辨率。
- **细分迭代（Subdivision Iterations）**：细分迭代次数，增加迭代次数提高置换质量。
- **自动凹凸（Autobump）**：置换贴图的高频细节被保留，表面有微观凹凸。
- **置换高度（Displacement Height）**：置换高度，控制置换的强度。
- **法线置换（Normal Displacement）**：使用法线方向进行置换。
- **矢量置换（Vector Displacement）**：使用矢量方向进行置换。

## 程序化纹理
- **棋盘格（Checkerboard）**：表面有程序化生成的棋盘格纹理。
- **薄片（Flakes）**：表面有程序化生成的薄片纹理，适合模拟车漆、金属闪粉。
- **噪波（Noise）**：表面有程序化生成的噪波纹理，模拟有机表面变化。
- **渐变浮点（Ramp Float）**：使用浮点渐变驱动材质参数。
- **渐变RGB（Ramp RGB）**：使用RGB渐变驱动颜色变化。

## 灯光滤镜
- **挡光板（Barndoor）**：不透明的移动面板，用于控制光束的形状。
- **图案投影（Gobo）**：将光束打碎成不规则的、更自然的图案，如树叶等。
- **灯光阻挡（Light Blocker）**：阻挡连接灯光的任意几何定义区域。
- **灯光衰减（Light Decay）**：指定灯光开始和结束的衰减范围。

## 色彩管理
- **ACES色彩空间（ACEScg）**：Arnold默认使用ACEScg色彩空间，画面有电影级调色，暗部深邃，高光不过曝，色彩浓郁。
- **色彩空间输出（Color Space Output）**：画面色彩准确统一，跨镜头不偏色。

## 内部质量词直接剔除
以下术语描述引擎如何工作，画面上不可见，不进入提示词：
AOV读取、AOV写入、数学着色器节点名、转换着色器节点名、着色状态着色器节点名、用户数据着色器节点名、缓存节点名、直通节点名、切换节点名、追踪集节点名、UV变换节点名、向量贴图节点名、OSL着色器节点名、MaterialX节点名、OpenPBR Surface节点名、AXF Shader节点名、Toon节点名、Legacy Shaders节点名、Volume Collector节点名、Volume Sample Float节点名、Volume Sample RGB节点名、Ray Depth、Diffuse Depth、Specular Depth、Transmission Depth、Volume Depth、AA_samples、adaptive_sampling、adaptive_threshold、Operator、Procedural、ASS文件、Kick、LPEs、Cryptomatic、Denoiser、OptiX、Noice、Merge AOVs、Multichannel EXR、Bounce Factor、Stochastic Volume Interpolation、Conservative Mode、Exhaustive Mode。
