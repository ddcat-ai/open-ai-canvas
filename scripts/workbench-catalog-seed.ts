const imageRefs = {
  product: "0445ed7bced1a61fdaa4f73d5c53d1f6",
  fashion: "b3f1c822978bcf6f5d0bc0b3e1a64833",
  beauty: "638f9ce1f53fc4032378cf0ef5bb8d92",
  bag: "a996ec9314ef33d40ec1106e471426b7",
  coffee: "02960243dac877ed674c67c73a2d8626",
  food: "faaedd952b3fb5f5141b57fbe18c02af",
  tech: "ea777fa92a86a9ecd2b799e182717d86",
  man: "ef87854ec79c91ed743193983e186604",
  elder: "c3525b35c1a87bbbe4f4301b26ef096e",
  city: "bc835fd14e7418c6e2c9f7c9f2d3da54",
  interior: "e5727d30e239f25cc01dcdb9b275c847",
  forest: "dd1b57b5a50cc97d9a4aba408af4cc97",
  film: "0f64216d407eb6e19788e4c6ccfd1e18",
};

const sources = {
  ecommerce: [
    "https://github.com/dlazy-ai/ecommerce-skills",
    "https://github.com/xianyu110/ecommerce-image-skills",
    "https://www.reddit.com/r/comfyui/comments/1u783i6/built_a_product_catalog_photo_generator_with_3/",
    "https://www.reddit.com/r/comfyui/comments/1o2a3yu/looking_for_a_workflow_to_create_product/",
  ],
  drama: [
    "https://github.com/zenstory-ai/drama-skills",
    "https://github.com/xixihhhh/ai-short-drama-skill",
    "https://github.com/openlark/skills/tree/main/skills/storyboard-prompt-generator",
    "https://github.com/agentara/skills/tree/main/skills/aigc/video-storyboard",
  ],
  video: [
    "https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide",
    "https://help.runwayml.com/hc/en-us/articles/42460036199443-Text-to-Video-Prompting-Guide",
    "https://help.runwayml.com/hc/en-us/articles/35694045317139-Gen-4-Image-Prompting-Guide",
    "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  ],
};

// kind|category|key|name|focus|input 1|input 2|sample image
const rows = `
image|product|product-white-hero|商品白底主图|把商品置于纯白无缝背景中央，完整呈现轮廓、真实颜色、材质和包装细节，使用柔和棚拍光与克制自然投影|商品原图||product
image|ecommerce|product-soft-shadow|商品柔影主图|清理背景并重建柔和接触阴影，不改变商品外观、比例、标签与配件|商品原图||product
image|ecommerce|product-angle-set|商品多角度套图|依据同一商品参考生成正面、侧面、背面和斜侧角度，结构、颜色、纹理及标识保持一致|商品原图|细节参考图|tech
image|ecommerce|product-macro-detail|商品细节微距|突出材质纹理、做工、接口或关键部位的微距商业摄影，保留真实边缘与比例|商品原图|细节参考图|bag
image|ecommerce|fashion-on-model|服装平铺上身|将平铺服装自然穿到模特身上，衣型、印花、缝线、纽扣和颜色逐项忠实保留|服装平铺图|模特姿势参考|fashion
image|ecommerce|fashion-lookbook|服装上身套图|为同一套服装生成正面、侧面、背面和行走姿态，保持模特身份、衣着与摄影光线一致|服装图|模特参考图|fashion
image|ecommerce|fashion-colorway|服装颜色变体|只替换服装主色或指定配色，锁定版型、面料纹理、模特、姿势、背景和裁切|服装原图||fashion
image|ecommerce|shoe-on-model|鞋履上脚图|将鞋款自然穿在模特脚上，鞋型、鞋底纹路、鞋带、配色与左右脚细节保持一致|鞋商品图|模特姿势参考|product
image|ecommerce|bag-scale-lifestyle|包袋手持比例场景|展示包袋真实尺寸与肩背/手提关系，保留包型、五金、缝线和品牌细节|包袋原图|模特参考图|bag
image|ecommerce|jewelry-wear|饰品佩戴图|把饰品自然佩戴于人物身上，准确保持镶嵌、链节、比例和金属色，不增加宝石|饰品原图|佩戴部位参考|fashion
image|ecommerce|skincare-packshot|护肤品棚拍主图|为瓶罐构建干净专业的美妆棚拍，标签文字与包装结构必须按参考保留，不臆造功效|护肤品原图||beauty
image|ecommerce|skincare-texture|护肤质地细节图|以凝露、乳霜或精华质地为视觉重点，瓶身标签保持清晰且不生成未经证实的成分或功效|护肤品原图|质地参考图|beauty
image|ecommerce|cosmetic-swatch|彩妆色号展示|展示指定色号在皮肤/色卡上的真实观感，维持颜色准确，不添加未提供的色号或宣传文案|彩妆商品图|色号参考图|beauty
image|ecommerce|perfume-still-life|香水氛围静物|以玻璃反射、液体色泽和高级布光构建香水静物广告，瓶体与标签保持原样|香水瓶原图|品牌氛围参考|beauty
image|ecommerce|coffee-packaging|咖啡包装场景图|表现咖啡包装、豆粒和冲煮情境，袋型、标签、净含量与印刷位置严格匹配原图|咖啡商品图|场景参考图|coffee
image|ecommerce|food-menu-hero|食品菜单主图|将菜品拍成自然可食用的菜单主视觉，准确呈现份量、配料和器皿，不凭空增加食材|食品参考图|器皿参考图|food
image|ecommerce|drink-cold-scene|饮料冰感场景图|呈现杯身、饮料颜色、冰块与冷凝水的清爽广告静物，不改变包装或液体实际颜色|饮料商品图|背景参考图|food
image|ecommerce|furniture-room|家具空间主图|将家具自然放入尺度可信的居家空间，家具结构、尺寸比例、颜色和面料保持参考一致|家具商品图|室内空间参考|interior
image|ecommerce|home-decor-vignette|家居软装搭配图|用合理比例与克制道具呈现家居用品使用情境，商品是主角，避免遮挡商品关键结构|家居商品图|空间风格参考|interior
image|ecommerce|electronics-packshot|数码商品主图|突出设备机身、接口、按键和真实材质，屏幕保持干净且不伪造界面或品牌文字|数码商品图||tech
image|ecommerce|appliance-in-use|小家电使用场景|展示小家电真实使用姿态与合理空间关系，机身比例、按钮和线缆结构保持准确|家电商品图|使用场景参考|tech
image|ecommerce|packaging-lineup|包装套系陈列|将同一品牌的不同包装有序陈列，统一光线、机位与比例，逐一保留每个 SKU 标签|多款包装图||beauty
image|ecommerce|listing-benefit-layout|电商详情卖点版式|围绕已确认卖点规划主体、局部特写和留白区域，文字区只留干净空白供后期排版，不生成乱码|商品图|品牌风格参考|product
image|ecommerce|vertical-product-page|竖版商品详情视觉|按移动端竖屏阅读顺序安排主视觉、材质细节和场景图，商品外观一致且保留安全留白|商品图|详情页参考|beauty
image|ecommerce|campaign-key-visual|电商活动主视觉|为活动海报生成商品主视觉与可编辑留白，使用指定色彩层级，不生成促销数字、价格或伪文字|商品图|品牌色参考|bag
image|short-video|ugc-cover-product|商品 UGC 封面图|构建可信的手持开箱/使用封面，商品清晰可辨，人物动作自然，预留后期标题区|商品图|人物/手势参考|coffee
image|short-video|short-ad-cover|竖屏短广告封面|围绕一个明确商品卖点做强主体竖版封面，主体位置适配平台裁切，留白给后期标题|商品图|视觉风格参考|product
image|ecommerce|campaign-ab-variants|商品广告 A/B 变体|在保持 SKU 和品牌不变的前提下，生成两种不同构图/背景方向用于创意测试，不虚构产品利益点|商品图|品牌参考图|bag
image|product|product-background-replace|商品换背景|只替换环境背景与地面光影，商品形状、颜色、标签、透视及附件像素级忠实|商品原图|目标背景参考|product
image|ecommerce|fabric-detail-board|面料与工艺细节板|用近景展示织法、面料厚度、接缝与纽扣，细节必须来自参考图，不补造隐藏工艺|服装原图|工艺细节参考|fashion
image|ecommerce|beauty-routine-scene|美妆日常场景图|把产品置入简洁日常护理台面或浴室场景，包装标签可辨，避免暗示医疗或未证实功效|美妆商品图|场景参考|beauty
image|ecommerce|electronics-lifestyle|数码产品生活方式图|将设备融入真实办公/通勤场景，机身与屏幕不变形，显示内容保持抽象或空白|数码商品图|环境参考|tech
image|ecommerce|product-size-context|商品尺寸参照图|通过常见物体或手持关系帮助理解商品尺寸，比例明确，不虚构标注数值|商品图|尺寸参照物|bag
image|ecommerce|product-collection-grid|商品系列陈列图|为同一系列商品生成统一背景、间距和阴影的整齐组合陈列，避免产品互相遮挡|系列商品图||product
image|ecommerce|beauty-flatlay|美妆平铺组合图|俯拍排布产品、包装和少量真实配件，保持每件商品标签方向与外观清楚|美妆商品图|配件参考|beauty
image|ecommerce|food-ingredient-story|食品原料故事图|以产品和已知原料构建清晰静物叙事，不添加配方中未确认的成分或健康承诺|食品商品图|原料参考图|food
image|drama-character|drama-character-bible|短剧角色定妆立绘|建立可复用的角色外貌锚点：年龄感、脸型、发型、肤色、体态与服装层次固定|角色参考图|服装参考图|man
image|drama-character|drama-turnaround|短剧角色四视图|同一角色生成正面、侧面、背面和四分之三角度，发型、服装、体型和配件一致|角色参考图|服装/道具参考|elder
image|drama-character|drama-expression-sheet|短剧角色表情表|为同一角色生成克制的喜怒惊疑等表情变化，保持脸部身份、发型、年龄与服装不漂移|角色定妆图||fashion
image|drama-character|drama-costume-variants|短剧角色服装变体|为角色设计指定剧情阶段的服装方案，只改变服装与配件，保留角色身份和时代设定|角色定妆图|服装方向参考|elder
image|drama-character|drama-prop-turnaround|短剧关键道具三视图|生成关键道具正侧背与细节参考，锁定形状、材质、磨损、握持方式和剧情状态|道具参考图||film
image|drama-scene|drama-location-master|短剧场景空间母版|建立场景空间母版，明确入口、窗口、主要家具、主光方向和可表演区域|场景参考图|美术风格参考|interior
image|drama-scene|drama-location-coverage|短剧场景多角度|从同一空间生成全景、反打和侧面角度，门窗位置、地标、光线方向与空间轴线保持一致|场景母版|镜头角度参考|city
image|drama-scene|drama-time-variants|短剧场景昼夜变体|同一场景切换清晨/夜晚/雨天等指定时段，只改变时间氛围，空间布局和地标固定|场景母版|时间气氛参考|forest
image|storyboard|drama-storyboard-grid|短剧九宫格分镜|把一段已确认剧情拆为九格关键帧，每格单一动作、机位和情绪节点，人物造型连续|剧本/分镜文字|角色与场景参考|film
image|storyboard|drama-keyframe|短剧镜头关键帧|生成单镜头首帧构图，明确主体位置、视线、手部、持物、景别和画面左右关系|镜头描述|角色/场景参考|city
image|storyboard|drama-blocking-two-shot|短剧双人调度图|呈现双人站位和视线方向，明确画面左/右、前景/后景与摄影轴线，方便连续拍摄|角色参考图|场景母版|interior
image|storyboard|drama-over-shoulder|短剧过肩反打关键帧|生成对话过肩镜头，保持视线轴线、人物相对位置、焦平面和背景地标一致|角色参考图|上一镜关键帧|interior
image|storyboard|drama-continuity-repair|短剧分镜连续性修复|依据上一镜结束状态修正本镜起始状态，锁定服装、伤痕、道具手别、视线和空间方向|上一镜帧|当前镜头草图|film
image|drama-character|drama-identity-lock|短剧角色一致性参考|把多张角色参考整合为一份稳定外貌锚点，明确必须保持的脸型、发型、服装和年龄感|角色多角度图||man
image|drama-character|drama-wardrobe-ledger|短剧服装连续性图|按剧情阶段展示服装状态与可变项，固定角色身份、主色、发型和配件|角色图|服装状态参考|elder
image|drama-scene|drama-weather-continuity|短剧天气光线连续性|为同一场景制作指定天气与主光方向的镜头参考，雨量、地面湿度和光源位置连续|场景参考图|天气氛围参考|city
image|drama-character|drama-period-costume|年代短剧角色造型|按明确年代与身份生成角色造型参考，服装版型、发型、配饰和妆容避免混搭时代|角色参考图|年代服饰参考|elder
image|drama-scene|drama-modern-suspense-set|现代悬疑短剧场景|设计可拍摄的悬疑室内场景，明确出口、遮挡物、光源和关键线索位置|场景参考图|线索道具图|interior
image|short-video|drama-romance-poster|短剧情感封面海报|生成适合竖屏分发的情感短剧封面构图，人物关系清楚，标题区域留白，不生成文字|角色定妆图|气氛参考图|fashion
image|storyboard|drama-reveal-closeup|短剧反转揭示特写|为剧情揭示瞬间构建可读的面部特写，控制视线、微表情、景深和关键道具露出|角色参考图|线索道具图|man
image|storyboard|script-to-storyboard|短剧剧本转分镜画面|按已确认剧本逐镜生成可制作的关键帧，包含景别、动作起止、视线与道具状态|剧本片段|角色/场景资产|film
image|storyboard|comic-drama-panels|漫剧分格画面|将单个剧情节拍拆为连贯漫画格，统一人物造型、阅读顺序和光色，不在画面内生成气泡字|角色设定图|分镜脚本|film
image|drama-scene|drama-set-extension|短剧场景横向扩展|扩展原场景画布供竖屏/横屏裁切，建筑结构、光源方向和地标连续，不增加剧情信息|场景母版||forest
image|storyboard|drama-clue-insert|短剧线索道具插入帧|生成手部与线索道具特写，明确左右手、握持方式、道具朝向与景深焦点|角色参考图|道具参考图|film
image|drama-character|drama-ensemble-lineup|短剧群像关系站位|按人物关系生成群像定妆站位，身高比例、服装身份差异和画面层次清晰|角色参考图|场景参考图|man
image|drama-character|drama-power-pose|短剧人物气场立绘|用体态、视线、服装輪廓和机位体现角色权力关系，避免改变已锁定的面部身份|角色定妆图|姿态参考图|elder
image|short-video|drama-opening-cover|短剧开篇竖屏封面|突出主角与本集冲突信息的视觉焦点，竖屏安全区留白，不生成标题和平台标识|角色定妆图|本集情绪参考|city
image|drama-scene|drama-location-redress|短剧场景陈设变体|在不改变空间结构的前提下更换指定年代/剧情阶段的陈设，固定门窗、轴线和摄影地标|场景母版|陈设参考|interior
image|enhancement|drama-color-script|短剧色彩风格帧|为一集建立统一色彩与光影参考，肤色自然、主色克制，并保留各场景可辨识度|已有关键帧|色彩方向参考|film
image|people|portrait-realism|人物写真真实感增强|修复人像光影、发丝与皮肤细节，保留原人物身份、年龄、肤色和自然纹理|人像原图||fashion
image|scene|background-replace|人物/商品换背景|只替换背景并匹配透视、接触阴影和环境光，主体结构与细节保持不变|主体原图|目标背景图|interior
image|enhancement|image-restoration|图片修复与清晰化|提升清晰度、去除压缩噪点并恢复边缘，不重画文字、商标、五官或商品结构|待修复图片||film
image|enhancement|style-transfer-reference|统一视觉风格参考|把参考图的色彩、笔触、光线和质感迁移到目标画面，构图和主体身份保持|目标图|风格参考图|film
video|ecommerce|product-hero-motion|商品广告英雄出场|单镜头缓慢推进至商品，商品保持静止且标签清晰，背景光线轻微流动，结尾停留完整主视觉|商品首帧|运动参考视频|product
video|ecommerce|product-orbit|商品缓慢环绕展示|镜头围绕静置商品平稳移动约四分之一圈，维持商品结构、透视、包装文字和背景连续|商品首帧|商品多角度参考|tech
video|ecommerce|product-macro-push|商品细节微距推进|镜头缓慢推近指定材质/接口并保持焦点稳定，商品不变形，微距结束时留出清晰细节|商品细节首帧|细节参考图|bag
video|ecommerce|fashion-fabric-motion|服装面料动态展示|模特保持自然站姿，轻微转身带动衣料产生真实褶皱，衣型、印花和颜色锁定|服装首帧|模特参考图|fashion
video|ecommerce|fashion-model-turn|服装模特转身展示|模特从正面缓慢转向侧面并回望镜头，单一连续动作，衣着与身份保持一致|模特首帧|服装参考图|fashion
video|ecommerce|shoe-walk-demo|鞋履步态展示|脚步自然向前两步，镜头低位跟拍鞋面和鞋底，鞋款结构、左右脚及步态连续|鞋履首帧|鞋款参考图|product
video|ecommerce|bag-lifestyle-walk|包袋通勤动态展示|人物自然行走并轻微摆动手提包，镜头平稳跟随，包型、五金与手部接触保持稳定|包袋首帧|模特参考图|bag
video|ecommerce|jewelry-light-motion|珠宝微光动态展示|镜头缓慢侧移，珠宝反射光轻柔掠过，宝石数量、形状、镶口与佩戴位置不变|饰品首帧|饰品细节图|fashion
video|ecommerce|serum-drop-demo|精华滴管产品镜头|滴管缓慢抬起并落下一滴透明液体，瓶身和标签固定，动作简洁、液体比例真实|产品首帧|包装参考图|beauty
video|ecommerce|skincare-routine|护肤品使用动作演示|手部将产品轻放于台面并做一次简单取用动作，包装保持准确，不暗示治疗效果|产品首帧|使用步骤参考|beauty
video|ecommerce|perfume-mist|香水喷雾广告镜头|手指轻按喷头，细雾在侧逆光中短暂显现，瓶体、标签和液体颜色不改变|香水首帧|品牌光线参考|beauty
video|ecommerce|coffee-pour|咖啡冲煮动态镜头|热水稳定注入咖啡滤杯，蒸汽轻微升起，镜头缓慢推进，器具比例和咖啡颜色真实|咖啡首帧|器具参考图|coffee
video|ecommerce|food-steam-closeup|食品热气特写|镜头轻推近刚出锅的菜品，蒸汽自然上升，配料与摆盘保持原样，不突然增减食物|菜品首帧|菜单参考图|food
video|ecommerce|unboxing-sequence|商品开箱动作|双手平稳打开包装并露出商品，包装印刷不变，动作按顺序完成且不跳帧|包装首帧|商品/包装参考图|coffee
video|ecommerce|appliance-action|小家电功能动作展示|设备完成一个明确的开关/运行动作，按键和结构固定，镜头记录状态变化，不生成界面文字|家电首帧|产品细节图|tech
video|ecommerce|furniture-room-reveal|家具空间揭示镜头|镜头从局部平稳后退显露完整房间与家具，空间尺寸可信，家具结构和材质不变|家具首帧|空间参考图|interior
video|ecommerce|electronics-detail-demo|数码产品环绕特写|镜头从机身侧边移动到接口特写，屏幕保持抽象纯色，按钮数量与机身轮廓固定|数码首帧|接口细节图|tech
video|short-video|vertical-product-hook|竖屏商品三秒钩子|开场立即看到商品与一个清晰动作，镜头快速但平稳推进，商品全程在竖屏安全区内|商品首帧|广告节奏参考|product
video|ecommerce|handheld-product-demo|手持商品使用演示|手部拿起商品并展示一个真实使用动作，手指数目自然，包装文字和商品外观锁定|商品首帧|手部/动作参考|bag
video|ecommerce|product-end-card-motion|商品广告收尾停留|镜头轻微推近后稳定停留在完整包装主视觉，背景保持干净，结尾留白供后期加文案|商品首帧|品牌背景参考|beauty
video|ecommerce|spotlight-packshot|商品聚光棚拍动态|背景保持静止，柔和聚光从侧面扫过商品表面并结束于均匀主光，商品不旋转变形|商品首帧||product
video|ecommerce|product-compare-motion|商品前后状态对照镜头|按用户提供的两种真实状态做平稳左右对照，不添加性能结论、数值或未经证实的效果|状态A首帧|状态B参考图|tech
video|ecommerce|product-360-still|单品静帧转展示视频|以商品原图为首帧，只做缓慢镜头环绕/推拉与灯光变化，严禁重绘商品细节|商品首帧|商品参考图|product
video|drama-character|drama-character-entrance|短剧主角入场镜头|角色从画面边缘走入并在指定地标前停下，服装、发型、持物和画面方向连续|镜头首帧|角色定妆图|man
video|storyboard|drama-single-dialogue|短剧单人对白镜头|角色说出一小句台词并完成一个微表情，视线固定在画外对手方向，镜头缓慢推近|镜头首帧|角色参考图|elder
video|storyboard|drama-reaction-closeup|短剧反应特写|角色听到信息后先保持静止再出现克制的表情变化，目光落点清晰，机位稳定|镜头首帧|角色定妆图|fashion
video|storyboard|drama-two-person-dialogue|短剧双人对话调度|两人按首帧左右位置进行一轮简短交流，只移动说话者的视线与轻微手势，摄影轴线不变|双人首帧|角色参考图|interior
video|storyboard|drama-ots-reverse|短剧过肩反打镜头|从肩后轻微移焦至对手反应，保持视线方向、前后景和人物站位与参考镜头一致|过肩首帧|反打构图参考|interior
video|drama-character|drama-walk-up-turn|短剧人物走近回身|角色向镜头走两步并在标记处回身，动作单一连贯，服饰、手中道具与背景地标锁定|角色首帧|场景母版|city
video|storyboard|drama-clue-reveal|短剧线索揭示镜头|镜头由人物视线平移至关键道具并停留，线索保持可读，手部和道具位置不跳变|线索首帧|道具参考图|film
video|storyboard|drama-hand-insert|短剧手部道具特写|手从画面边缘拿起指定物件并翻转一次，左右手和握持关系正确，镜头保持近景|手部首帧|道具参考图|film
video|drama-scene|drama-rain-window|短剧雨窗氛围镜头|窗外雨滴缓慢滑落，室内角色仅有轻微呼吸动作，灯光方向、窗框和空间布局保持不变|场景首帧|角色参考图|city
video|drama-scene|drama-night-establishing|短剧夜景建立镜头|镜头沿街道缓慢前移建立地点，招牌不生成可读文字，地标、天气和光源位置稳定|场景首帧|地点参考图|city
video|drama-scene|drama-corridor-follow|短剧走廊跟拍镜头|镜头从角色身后平稳跟随其沿走廊前行，门窗顺序与空间纵深连续，不穿越墙体|走廊首帧|角色参考图|interior
video|storyboard|drama-look-back|短剧悬念回望镜头|角色听见画外声后停步并缓慢回头，表情克制，机位与视线落点清晰|镜头首帧|角色定妆图|elder
video|storyboard|drama-flashback-transition|短剧回忆转场镜头|以一次柔和曝光/焦点变化进入回忆画面，不改变角色身份，转场前后动作衔接清楚|当前镜头首帧|回忆场景参考|film
video|drama-character|drama-romance-meet|短剧情感相遇镜头|两位角色在同一空间短暂停步并交换视线，动作自然克制，人物位置和背景关系稳定|双人首帧|角色参考图|fashion
video|storyboard|drama-confrontation|短剧对峙调度镜头|两人保持安全距离进行克制对峙，仅有一步靠近或手势变化，摄影轴线与地标不变|双人首帧|场景母版|interior
video|drama-character|drama-fantasy-reveal|短剧奇幻角色揭示|镜头缓慢揭示角色轮廓与环境光效，角色面部、服饰和身体结构不改变，动作单一|角色首帧|风格参考图|forest
video|storyboard|drama-keyframe-animation|短剧关键帧图生视频|将关键帧里的一个明确动作扩展成短镜头，保持角色、服装、道具、场景和机位连续|冻结关键帧|角色/场景参考|film
video|storyboard|drama-first-last-frame|短剧首尾帧过渡|严格从指定首帧移动到指定尾帧，只补足两帧间合理动作，不新增人物或改变道具状态|首帧|尾帧|city
video|short-video|drama-vertical-hook|竖屏短剧开场钩子|用一个清晰动作和快速建立的情绪焦点抓住前三秒，主体处在竖屏安全区，背景信息简洁|开场首帧|角色参考图|man
video|storyboard|drama-lipsync-line|短剧单句口型表演|角色对镜头外对象说出指定短句，嘴部动作自然，台词不扩写，表情与角色设定一致|对白首帧|角色/音色说明|elder
video|drama-scene|drama-ending-hold|短剧结尾悬念停帧|角色完成一个克制动作后停留在悬念构图，镜头稳定保持结尾画面，不自行揭示答案|结尾首帧|角色/道具参考|film
video|short-video|image-to-video-motion|参考图轻动作动画|保留参考图构图与主体身份，仅添加呼吸、微风或轻微镜头运动等一种低幅度动作|参考首帧|运动參考视频|forest
video|scene|flower-motion-study|花植轻风运镜|以花朵近景为主体，微风带动花瓣和叶片轻轻摆动，镜头缓慢侧移并保持柔和自然光|花植首帧|运动参考视频|forest
video|scene|environment-reveal|环境空间揭示视频|从局部平稳移动到完整空间全景，建筑结构、地标、透视和光源方向保持连贯|环境首帧|空间参考图|interior
video|short-video|camera-motion-study|镜头运动测试|对同一静态主体测试一种明确机位运动，主体不变形，背景透视连续，不叠加多余动作|测试首帧|机位参考图|film
video|short-video|abstract-transition|短片氛围转场|在两个给定画面之间用一种克制的光线/焦点转场连接，保留主体轮廓与色彩关系|转场首帧|目标帧|city
`.trim().split("\n").map((line) => line.split("|"));

const imageIds: Record<string, string> = { ...imageRefs };
const imageUrls: Record<string, string> = {
  product: "https://images.unsplash.com/photo-1542291026-7eec264c27ff",
  fashion: "https://images.unsplash.com/photo-1534528741775-53994a69daeb",
  beauty: "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b",
  bag: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa",
  coffee: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085",
  food: "https://images.unsplash.com/photo-1546549032-9571cd6b27df",
  tech: "https://images.unsplash.com/photo-1606220945770-b5b6c2c55bf1",
  man: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e",
  elder: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d",
  city: "https://images.unsplash.com/photo-1519608487953-e999c86e7455",
  interior: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0",
  forest: "https://images.unsplash.com/photo-1448375240586-882707db888b",
  film: "https://images.unsplash.com/photo-1485846234645-a62644f84728",
};

const tools = rows.map(([kind, categoryId, key, name, focus, inputOne, inputTwo, sampleKey], index) => {
  const sampleResourceId = imageIds[sampleKey] || imageIds.product;
  const drama = categoryId.startsWith("drama-") || categoryId === "storyboard";
  const video = kind === "video";
  const keywords = [...new Set([name, categoryId, drama ? "短剧" : "电商", video ? "图生视频" : "生图", ...focus.split(/[，、； ]/).filter((word) => word.length > 1).slice(0, 8)])].slice(0, 20);
  const slots = [{
    key: "reference-main", name: inputOne, mediaTypes: [inputOne.includes("视频") ? "video" : "image"], resourceKind: "asset", minCount: 1, maxCount: 4, required: true,
    coverResourceId: sampleResourceId, sampleResourceId,
  }];
  if (inputTwo) slots.push({
    key: "reference-support", name: inputTwo, mediaTypes: [inputTwo.includes("视频") ? "video" : "image"], resourceKind: "asset", minCount: 0, maxCount: 4, required: false,
    coverResourceId: sampleResourceId, sampleResourceId,
  });
  const imagePrompt = `以参考图1为主体外观与身份的唯一依据，${focus}。保持主体结构、颜色、比例、材质和可见细节稳定；参考图2仅用于其对应的场景/姿态/风格，不得覆盖主体特征。采用清晰的主体层级、可信透视、自然光影与真实接触关系。画面不生成文字、价格、水印、虚构品牌或未提供的产品信息；输出干净、可用于商业创作的${drama ? "短剧资产/分镜参考" : "电商视觉"}。`;
  const videoPrompt = `单镜头短片，${focus}。${inputOne}决定主体身份与首帧构图；若有第二参考，只用于对应动作/风格。按“起始状态→一个清晰动作→稳定结束状态”连续演完，镜头运动克制且明确，主体脸、服装、商品结构、道具手别、空间轴线与光源方向全程一致。动作幅度真实，背景不跳变，不新增人物/物件/文字，不发生形变、闪烁或瞬移；结尾停留约1秒，便于剪辑。`;
  const referenceList = drama ? sources.drama : sources.ecommerce;
  const guideLines = [
    `准备：上传${inputOne}${inputTwo ? `；可补充${inputTwo}` : ""}。先选定主体/角色锁定信息，再填写本次${video ? "动作与机位" : "构图、光线和风格"}要求。`,
    `生成：${focus}。每次只改一个变量；涉及同一 SKU/角色/场景的多张图时，复用相同参考并把身份锚点原样带入。`,
    `验收：检查${drama ? "脸/服装/持物/视线/轴线/场景地标连续性" : "商品轮廓/颜色/包装文字/配件/比例/阴影真实性"}；不确定的规格、卖点和文字留空交给后期核实。`,
  ];
  const imageExampleText = `Unsplash 风格参考照片（不是本工具生成结果）。素材源：${imageUrls[sampleKey] || imageUrls.product}；用于展示输入/构图方向，实际结果需以所选模型生成为准。`;
  const presets = video ? [
    { name: "标准单镜头", summary: "一个主体动作 + 一种机位运动 + 稳定尾帧", promptTemplate: videoPrompt, enabled: true, sortOrder: 0 },
    { name: "情绪强化", summary: "增强表演节奏与光线，不增加动作", promptTemplate: `${videoPrompt} 情绪方向：从克制开始，在动作完成时出现清楚但不过度的情绪变化；使用单一色温与柔和层次光，避免快速剪切。`, enabled: true, sortOrder: 1 },
    { name: "干净产品/连续性版", summary: "优先保真与稳定，降低背景运动", promptTemplate: `${videoPrompt} 保真优先：镜头固定或极慢推进，背景保持静止，主体占画面主要区域，所有标签/服装/道具细节清晰可核对。`, enabled: true, sortOrder: 2 },
  ] : [
    { name: "标准主视觉", summary: "主体保真，按核心用途生成", promptTemplate: imagePrompt, enabled: true, sortOrder: 0 },
    { name: "构图变化", summary: "锁定主体，只调整机位和留白", promptTemplate: `${imagePrompt} 构图变体：采用轻微三分法机位，将主体放在画面一侧，另一侧留出干净负空间；主体仍完整可辨，画面层次简洁。`, enabled: true, sortOrder: 1 },
    { name: "细节优先", summary: "适合材质、五金、表情与连续性检查", promptTemplate: `${imagePrompt} 细节版：镜头略近，优先表现真实纹理、边缘、手部/面部自然结构与接触阴影；不锐化出虚假纹理，不改变主体身份。`, enabled: true, sortOrder: 2 },
  ];
  const exampleDescription = key === "flower-motion-study"
    ? `${imageExampleText} 另附 MDN CC0 花卉运动样片，仅作动态参考，不是本工具生成结果。`
    : imageExampleText;
  const resultExample = {
    title: `${name}参考示例`,
    description: exampleDescription,
    imageResourceIds: [sampleResourceId],
    ...(key === "flower-motion-study" ? { videoResourceId: "360faf53e9d314f9f94eb69fb429ed5f" } : {}),
  };
  return {
    seedKey: `catalog-2026-10-${key}`,
    kind, categoryId, name,
    subtitle: focus.slice(0, 80),
    description: `${focus}。${video ? "适合图生视频/镜头预演，具体时长和画幅以所选模型能力为准。" : "适合先以参考图锁定主体，再按场景与版式生成；商品/角色细节需人工验收。"}`,
    iconResourceId: sampleResourceId,
    coverResourceId: sampleResourceId,
    sortOrder: 1000 + index * 10,
    enabled: true,
    capability: {
      supportedModes: [kind], searchKeywords: keywords, surfaces: ["workbench"],
      recommended: index < 12, recommendationOrder: index + 1, catalogSeedKey: `catalog-2026-10-${key}`,
      inputContract: { promptRequired: true, minTextReferences: 0, slots },
    },
    guide: {
      inputHint: `${inputOne}${inputTwo ? `；可选${inputTwo}` : ""}。${focus}`.slice(0, 500),
      lines: guideLines,
      resultExample,
      researchSources: [...referenceList, ...(video ? sources.video : [])],
      sampleDisclosure: "示例图片来自 Unsplash，已导入本平台资源；均为风格/输入参考，不宣称是模型生成输出。提示词为结合开源工作流与官方指南整理的可编辑模板。",
    },
    presets,
  };
});

const payload = {
  schemaVersion: 1,
  researchedOn: "2026-10-12",
  counts: { total: tools.length, image: tools.filter((tool) => tool.kind === "image").length, video: tools.filter((tool) => tool.kind === "video").length },
  sourceNotes: [
    "GitHub/ecommerce-skills：商品白底、上身、多角度、套图一致性与细节场景工作流。",
    "GitHub/zenstory-ai/drama-skills：故事资产、角色/场景锁定、分镜冻结、单镜视频提示词与连续性检查。",
    "Runway Gen-4 与 Google Veo 官方提示指南：主体动作、场景、景别、镜头运动、光线/氛围与单镜头迭代。",
    "Reddit/ComfyUI 社区经验仅作为低权重补充；商品主图/品牌标签必须用实物图人工核验。",
  ],
  sources: [...new Set([...sources.ecommerce, ...sources.drama, ...sources.video])],
  sampleImageSources: Object.fromEntries(Object.entries(imageUrls).map(([key, url]) => [key, `${url}?auto=format&fit=crop&w=720&q=82`])),
  tools,
};

Deno.serve({
  hostname: "127.0.0.1",
  port: 4174,
  handler(request) {
    if (new URL(request.url).pathname !== "/catalog.json") return new Response("not found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
    return Response.json(payload, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  },
});
console.log(`Workbench seed ready at http://localhost:4174/catalog.json (${tools.length} entries)`);
