# AIGC电影风格提示词合集

> **落位说明**（并入影视剧作工坊时添加，正文保留原文）
> 来源：【49】AIGC电影风格提示词合集 · 37 类经典影像风格 + 15 种影视视觉风格模板 + 15 位导演调色风格模板
> 原文文件名：`AIGC电影风格提示词合集.txt`
> 链路归位：见第四批提取索引 `INDEX.md`（镜头→光影→物理→分镜连续→提示词→声音BGM→连续性）

《AIGC 电影风格提示词合集》完整 txt 版
==================================================
来源目录：C:\232233\【49】AIGC电影风格提示词合集
本文件由以下内容按顺序合并提取而成：
  1. 【使用注意与技巧】.txt
  2. 电影风格核心要点.txt
  3. AIGC电影风格提示词合集（196页）.pdf（正文，37 类经典影像风格）
  4. 15 种影视视觉风格 AI 提示词模板.pdf
  5. 15 位电影导演调色风格 AI 提示词模板.pdf
==================================================


#################### 第一部分 【使用注意与技巧】 ####################

本合集包含《AIGC电影风格提示词合集》、《15 种影视视觉风格提示词》和《15 位电影导演调色风格 AI 提示词模板》，内容可直接复制，用于 AI 绘图与 AI 视频生成。

其中后两份文档均为附带镜头参数、提示词后缀的 AI 提示词模板。

AI 生图、生视频的最终效果以实际输出为准，不同大模型生成效果会存在差异；

若生成效果达不到预期，可以更换模型，或是微调提示词，对镜头参数进行修改、删减；
同一套提示词，分别用于生图和生视频，输出效果同样会存在区别。


💡使用小技巧：

可按需叠加镜头、胶片、光影类关键词，进一步强化画面质感。

提示词仅起到风格引导作用，受模型性能、生成参数等条件限制，AI 无法做到 100% 复刻原版影视画面。

建议多次调试迭代，搭配负面提示词使用，出片效果会更好。

#################### 第二部分 【电影风格核心要点】 ####################

一、万能提示词公式（所有风格通用）

一条完整提示词 = 镜头运镜 + 主体内容 + 风格标签 + 光影 + 色彩 + 胶片质感 + 氛围情绪 + 画幅参数

[运镜/景别] + [主体动作/场景描述] + [导演/电影风格标签] + 
[光影：逆光/侧逆光/硬光/柔光 + 暖冷调] + 
[胶片质感：35mm颗粒/柔焦/漏光/漂白过曝] + 
[氛围情绪词] + [画幅参数 --ar 21:9]


二、"四段式"结构

以岩井俊二那段"总提示词"为例，能看到清晰的分层：
段落 	作用 	示例词
① 风格锚定 	锁定导演/电影 	Iwai Shunji style, All About Lily Chou-Chou
② 质感设定 	胶片+镜头语言 	35mm film grain, soft focus, handheld camera shake
③ 色彩/光影 	定调 	cool cyan-blue tone / warm golden hour backlight, lens flare, muted desaturated palette
④ 构图/情绪 	画面+氛围 	minimal composition, vast negative space, low angle, melancholic mood

三、可复用的"通用模块词库"

胶片质感类（几乎所有风格都在用）：

    35mm film grain / vintage film grain
    soft focus / 柔焦
    lens flare / 镜头光晕
    bleach bypass / 漂白过曝
    pushed processing / 迫冲
    gritty texture / 粗粝质感
    high contrast / 高对比

光影类（两大对立体系）：

    温暖系：warm golden hour backlight / side rim light / soft diffused light
    冷峻系：intense rear rim light / non-naturalistic theatrical lighting / deep shadows

构图类：

    minimal composition / vast negative space（留白孤独）
    shallow depth of field（浅景深）
    symmetrical composition（对称）
    low angle / extreme low angle（仰拍）

情绪类：

    melancholic / lonely / nostalgic（忧郁怀旧）
    dreamy / ethereal / poetic（梦幻诗意）
    cinematic / atmospheric（电影感）

四、视频提示词的固定模板

图片提示词→视频提示词时，格式非常统一，直接套：

运镜：缓慢推近/拉远/横移/跟拍，轻微呼吸感晃动
[风格标签] + 场景 + 主体动作 + 光效 + 色调 + 胶片颗粒 + 柔焦光晕
镜头[运镜动作]，捕捉[细节]，传递出[情绪氛围]

#################### 第三部分 【AIGC电影风格提示词合集（196页）】 ####################


========== 主合集 第 1 页 ==========

   AIGC 电影风格提示词合集


这是一套面向漫剧与AIGC 创作者的「导演/电影风格」视觉素材系统，收录

37 类经典影像风格。从徐克的武侠江湖、岩井俊二的青春物语、库布里克的

冷峻科幻、王家卫与杜可风的港风霓虹，到娄烨的颓败纪实、杨德昌的90 年

代华语胶片，再到《赎罪》《CMBYN》《傲慢与偏见》《绿山墙的安妮》等欧

美田园与古典浪漫——每一类都按构图镜头、色彩光影、质感氛围、经典场

景、角色动作、色调细节六个维度拆解，并提供可直接垫图的中英双语图片提

示词与带运镜指导的视频提示词，帮助创作者一键复刻电影级视听质感，批量

产出风格统一、氛围浓厚的画面。


核心是：每个风格都拆解成构图镜头、色彩光影、质感氛围、经典场景、角色

动作、色调细节等维度，并配图片提示词+ 视频提示词（含运镜），方便直

接垫图使用。



 徐克武侠风提示词


构图与镜头           14mm 超广角镜头、极低仰拍（LOW ANGLE
              SHOT）、倾斜失衡构图、前景遮挡（如破酒旗/刀
             刃）、动态模糊


色彩与光影        漂白过曝废土色调、强烈逆光高光溢出、迫冲工艺混浊
             感、高对比度

质感与氛围        胶片颗粒、粗粝胶片质感、漫天沙尘/烟雾、动态模
             糊、肃杀江湖险恶感、场景与元素


经典场景         大漠黑店、雨雾竹林、破旧酒旗、带缺口刀刃、侠客对
            峙

========== 主合集 第 2 页 ==========

角色与动作        侠客、剑客、打斗、剑光轨迹、雨夜对决

提示词示例           14mm 超广角镜头，极低仰拍，倾斜失衡构图，前景破
             酒旗遮挡，漂白过曝废土色调，强烈逆光高光溢出，胶
             片颗粒，动态模糊，漫天沙尘，侠客对峙，肃杀江湖险
            恶感

              东方武侠风格，35 毫米老胶片粗颗粒质感，暖金色
             调，轻微光漏，雨丝高光反射，75％留白构图，极致
             禅意与孤独感。画面几乎被灰白天空、茫茫水面、细雨
               薄雾占据，约1/8 画面比例出现人物

             老旧电影胶片质感，依士曼彩色胶片，特艺彩色，高饱
             和度，强烈的舞台戏剧、高调硬光，发黄的钨丝灯暖
             光，高度人工化的影棚置景，粗麻与亮面绸缎的材质混
             搭，非自然主义戏剧布光，画面阴暗无光，老电影胶片
             颗粒质感，摄影棚内景感，人物装造均采取邵氏武侠夸
             张戏剧风格

色彩色调          主色调: 深蓝色、暗青色、黑色、深灰、暗绿、墨绿

              冷色系主导: 整体色调冷峻、沉郁,去饱和度较高

               暖色点缀: 金色、银色高光(剑刃、装饰),橙色、黄色火
               光(局部光源)

               对比效果: 冷暖色强烈对比,增强视觉冲击力

细节补充-人物       男性角色,表情严肃、凶狠、专注

             长发束起或披散,眼神锐利

             身着黑色传统长袍、斗篷或鳞甲式服装

             服装材质呈现皮革、金属、布料的纹理感

             多层次服装设计,有复杂的图案和细节

细节补充-服饰      皮革或金属质感的鳞甲

             头戴官帽、宽檐帽或传统头饰

             腰间佩戴刀剑等武器

             衣物褶皱自然,有光泽反射

========== 主合集 第 3 页 ==========

细节补充-武器道具    闪光的剑刃,刀身反光明显

              金色/黄铜色剑柄装饰

             短刀、佩刀等传统武器

             武器细节清晰,有金属质感

细节补充-环境场景    夜晚的古老东方庭院、小巷或建筑

             带有木质窗格和格栅的建筑背景

             地面湿润,有积水反射火光

              大雪纷飞(雪花清晰可见,有动感)

              背景模糊,营造纵深感

细节补充-光影效果    低调照明,光线集中于人物

             火光作为主要光源,制造背光、侧影和长长的阴影

             面部光线复杂,部分被帽子阴影覆盖

             环境细节在黑暗中若隐若现

             火焰边缘有烟雾效果

细节补充-氛围营造    神秘、压抑、紧张的氛围

             戏剧性的光影对比

             电影级的视觉质感

             历史感和东方传统元素

女侠比剑             A cinematic close-up
                                portrait of a female
                             warrior in traditional
                         Eastern fantasy style,
                            with a horizontal long
                       sword blocking her eyes.
                     She wears a flowing robe
                                in blue and red colors,
                           holding the sword handle
                            with her hands. Intense
                            rear rim light creates
                          dramatic highlights on the
                       sword blade, making it
                           the brightest element in

========== 主合集 第 4 页 ==========

                           the frame. The female's
                          face shows strong
                           chiaroscuro lighting with
                    warm skin tones, red
                           glossy lips, and detailed
                       makeup. Lighting: Non-
                                naturalistic theatrical
                                 lighting, overall dark and
                       shadow-heavy scene,
                       deep shadows
                            contrasting sharply with
                           the bright highlights on
                           the sword. Rear rim light
                             outlines the figure and
                           the metallic texture of the
                            blade. Film Texture:
                          Vintage film grain,
                       pushed processing, high
                             contrast, gritty texture.
                              Setting: Highly artificial
                        soundstage atmosphere,
                        background is a blurred
                          dark outdoor environment
                            with trees barely visible,
                                      all as studio-built
                        backdrop or props. Color
                              Palette: Deep blue-green
                          tones in the background,
                    warm skin tones on the
                             face, the sword blade
                               reflecting bright
                               highlights, strong cool-
                    warm color contrast.
                        Atmosphere: Epic martial
                              arts style, mysterious and
                           dramatic, intricate details
                       on the sword's metallic
                             texture and facial
                             features.

树下练剑             A cinematic martial arts
                       scene featuring a
                                traditional Chinese
                             warrior in dark costume,
                            wielding two swords in

========== 主合集 第 5 页 ==========

                        dynamic combat pose
                            with motion blur. The
                             warrior is positioned in
                           the lower left area,
                         surrounded by a dense
                              forest with a massive
                           ancient tree on the right
                           side featuring golden
                           yellow foliage. The
                        ground is covered with
                           dry yellow leaves, and
                           misty atmosphere fills the
                                    air. Strong god rays
                            pierce through from
                         above, creating dramatic
                                 lighting. Lighting: Non-
                                naturalistic theatrical
                                 lighting, intense rear rim
                                   light, overall dark and
                       shadow-heavy scene,
                       deep shadows
                            contrasting sharply with
                               highlights. Film Texture:
                          Vintage film grain,
                       pushed processing, high
                             contrast, gritty texture.
                              Setting: Highly artificial
                        soundstage atmosphere,
                              forest and ancient tree as
                               studio-built backdrop or
                           props. Color Palette:
                     Deep cool tones of dark
                          green, dark brown, and
                             black, contrasted with
                    warm golden and orange
                              highlights from the light
                       beams. Atmosphere: Epic
                           fantasy style, mysterious
                       and solemn, dynamic
                          energy.

雨中抬眸                 Close-up of a bamboo
                              hat, water droplets
                          condensing, dripping, and
                            splashing, dark rainy day,

========== 主合集 第 6 页 ==========

                            blurred background with
                               figure's face and green
                               foliage, teal color palette,
                          mysterious cinematic
                         atmosphere, strong
                           chiaroscuro lighting, face
                        obscured in shadow,
                          extremely shallow depth
                              of field, wet texture, Asian
                            aesthetic

划船                A boatman wearing a
                     bamboo hat, rowing a
                           small boat or bamboo
                                    raft, back view,
                            positioned in the lower
                           center of the frame. Misty
                             karst mountains with
                           layered peaks, shrouded
                                in thin mist. Extreme
                          minimalism, vast negative
                          space, profound solitude
                       and zen-like stillness.
                             Non-naturalistic dramatic
                            studio lighting, dark and
                      shadowy atmosphere,
                                     artificial light sculpting the
                       scene like a stage set.
                      Calm water surface
                               reflecting faint light.
                         Symmetrical composition,
                       muted desaturated tones.
                        Old film aesthetic, heavy
                                film grain, rough textured
                           cinematic quality.
                              Traditional Chinese ink
                             painting influence merged
                            with studio photography.
                          21:9 aspect ratio, high
                             contrast, ethereal yet
                          melancholic mood

桥上                   a cinematic scene from
                           the movie "eternal
                         sunshine of the spotless

========== 主合集 第 7 页 ==========

                         mind" shows two people
                           holding an umbrella
                          standing on top of a
                          stone arch bridge in a
                         chinese landscape,
                         surrounded by misty
                        mountains and lush
                           greenery. the background
                            features towering cliffs
                         covered with dense
                            vegetation, adding to its
                          dramatic effect. in front of
                      them is a river flowing
                          through a valley below. a
                       sense of mystery fills this
                              beautiful scene.

芦苇丛会谈            Two figures in traditional
                        Chinese costume,
                            silhouetted by intense
                              backlight, standing by a
                               riverside, positioned at
                           the left third of the frame.
                               Slightly wider lens
                           capturing more of the
                          environment. Below them
                                   is a turbulent, rapid river
                            with churning water.
                        Foreground features
                        swaying wild grass as
                             visual obstruction, adding
                         depth and immediacy.
                       Background features
                            blurred mountains or
                          cloud layers. Strong
                         golden backlight with
                           extensive highlight
                               clipping, outlining the
                               figures. Epic xianxia
                                style, dreamy and
                            ethereal atmosphere,
                       combined with a sense of
                        extreme zen-like solitude.
                           Film Texture: Gritty film
                              texture, 35mm film grain,

========== 主合集 第 8 页 ==========

                          bleach bypass
                          desaturated wasteland
                            tones, pushed processing
                             giving a grimy texture,
                           Technicolor process, high
                              saturation, rich vibrant
                              colors. Lighting: Strong
                               theatrical stage lighting,
                           high-key hard light, non-
                                naturalistic dramatic
                                 lighting, deep shadows
                            contrasting sharply with
                               highlights. Composition:
                         Cinematic composition,
                          21:9 aspect ratio, figure
                            positioned at left third,
                        swaying wild grass in
                           foreground.

远走                A lone horse rider in
                                traditional Chinese
                         costume, back view,
                          walking through a vast
                           white reed field. Reeds
                      sway in the wind with
                        dynamic movement and
                           depth. Distant misty
                        mountains and cloudy
                         sky in the background.
                           Vast, mysterious, with a
                       sense of extreme zen-like
                              solitude. Lighting: Strong
                               theatrical stage lighting,
                           high-key hard light,
                           intense backlight with
                           extensive highlight
                               clipping, yellowish
                          tungsten warm light, non-
                                naturalistic dramatic
                                 lighting. Film Texture:
                               Gritty film texture, 35mm
                                film grain, bleach bypass
                          desaturated wasteland
                            tones, pushed processing
                             giving a grimy texture,

========== 主合集 第 9 页 ==========

                           Technicolor process, high
                              saturation, rich vibrant
                              colors. Composition:
                         Cinematic composition,
                          21:9 aspect ratio,
                         emphasizing the contrast
                       between the rider and the
                           golden-white reeds.

女侠                   Female warrior in ancient
                         costume, figure height
                          approximately one-half of
                           the frame, positioned on
                           the right side, top of head
                              at upper quarter of frame.
                      Reeds in foreground left,
                          withered tree left edge,
                              waterfall background.
                    Shaw Brothers dramatic
                                style, mix of burlap and
                              satin costume. Intense
                            rear rim light, yellow
                          tungsten warm light, hard
                                   light, dark shadows.
                         Bleach bypass, high
                             contrast, 35mm gritty film
                              grain, highlight clipping.
                           Studio set, theatrical
                                 lighting.

远行                A white-robed
                        swordsperson standing
                            with back to the camera,
                            positioned on the right
                           side of the frame,
                            minimalist composition
                            with ample negative
                       space on the left.
                       Background features
                         wind-swept reeds, with
                              distant mountains further
                         beyond. 35mm gritty film
                              texture, intense rear rim
                                  light from behind or rear
                              side, creating strong

========== 主合集 第 10 页 ==========

                             silhouettes of the figure
                       and reeds. Wind blowing,
                         reeds and robes swaying
                            with dynamic motion.
                           Technicolor process, high
                              saturation, rich vibrant
                              colors. Solitary, vast,
                         wuxia atmosphere.

觐见                A traditional Chinese
                           courtyard in heavy
                             snowfall, thick snow
                            blanketing the ground.
                      The protagonist crouches
                                in a sword-drawing
                           preparatory stance, right
                       hand gripping the sword
                           handle, the blade still
                          sheathed, poised to
                                 strike. Surrounding
                       enemies encircle the
                             protagonist, all facing
                           inward, wielding swords
                       and blades, martial artists
                       and swordfighters in a
                             standoff. Wide-angle lens
                           capturing the courtyard
                         environment and the
                              encircling formation.
                          Texture & Atmosphere:
                        High contrast, cinematic
                                film still aesthetic,
                           blending realistic and
                              stylized visual
                           expression, rich
                                theatricality and mystery.
                           Intense localized lighting
                           creates a mysterious,
                          oppressive mood. Overall
                              cool, somber color palette
                            with low saturation.
                          Character Expression:
                      The protagonist and
                          surrounding enemies
                       have serious, fierce,

========== 主合集 第 11 页 ==========

                         focused expressions.
                         Snowflakes settle on
                         robes and weapons,
                        dynamic tension
                            palpable. Mood: Tense
                             standoff, perilous martial
                            world, the decisive
                     moment before action.

雨中竹林             A cinematic wuxia portrait
                                in exaggerated Shaw
                           Brothers style. Waist-up
                            framing. A mysterious
                              figure in a wide bamboo
                           hat that covers most of
                           the face, revealing only
                           the mouth and chin,
                         wearing a costume
                          mixing rough burlap and
                           glossy satin with
                               theatrical folds.
                        Asymmetric composition,
                              figure positioned right,
                       ample negative space
                                       left. Dense wet bamboo
                          leaves in foreground left
                        as leading lines and
                             visual obstruction.
                       Background a blurred
                          rocky wall. Non-
                                naturalistic theatrical
                                 lighting: intense rear rim
                                  light with yellowish
                          tungsten warmth, high-
                        key hard light, deep
                        shadows. Vintage film
                             stock: Eastmancolor,
                           Technicolor process, high
                              saturation, rich vibrant
                              colors. 35mm gritty grain,
                          high contrast. Highly
                                     artificial studio set,
                        soundstage atmosphere.
                     Medium to long focal
                             length, shallow depth of

========== 主合集 第 12 页 ==========

                                    field, sharp subject and
                          foreground leaves.
                             Minimalist, dramatic
                             tension, solitude.

骑白马全景        银鞍照白马，飒踏似流
             星。邵氏夸张戏剧风格，
             强烈侧逆光，发黄钨丝灯
             暖光，硬光，阴影浓重。
             漂白过曝，高对比度，
                  35mm 粗粝胶片颗粒，高
             光溢出。影棚置景，戏剧
             化布光，全景。


骑白马大远景       银鞍照白马，飒踏似流
             星。邵氏夸张戏剧风格，
             强烈侧逆光，发黄钨丝灯
             暖光，硬光，阴影浓重。
             漂白过曝，高对比度，
                  35mm 粗粝胶片颗粒，高
             光溢出。影棚置景，戏剧
             化布光，大远景。



雨中武士                    Lighting: Non-naturalistic
                               theatrical lighting, intense
                            rear rim light, overall dark
                       and shadow-heavy
                          scene, deep shadows
                            contrasting sharply with
                           the light beams, tragic
                       and dramatic
                         atmosphere. Film
                           Texture: Vintage film
                              grain, pushed processing,
                          high contrast, gritty
                              texture. Wet blood
                              texture, realistic skin and
                             clothing details. Setting:
                           Highly artificial
                        soundstage atmosphere,
                              forest and bamboo grove

========== 主合集 第 13 页 ==========

                        as studio-built backdrop
                            or props. Color Palette:
                        Dark tones of deep
                          green, dark blue, and
                            gray, with bright white to
                           pale yellow highlights.
                        Fresh red blood contrasts
                           sharply against the dark
                        background and bright
                                   light. The male's skin
                          tone is warm but appears
                           pale or dimmed due to
                                lighting and blood.
                        Atmosphere: Epic martial
                              arts style, dramatic and
                                tragic, realistic and
                            cinematic, mysterious
                       and heavy.

女侠客              A woman in white
                                traditional Chinese
                             martial arts attire
                          standing in a vast desert
                          landscape, facing the
                        camera, holding a
                               straight sword pointing
                                directly at the viewer,
                           dust swirling around, long
                           lens compression,
                        extreme low angle, fierce
                          gaze, windswept hair,
                           desert dunes and barren
                        mountains in background,
                           cinematic wide shot,
                  35mm film texture, heavy
                                film grain, bleach bypass
                              look, overexposed
                               highlights, strong
                             backlight with highlight
                               clipping, warm golden
                         ochre color palette, subtle
                                  light leak, faded dusty
                            tones, high contrast, gritty
                       pushed film processing
                             aesthetic, contemplative

========== 主合集 第 14 页 ==========

                              solitude, wuxia aesthetic,
                             zen-like stillness, shot on
                           vintage film stock, ultra
                              detailed, textured

手中剑              A close-up of a hand
                            gripping a samurai sword,
                          diagonal composition
                         from lower left to upper
                                  right, raindrops falling,
                          water droplets on the
                          blade and hand, blurred
                       deep blue-green forest
                         background, backlight or
                             side-backlight, cold color
                               palette, metallic sheen on
                           the blade, shallow depth
                              of field, tense and
                          mysterious atmosphere,
                            cinematic, dramatic,
                     moody



 岩井俊二《关于莉莉周的一切》影像风格提示词


主题与情绪       核心主题：青春期的孤独、疏离、迷茫与无声的情
            绪，少年心事的压抑与释放

            情绪基调：忧郁、安静、疏离、怀旧，带着淡淡的破
             碎感与自由感

             人物状态：少年少女的独处、沉默、无交流的同框，或
             是奔跑、放空等情绪宣泄的瞬间

视觉与光影        标志性色调：清冷的青蓝色/ 冷绿色调（夜戏）、暖
              金色的黄昏/ 日光（日戏），低饱和、高氛围感

             光影风格：强烈的侧逆光/ 逆光，形成剪影、镜头光
               晕（flare），明暗对比强烈，光影流动感

              画面质感：35mm 胶片颗粒感，轻微柔焦，部分镜头

========== 主合集 第 15 页 ==========

             带手持晃动的呼吸感，朦胧的空气感


场景与构图       经典场景：日本乡野（稻田、芦苇荡、乡间公路）、
             城市边缘（铁桥、电线杆、信号塔）、日常空间（电
             车、餐厅）

            构图逻辑：极简构图，大量留白，人物在画面中占比
             小以凸显孤独感；低机位仰拍、跟拍，强化代入感

             动态感：运动镜头（骑行跟拍、奔跑跟拍），窗外/
             背景的流动感，与静止的人物形成张力

风格标签          导演风格：岩井俊二（Iwai Shunji）美学，《关于莉
             莉周的一切》专属氛围

            镜头语言：电影感叙事，纪实感手持，情绪优先于剧
             情，用画面传递无声的情绪


             提示词          图片

总提示词                  cinematic still from *All
                        About Lily Chou-Chou*,
                            Iwai Shunji style,
                       Japanese youth
                             aesthetic, melancholic
                       and quiet mood,
                       unspoken loneliness,
                  35mm film grain, soft
                            focus, subtle handheld
                       camera shake,
                         atmospheric haze,
                           cool cyan-blue tone (for
                             night scenes) / warm
                         golden hour backlight (for
                       day scenes),
                           strong lens flare, long soft
                        shadows, muted
                          desaturated color palette,
                         minimal composition, vast
                           negative space, low
                          angle shot,
                       Japanese rural

========== 主合集 第 16 页 ==========

                           countryside / urban edge
                               setting, teenagers in
                          casual school clothes,
                          emotional storytelling,
                             cruel youth theme,
                          dreamlike and nostalgic
                         atmosphere,
                          shallow depth of field,
                           cinematic photography,
                         8K, hyperrealistic
                                --ar 16:9 --style raw --v 6

夜戏骑行/ 乡间公路        cinematic sequence from
                                 *All About Lily Chou-
                         Chou*, Iwai Shunji style,
                           three disaffected and
                                 listless young Japanese
                   men riding bicycles
                           aimlessly on a rural road
                              at night, deep cool green
                             night tone, dim ambient
                                   light, distant village lights
                       on the horizon, strong
                             backlight from bike
                             headlights, long
                        shadows, 35mm film
                              grain, handheld tracking
                           shot following the boys,
                         slow motion, melancholic
                          youth atmosphere,
                         minimal composition, vast
                          dark night sky, quiet and
                             free mood, --chaos 5 --ar
                           4:3 --raw --stylize 750 --
                          weird 13

麦田少女奔跑              cinematic still from *All
                        About Lily Chou-Chou*,
                            Iwai Shunji style,
                        documentary aesthetic,
                   A beautiful and slender
                       Japanese teenage girl
                            with delicate features,

========== 主合集 第 17 页 ==========

                         sharp clear face,
                          running freely from tall
                        green reeds into shallow
                            water, arms outstretched
                                wildly, dynamic running
                            posture,
                          her legs are long and
                                 thin, body slim,
                         motion blur on reeds and
                          water surface, her face
                     and upper body in
                       sharp focus , low angle
                             shot,
                             natural light filtering
                          through reed leaves, soft
                        green tones, low
                              saturation,
                  35mm film grain, subtle
                              texture, hazy
                         atmosphere,
                              backlight, lens flare,
                          melancholic and free
                       mood,
                          shallow depth of field,
                           vast greenery and water,
                                  realistic, hyperdetailed,
                         8K, --ar 16:9 --style raw --
                         s 250

少男少女麦田交换信物    Two young Japanese
                         people standing in the
                           foreground, central
                             position with one on the
                                      left and one on the right,
                            facing each other in
                           conversation, rural
                         landscape background
                            with vast farmland and
                              distant mountains or
                              buildings, natural lighting,
                          shallow depth of field,
                           focusing on the subjects.

========== 主合集 第 18 页 ==========

                   Warm yellow (golden rice
                                  fields), bright green
                            (crops) as main colors,
                            creating vivid contrast.
                    Low saturation clothing in
                             white, brown-red and
                             black. Pink flowers as
                           accents. Early digital
                          video or VHS film
                             aesthetic, nostalgic and
                          simple feel, slightly rough
                       image quality with digital
                          noise or video
                        compression artifacts,
                                 realistic photography
                                style, teenage interaction,
                          technology products
                         (handheld game console
                            or flip phone) in the
                          scene, rural daily life,
                             natural tones, film grain
                              texture, vintage
                        atmosphere

麦田忧郁少年              vast green wheat field
                         under clear blue sky,
                       Japanese teenage boy
                          standing alone,
                            Iwai Shunji aesthetic, All
                        About Lily Chou-Chou,
                          melancholic youth, quiet
                             loneliness,
                               soft daylight, gentle wind,
                               floating hair,
                                film grain, 35mm, muted
                           cool colors, cyan tint,
                        wide shot, small figure in
                       huge landscape,
                          shallow depth of field,
                            poetic and sad,
                           ether concept, glowing

========== 主合集 第 19 页 ==========

                                 faint light particles,
                           cinematic still,
                          atmospheric, 8K

少男少女轻轨听音乐        cinematic still from *All
                        About Lily Chou-Chou*,
                            Iwai Shunji style,
                   A nostalgic Japanese
                                train scene in late 1990s,
                        two teenagers sitting side
                        by side on a deep red
                            velvety train bench seat,
                   A young girl in white long-
                          sleeve shirt, dark pleated
                                   skirt, white socks, red
                        headphones, holding a
                           white Walkman,
                   A quiet boy in dark casual
                       wear with a backpack,
                                  sitting with head down,
                            looking at an object in his
                         hands,
                            Light-colored train interior
                              walls, warm afternoon
                             side-backlight streaming
                          through the windows,
                           Blurred green rice fields
                       and countryside passing
                        by outside the moving
                                  train,
                         Strong warm light and
                       deep cool shadows, lens
                                  flare,
                           Film grain texture, slightly
                          desaturated yet vivid
                            tones, rich deep red
                          seats and lush green
                                  fields,
                           Melancholic, quiet, and
                             nostalgic atmosphere,
                       unspoken distance

========== 主合集 第 20 页 ==========

                       between the two,
                               Slightly overhead angle,
                          candid medium-full shot,
                                naturalistic composition,
                       Japanese retro film
                             aesthetic, 35mm film still,
                                --ar 16:9 --style raw --v 6

少男少女餐厅吃饭          cinematic still from *All
                        About Lily Chou-Chou*,
                            Iwai Shunji style,
                        two Japanese teenagers
                                  sitting across each other
                                in a dimly lit retro
                            restaurant booth,
                      a quiet boy in a dark red
                           sweater, head bowed,
                           avoiding eye contact;
                      a long-haired girl in a
                          loose white blouse,
                            looking down at her food,
                           blue patterned tablecloth,
                            plates of seafood and
                        bread on the table,
                        orange juice in glasses,
                    warm low-key ambient
                                 lighting, soft shadows on
                           the wooden walls,
                       muted and desaturated
                             color palette, slightly
                            cool-toned,
                          tense and awkward
                            silence between them,
                       unspoken distance,
                                film grain, 35mm vintage
                       Japanese film texture,
                          shallow depth of field,
                                naturalistic, melancholic
                       and claustrophobic mood,
                     medium shot, cinematic

========== 主合集 第 21 页 ==========

                           composition, emotional
                                storytelling, 8K

奔跑正面特写             Cinematic portrait of two
                       young slender and
                             delicate East Asian
                         teenagers chasing and
                                frolicking on a rural road
                                in rural Japan, back view,
                             intimate and lively
                       moment. Left side: young
                       boy with short curly hair,
                         wearing white school
                            uniform, handsome and
                             delicate Asian facial
                            features (back view with
                            distinguishable curly
                                 hair). Right side: young
                                      girl with shoulder-length
                                 slightly curly hair, wearing
                           black school uniform,
                           elegant and delicate East
                         Asian beauty (back view
                            with soft curly hair
                            contours). In the
                            distance, a radio tower
                            with paper kites flying
                        around it, a rainbow in
                           the sky, 90s tv still, from
                       an episode of the girls
                           next door series, directed
                                in the style of steven
                             spielberg, soft dramatic
                                 lighting, shallow depth of
                                    field, moody cinematic
                         atmosphere, emotional
                           connection, professional

奔跑背影                 Cinematic portrait of two
                       young slender and
                             delicate East Asian
                         teenagers chasing and
                                frolicking on a rural road
                                in rural Japan, full back
                            view, extreme long shot,

========== 主合集 第 22 页 ==========

                                their figures are far away
                            (proportionate to the
                        extreme long shot, not
                           too tiny to be seen),
                             intimate and lively
                       moment, the girl running
                       ahead of the boy. Left
                              side: young boy with
                            short curly hair, wearing
                           white school uniform
                               (curly hair distinguishable
                       even from a distance),
                         chasing behind the girl.
                           Right side: young girl with
                           shoulder-length slightly
                              curly hair, wearing black
                          school uniform (soft curly
                              hair contours visible from
                                afar), running in front of
                           the boy. In the distance, a
                            radio tower with paper
                              kites flying around it, a
                         rainbow in the sky, 90s tv
                                            still, from an episode of
                           the girls next door series,
                            directed in the style of
                          steven spielberg, soft
                          dramatic lighting, shallow
                         depth of field, moody
                           cinematic atmosphere,
                          emotional connection,
                            professional
                          photography, film-like
                                quality, detailed textures,
                               rural Japanese scenery,
                                  lively and youthful vibe

奔跑远景              Two Japanese teenage
                        boys and girls in school
                          uniforms chasing and
                            playing wildly, chaotic
                       and restless movements,
                      a very tall 5G antenna
                          standing on top of the hill,
                              kites flying freely in the

========== 主合集 第 23 页 ==========

                            sky, a faint rainbow
                           crossing the sky,
                          captured in the chaotic
                       and fragmented visual
                               style of All About Lily
                       Chou-Chou, shaky
                        handheld DV footage,
                              violent tilt composition,
                        extreme backlight
                          overexposure, motion
                              blur and film grain, cold
                           blue-gray tones, sharp
                       and depressing
                        atmosphere in the style of
                         David Fincher, shot on
                                Arri Alexa with wide-
                          angle lens, high contrast,
                           cinematic texture,
                             restless youth aesthetic

车厢                   a medium shot of a
                       young east asian woman
                            with long dark hair,
                         wearing a green and
                           white patterned top,
                                  sitting with her knees
                          bent in the back of a
                               truck. she holds a peach
                                in her right hand. to her
                                       left, yellow crates filled
                            with peaches are visible.
                                in the background, a lush
                        green landscape with
                            trees and a flowing body
                              of water is present.

桃子                   a close up, slightly blurry
                           shot of peaches hanging
                       on a tree, surrounded by
                        green leaves. several
                                ripe, round peaches with
                           reddish orange skin are
                                 visible, some partially
                        obscured by the foliage.
                           the background is a soft

========== 主合集 第 24 页 ==========

                              blur of green, indicating
                      more leaves and possibly
                           other branches of the
                               tree.

摘桃子                 a close up, eye level shot
                      shows a woman with fair
                               skin, wearing a floral
                           patterned sun hat, long
                          sleeved shirt, and gloves,
                            looking down as she is
                       immersed in a green,
                              leafy natural
                          environment. her head is
                         angled slightly to the right
                            with her eyes looking
                         towards the bottom right
                              of the frame, and her
                       mouth slightly agape. her
                                      left arm is raised to the
                           top left. the background is
                      composed of out of focus
                        green foliage.

阳台                   a wide shot captures a
                       window looking out onto
                      a street with the ocean in
                           the distance. the window
                                   is adorned with white lace
                             curtains tied back at the
                              top. two articles of hang
                             inside the window: a
                           white short sleeved
                          blouse with blue floral
                         embroidery on the left,
                       and a blue garment on
                           the right, both on
                          hangers. the street
                           outside is paved and
                              lined with buildings, with
                      a clear sky above and a
                        calm blue ocean in the far
                         background.

========== 主合集 第 25 页 ==========

晾衣服女孩特写          a close up, low angle
                           shot of a young east
                          asian woman with dark
                              hair and fair skin, looking
                         upwards. her mouth is
                                 slightly open. she is
                         wearing a light colored
                          blouse with a green leaf
                            pattern and white polka
                             dots. her left arm is
                            raised above her head,
                        showing the patterned
                            sleeve. a white, textured
                             curtain or fabric is visible
                       on the left side of the
                          frame.



 岩井俊二《花与爱丽丝》影像风格提示词


主题与情绪     春日樱花与自然- 以盛开的樱花为主要视觉元素

          青春与学生生活- 包含穿着校服的人物,特别是学生群体

          宁静与美好- 整体情绪都是宁静、柔和、充满生机

          诗意与治愈- 带有诗意的生活气息和治愈系的氛围

情绪氛围      宁静平和- 没有强烈的情绪波动,整体氛围柔和

          清新自然- 充满春天的气息和自然的美感

          青春活力- 体现青春的美好与纯真

          诗意浪漫- 带有诗意的叙事感和浪漫气息

色彩风格      淡雅色调- 以淡紫色、粉色、白色为主

          低饱和度- 色彩饱和度适中偏低,显得柔和

          冷暖对比- 樱花的暖色调与人物、建筑的冷色调形成对比

          清新自然- 整体色彩清新自然,不刺眼

========== 主合集 第 26 页 ==========

光影特点      柔和自然光- 采用柔和的自然光,没有强烈的明暗对比

          均匀照明- 光线分布均匀,没有明显的强阴影

          通透质感- 樱花在光照下显得轻盈通透

          朦胧梦幻- 部分区域有柔焦或过曝效果,带来梦幻感

视觉元素      樱花树- 以盛开的樱花树为主要视觉元素

          人物点缀- 包含人物,特别是学生群体

          建筑与栏杆- 常见的桥梁、栏杆、建筑等人文元素

          自然与人文结合- 自然景观与人文环境的完美融合

场景特点      户外场景- 为户外拍摄

          樱花盛开- 春日樱花是主要的自然景观

          城市与自然结合- 常见桥梁、建筑、栏杆等城市元素

          花园与植物- 包含花园、植物等自然元素

构图特点      多层次构图- 前景、中景、背景层次分明

          引导线构图- 常用栏杆、建筑等元素引导视线

          对称与平衡- 人物和景物的布局讲究对称与平衡

          留白艺术- 大量留白营造空灵感

          景深效果- 强调景深和层次感

构图技巧      前景框架- 常用栏杆、建筑等元素作为前景框架

          中景主体- 樱花树或人物作为中景主体

          背景衬托- 建筑、天空等作为背景衬托

          视线引导- 通过元素布局引导观众视线

艺术影响      日系摄影- 典型的日系美学风格

          青春电影- 带有青春电影的叙事感

          自然摄影- 对自然美的捕捉与呈现

          人文摄影- 对人物与环境关系的思考

文化影响      青春文化- 体现青春的美好与纯真

========== 主合集 第 27 页 ==========

          自然文化- 对自然美的崇尚与追求

          生活文化- 对日常生活的诗意表达

          艺术文化- 对美的追求与创造

樱花树下会谈                   A realistic
                                     photography style
                                  image of two
                                        students in dark
                                       school uniforms
                                       walking from left
                                             to right in the
                                        foreground,
                                                 partially blocked
                                    by a railing. In the
                                     mid-ground and
                                      background, there
                                       are cherry
                                   blossom trees in
                                                           full bloom with
                                            delicate pink and
                                                   light purple
                                         flowers densely
                                        covering the entire
                                      canopy. On the
                                                right background,
                                         there is a tree with
                                  a birdhouse, its
                                       leaves colored in
                                        yellow-brown. The
                                     bottom of the
                                  image has a dark
                                                   railing. The overall
                                  image is slightly
                                              soft with subtle
                                          grain or film
                                             texture. Horizontal
                                        composition,
                                       foreground
                                        students and
                                                 railing form a
                                           horizontal band at
                                        the bottom of the
                                        frame. The main
                                         cherry blossom

========== 主合集 第 28 页 ==========

trees occupy most
of the frame
space, forming a
strong
background.
Figures positioned
at the bottom of
the image, forming
contrast with the
cherry blossoms
above, providing
depth of field.
Main color palette
includes cherry
blossom's delicate
pink and light
purple, blending
with the white sky
to create a bright,
soft atmosphere.
Dark-colored
student uniforms
contrast with the
background. Tree
branches in dark
brown or black.
Yellow-brown
leaves of the right-
side tree bring a
touch of warm
tone. Overall color
saturation is
moderate, leaning
towards soft and
fresh. Realistic
photography style
with a sense of
everyday scene,
slightly soft with
subtle grain or film
texture, horizontal
composition,
foreground figures
and railing, mid-
ground and

========== 主合集 第 29 页 ==========

                                    background cherry
                                   blossom trees,
                                     depth of field,
                                            delicate pink and
                                                   light purple cherry
                                      blossoms, dark
                                       school uniforms,
                                       dark railing,
                                       yellow-brown
                                          leaves, bright and
                                              soft atmosphere,
                                    moderate color
                                            saturation, soft
                                  and fresh, realistic
                                       photography,
                                     everyday scene,
                                                 slightly soft, subtle
                                          grain or film
                                           texture

樱花树空镜                     A realistic
                                     photography style
                                  image of blooming
                                         cherry blossoms
                                    as the main
                                            subject, flowers
                                      densely clustered
                                  and occupying
                                   most of the frame.
                                   Background
                                         includes dark tree
                                            trunks, green
                                          vegetation, metal
                                         fence, and cement
                                   quay below. The
                                     bottom of the
                                  image has dark
                                      water with minimal
                                               reflections. The
                                             overall style is
                                                  realistic
                                     photography with
                                          subtle grain and
                                    hazy effect,
                                          possibly from a

========== 主合集 第 30 页 ==========

video screenshot
or old equipment
shooting effect.
Light effects are
slightly prominent
with obvious
horizontal light
flares or glare,
creating a dreamy
or nostalgic
atmosphere.
Composition:
cherry blossom
branches extend
inward from the
top and sides of
the frame, forming
a natural frame.
Flowers cover the
foreground and
mid-ground,
background
elements (fence,
trees, quay)
provide depth.
Eye-level
perspective,
close-up view of
cherry blossoms
interacting with
the environment.
Cherry blossoms
present bright light
purple or lavender
tones, locally
appearing white
due to strong light.
Background in
dark green, dark
gray, and brown,
forming strong
contrast with
bright cherry
blossoms. Water
surface in dark

========== 主合集 第 31 页 ==========

gray or black,
overall color tone
leaning towards
dark but cherry
blossom areas are
bright. Overall
color saturation is
moderate, leaning
towards cool
tones, with fresh
and serene
feeling. Realistic
photography style
with subtle grain
and hazy effect,
horizontal light
flares or glare,
dreamy or
nostalgic
atmosphere,
composition with
cherry blossom
branches forming
natural frame,
foreground and
mid-ground
flowers,
background
elements
providing depth,
eye-level
perspective,
close-up view,
bright light purple
or lavender cherry
blossoms, dark
tree trunks, green
vegetation, metal
fence, cement
quay, dark water
with minimal
reflections, strong
contrast,
moderate color
saturation, cool

========== 主合集 第 32 页 ==========

                                         tones, fresh and
                                       serene, realistic
                                       photography,
                                          subtle grain, hazy
                                                effect, dreamy
                                     atmosphere,
                                           nostalgic
                                    atmosphere

正面奔跑                        Two Japanese
                                       school students in
                                       dark uniforms
                                       running
                                        dynamically on a
                                      curved paved
                                         road, one holding
                                  a dark backpack.
                                    Blooming cherry
                                   blossom trees with
                                                   light purple
                                         flowers in
                                      background,
                                         airborne petals
                                         scattered in air.
                                    Dark fences and
                                     shrubs visible.
                                       Vintage film
                                     photography style
                                          with grain and soft
                                          focus, slightly
                                     faded colors. Cool
                                           color tone with
                                                   light purple cherry
                                      blossoms, navy
                                        blue uniforms,
                                   brown tree trunks,
                                                   light gray roads.
                               Open composition
                                          with natural
                                     frames from tree
                                      branches, curved
                                     road adding
                                         depth. Bright soft
                                             daylight, youthful
                                  and energetic

========== 主合集 第 33 页 ==========

                                     atmosphere,
                                    spontaneous
                               moment captured.

站台双生少女                         two young women 运镜：缓慢推近，
                                      stand in profile,   轻微呼吸感晃动日
                                         looking upward                            系胶片电影质感，
                                          with smiles, on a
                            冬日黄昏的火车站                                                train platform. the
                            台，两个短发少女                             woman on the left
                                   wears a dark coat  并肩站着，仰起头
                                  and a striped    望向远方，画面呈
                                         purple and pink                            现朦胧的紫调，铁
                                              scarf. the woman                            轨与电线杆在背景
                                  on the right wears
                            虚化，镜头缓慢推                                  a dark coat and a
                                       red scarf. both   近，捕捉两人温柔
                                   have dark hair.   的侧脸与微笑，传
                                      behind them are  递出青春独有的怅
                                                train tracks                            惘与希望氛围。
                                       extending into the
                                        distance under an
                                        overcast or hazy
                                          sky. utility poles
                                  and overhead
                                        wires are visible in
                                        the background,
                                     which is blurred.
                                        the overall lighting
                                                    is soft, with a cool,
                                                 slightly blue tint. --
                                          ar 9:5

车厢依偎少女                         two young women 运镜：固定机位，
                                       are sitting on a   轻微呼吸感晃动日
                                                   train, illuminated                            系胶片电影质感，
                                    by natural light
                            冬日列车车厢内，                                      from the windows.
                            两个少女依偎在一                                        the woman on the
                                                          left, with dark hair  起，其中一个靠在
                                  and bangs, is   对方肩上熟睡，红
                                         leaning her head                            色座椅与窗外的冷
                                  on the shoulder of                            色调形成对比，画
                                        the woman on the
                            面带有复古胶片颗                                                   right. she wears a

========== 主合集 第 34 页 ==========

                                       dark coat and a   粒感，整体色调偏
                                          multicolored    清冷的蓝调，镜头
                                            striped scarf in                            固定不动，仅捕捉
                                   shades of purple,
                            车厢轻微晃动与少                                            pink, and black.
                            女安静的状态，传                                       her right hand,
                                      wearing a pink   递出温暖治愈的氛
                                       glove with a floral  围。
                                            pattern, rests on a
                                       dark bag. the
                             woman on the
                                                   right, also with
                                       dark hair, wears a
                                       dark coat and a
                                       red and black
                                              scarf. she has a
                                             plaid green and
                                         yellow glove on
                                       her right hand and
                                                    is looking to the
                                                          left. the seats are
                                        upholstered in a
                                  deep red fabric.
                                        the train interior is
                                        white with large
                                     windows, showing
                                  a blurred blue sky
                                          or distant
                                     landscape
                                           outside. --ar 20:11

举相机的少女                       a medium shot   运镜：缓慢推近，
                                          features a young  轻微呼吸感晃动日
                                       person, partially                            系胶片电影特写镜
                                    obscured by a
                            头，穿彩色针织手                                                vertical metal
                            套的少女举着银色                                           structure on the
                                                          left, looking    相机，镜头从相机
                                               directly at the   上方露出眼睛，背
                                       viewer while                            景是生锈的墙面与
                                         holding a silver                            朦胧的粉紫色天
                                           point and shoot
                            空，画面带有复古                                  camera to their
                                           face. they are   胶片颗粒感，整体
                                      wearing pink    色调偏清冷的粉紫

========== 主合集 第 35 页 ==========

                                       gloves with a    调，镜头缓慢推
                                          subtle pattern and 近，捕捉少女专注
                                  a dark top with red                            的眼神，传递出文
                                             stripes or accents.
                            艺又安静的氛围。                                        the background on
                                        the right is blurred,
                                    showing soft
                                         purple and gray
                                         tones. the metal
                                           structure on the
                                                        left is weathered
                                          with visible rust
                                  and wear. --ar 9:5



 岩井俊二《燕尾蝶》影像风格提示词


         图片       图片提示词    视频提示词

睡颜特写                           a close up, low   运镜：缓慢推近，
                                         angle, portrait   轻微呼吸感晃动日
                                              style shot of a                            系电影特写镜头，
                                   young east asian
                            低饱和柔调，少女                                                        girl with her eyes
                            闭眼熟睡的侧脸，                                          closed, asleep.
                                       her left arm is   皮肤被暖调光影晕
                                                visible on the    染，发丝自然垂
                                     bottom left, resting                            落，画面带有复古
                                      across her body,                            胶片颗粒感与朦胧
                                  and her hands are
                            柔焦光晕，整体色                                      clasped together.
                                       her hair is dark,   调偏清冷绿调，镜
                                           shiny, and pushed 头缓慢推近，捕捉
                                    back from her   少女安静柔和的睡
                                        forehead. a bright                            颜，传递出静谧温
                                    cyan glow comes
                            柔的氛围。
                                      from the bottom
                                                          left, creating
                                            highlights on her
                                 arm and the lower
                                            part of her face,

========== 主合集 第 36 页 ==========

                                          with a hint of
                               warm orange light
                                  on the upper right,
                                      near her hair. the
                                    background is
                                       dark and out of
                                          focus.

窗边碎花裙少女                     a medium shot of  运镜：固定机位，
                                  a young woman  轻微呼吸感晃动日
                                          with short, dark                            系胶片电影质感，
                                                hair, wearing a
                            室内窗边，穿白色                                        white sundress
                            碎花连衣裙的少女                                          with small red
                                                    floral patterns. she 靠在百叶窗前，双
                                                    is leaning against  臂张开，笑容明
                                  a light green wall,                            媚，百叶窗的光影
                                          with her arms                            在她身上形成条纹
                                         stretched out
                            光斑，背景是浅绿                                              horizontally. her
                                                        left hand is near a 色墙面，画面带有
                                  window with    复古胶片颗粒感与
                                           horizontal blinds,  柔焦光晕，整体色
                                  and her right hand                            调偏暖调，镜头固
                                                    is out of frame to
                            定不动，仅捕捉少
                                        the right. she is
                            女放松舒展的状                                          smiling and
                                         looking down and  态，传递出慵懒治
                                             to her right. a red  愈的氛围。
                                     purse with a
                                   brown handle is
                                                visible in the
                                     bottom right
                                        corner of the
                                        frame.

========== 主合集 第 37 页 ==========

 乔・赖特《赎罪》影像风格提示词


视觉特征     动态模糊美学：所有照片都使用了运动
          模糊/慢快门技术，营造梦幻流动感

         自然光线：柔和的自然日光，色调温暖
         明亮

         户外草地场景：绿色草坪作为主要背景

          白色/浅色服装：人物穿着飘逸的白色或
         浅色连衣裙

         电影感构图：宽幅比例，电影般的叙事
         氛围


情绪氛围     自由、轻盈、诗意

         田园牧歌式的浪漫

         时间流逝的梦幻感

Midjourney 通用   Dreamy motion blur photography,
提示词          woman in flowing white dress running
                   through sunlit green meadow, soft
                      natural daylight, cinematic wide
                    composition, ethereal and romantic
                   atmosphere, slow shutter speed effect,
                     pastoral scene, film photography
                      aesthetic, warm color grading, poetic
                 and free-spirited mood --ar 16:9 --style
                 raw --v 6

女子拿花束奔跑1                      Cinematic triptych
                                     sequence, motion
                                             blur of woman in
                                         vintage white
                                      dress moving
                                       through green
                                               forest, slow
                                           shutter speed,
                                  dreamy
                                     atmosphere,
                                           natural lighting,
                                                film grain texture,
                                                vertical

========== 主合集 第 38 页 ==========

                                        composition,
                                       romantic and free-
                                               spirited mood, art
                                  house cinema
                                          aesthetic

女子拿花术奔跑2                      Cinematic triptych
                                     sequence, motion
                                             blur of woman in
                                         vintage white
                                      dress moving
                                       through green
                                               forest, slow
                                           shutter speed,
                                  dreamy
                                     atmosphere,
                                           natural lighting,
                                                film grain texture,
                                                vertical
                                        composition,
                                       romantic and free-
                                               spirited mood, art
                                  house cinema
                                          aesthetic

带针织帽的女孩近                      Cinematic medium
景                                      close-up shot of a
                                   young girl in a
                                  1930s vintage
                                        white embroidered
                                 swim cap and
                                             knitted white
                                         swimsuit, standing
                                                in a sun-dappled
                                        English wildflower
                              meadow filled with
                               Queen Anne's
                                             lace, soft backlit
                                      golden afternoon
                                            sunlight creating
                                         gentle rim light on
                                       her face and
                                         shoulders, shallow
                                     depth of field,
                                       foreground and

========== 主合集 第 39 页 ==========

                                    background out-
                                          of-focus white
                                          wildflowers
                                       framing the
                                            subject, a blurred
                                        blue fabric on the
                                                right side of the
                                        frame, film still
                                      from the movie
                                     Atonement, soft
                                  and dreamy
                                     atmosphere,
                                  muted warm
                                     green and cream
                                           color grading,
                           35mm film grain,
                                           nostalgic summer
                                               feeling, Terrence
                                          Malick-inspired
                                     cinematography

带针织帽的女孩远                   a girl in the grass,
景                                    wearing a white
                                            cloth hat and
                                       walking through
                                                             tall, wild flowers.
                                        white blooming
                                      yarrow plants are
                                      everywhere, in the
                                              style of daz3d. this
                                                    is a still from a
                                wes anderson
                                      movie, with a
                                              hyper-realistic,
                                              film-grain
                                            aesthetic.

带针织帽的女孩全                A sun-dappled
景                                       vintage summer
                                      scene, a floating
                                        white wooden
                                    dock on a calm
                                            lake, a man
                                        lounging on a
                                              retro white canopy

========== 主合集 第 40 页 ==========

                                    deck chair, a
                             woman in a white
                                       swimsuit lying
                                        relaxed on a
                                wooden diving
                                        board, mirror-like
                                         lake water
                                              reflecting the
                                       dock, figures and
                                         lush green trees,
                               warm golden
                                        afternoon sunlight
                                                    filtering through
                                  dense foliage, soft
                                     dappled light,
                                           nostalgic 1930s
                                            aesthetic,
                                        cinematic still from
                                     Atonement, soft
                                          focus, film grain,
                                  muted warm
                                     green and golden
                                         tones, idyllic and
                                  dreamy
                                     atmosphere,
                           35mm film
                                       photography,
                                       wide-angle shot.

水下睡莲少女                       a woman with   运镜：缓慢推近，
                                       dark hair is shown 轻微呼吸感晃动电
                                                in profile, partially                            影质感水下镜头，
                                  submerged
                            清冷青调，少女在
                                       underwater. her
                            水中缓慢漂浮，发                                  head and
                                       shoulders are   丝随水流飘动，周
                                                visible against a  围环绕着睡莲叶
                                       greenish blue                            片，阳光透过水面
                                         aquatic                            洒下光束，水中带
                                      background.
                            有气泡和柔焦光                                         several plant
                                   stems and lily   晕，画面带有轻微
                                   pads are visible  胶片颗粒，整体色
                                      behind her.    调偏清冷的青绿
                                      bubbles and light                            色，镜头缓慢推

========== 主合集 第 41 页 ==========

                                             reflections are   近，捕捉少女静谧
                                         scattered across  的侧脸与水下光
                                        the water. the                            影，传递出梦幻又
                                     bottom right
                            疏离的氛围。                                        corner features a
                                       red

睡莲池水面                         a close up, eye   运镜：固定机位，
                                              level shot of a   水面自然波动电影
                                        person's right arm                            质感空镜，暖调柔
                                  and hand
                            光，睡莲池水面波
                                     extended over a
                            光粼粼，白色睡莲                                   body of water,
                                          with their palm   与荷叶随水波轻轻
                                          facing down,    晃动，阳光在水面
                                      almost touching                            洒下金色光斑，画
                                        the water's                            面带有柔焦光晕和
                                          surface. the
                            轻微胶片颗粒，整                                       hand's reflection is
                                                visible in the calm  体色调偏暖绿，镜
                                         water. to the left, a 头固定不动，仅捕
                                                   light colo lily    捉水面波纹与睡莲
                                                 floats, partially                            的自然晃动，营造
                                    submerged, on a
                            静谧治愈的氛围。
                                     green lily pad. the
                                    background
                                          consists of a
                                     muted, light
                                        colored concrete
                                            wall or structure,
                                          with some soft
                                                   light illuminating it
                                      from above. the
                                      water has a slight
                                     green tint and
                                    appears still.

喷泉边的女子                       a medium shot   运镜：缓慢推近，
                                       captures a woman 轻微呼吸感晃动欧
                                                  sitting on the edge                            式古典爱情电影质
                                             of a stone
                            感，花园喷泉场
                                            fountain, looking
                            景，穿白色蕾丝裙                                       over her shoulder
                                      towards the    的女子坐在喷泉
                                          viewer. she has  边，回头望向镜

========== 主合集 第 42 页 ==========

                                          dark, wavy hair   头，身旁摆着金色
                                  and is wearing a  奖杯与花束，背景
                                                   light colored,                            是正在喷水的石雕
                                          possibly sheer,
                            喷泉，画面带复古                                        long sleeved top
                            胶片颗粒感与柔焦                                  and a matching
                                                   skirt with a high   光晕，整体色调偏
                                                              slit her leg. to her  暖调，镜头缓慢推
                                                          left, an ornate,                            近，捕捉女子慵懒
                                        gold and white                            又魅惑的神态，传
                                            pitcher or vase
                            递出浪漫又优雅的                                          with a handle and
                                  a dark liquid inside 氛围。
                                                  sits on the
                                            fountain's edge.
                                      behind her, the
                                         elaborate carvings
                                             of the stone
                                          fountain are
                                                 visible, and in the
                                    background to her
                                                   right, a blurred
                                     person with a blue
                                       sleeve and a pile
                                             of light colored
                                         flowers are
                                          present. the
                                             overall lighting
                                     suggests an
                                       outdoor setting
                                         during daytime.

花园低头的女子                     a close up, eye   运镜：缓慢推近，
                                              level shot     轻微呼吸感晃动欧
                                       captures a young                            式古典爱情电影质
                             woman with
                            感，夏日花园场
                                      brown, curly hair
                            景，穿碎花洋裙的                                         looking down, her
                                  mouth slightly   卷发女子低头看向
                                     agape, wearing a  身前的男子，背景
                                  cream colored,                            是朦胧的绿意，阳
                                           collared shirt with                            光透过树叶洒下斑
                                  a floral pattern, in
                            驳光影，画面带复                                        the foreground on
                                        the left, an out of  古胶片颗粒感与柔

========== 主合集 第 43 页 ==========

                                       focus man in a   焦光晕，整体色调
                                        blue shirt is visible 偏暖绿调，镜头缓
                                  on the right, and                            慢推近，捕捉女子
                                        the background is
                            温柔的神态，传递                                  a blurry green
                            出暧昧又心动的氛                                                     field.
                            围。

花园对视的情侣                     a medium close  运镜：缓慢拉远，
                                  up shot focuses  轻微呼吸感晃动欧
                                  on a man with                            式古典爱情电影质
                                       dark hair and a
                            感，夏日花园场
                                                   light blue collared
                            景，穿条纹衬衫的                                                    shirt, facing right
                                          with a serious   男子与卷发女子面
                                         expression. his   对面站着，背景是
                                    eyes are fixed on                            朦胧的绿意，阳光
                                  a woman partially                            透过树叶洒下斑驳
                                                visible on the left,
                            光影，画面带复古                                       her back to the
                                    camera. her    胶片颗粒感与柔焦
                                      brown, curly hair  光晕，整体色调偏
                                                    is prominent, and  暖绿调，镜头缓慢
                                   she wears a light                            拉远，捕捉两人对
                                        colored top with a
                            视的侧影，传递出
                                                  faint floral or
                            温柔又暧昧的氛                                        patterned design.
                                        the background is  围。
                                                softly blurred,
                                    showing green
                                             foliage and hints
                                             of sunlight,
                                          creating a gentle
                                       outdoor setting.

石桥上的复古敞篷                   a pale vintage car  运镜：高空俯拍，
车                                                 is driving left to   缓慢跟车推进欧式
                                                right across a                            复古爱情电影质
                                      stone arched
                            感，夏日午后的英                                         bridge that spans
                            式乡村，阳光洒在                                  a lush green
                                     landscape under a 绿油油的田野与古
                                             bright sky. the   老石桥上，米白色
                                     road continues as                            复古敞篷车正驶过
                                  a winding path

========== 主合集 第 44 页 ==========

                                       through fields   石桥，镜头从高空
                                      bordered by    俯拍，缓慢跟车推
                                      fences and tall                            进，画面带有柔焦
                                          trees on either
                            光晕与轻微胶片颗                                             side. the bridge
                            粒感，整体色调偏                                          features stone
                                        balustrades and  暖绿调，捕捉车在
                                         decorative finials  田园间穿行的动
                                             at its ends. the                            态，传递出浪漫又
                                             overall scene                            治愈的氛围。
                                         depicts a serene,
                                          pastoral setting
                                          with historical
                                             architectural
                                     elements and a
                                            classic vehicle.

玫瑰隧道中的少女                   a young person   运镜：缓慢跟拍推
                                          with short blonde  进，轻微呼吸感晃
                                                hair, seen from                           动欧式复古童话电
                                        behind, walks
                            影质感，夏日花园
                                       through a lush,
                            里，穿米白色连衣                                        verdant garden
                                      archway. the    裙的金发少女走进
                                     person wears a   由玫瑰与绿植构成
                                                   light colored, short                            的拱形隧道，镜头
                                      sleeved top with a                            从她身后缓慢跟拍
                                               collar and buttons
                            推进，阳光透过枝                               down the back.
                                        the archway is   叶洒下斑驳光影，
                                      densely covered  花瓣在微风中轻轻
                                                in green foliage   晃动，画面带有柔
                                  and adorned with                            焦光晕与轻微胶片
                                  numerous white
                            颗粒感，整体色调
                                  and yellow
                            偏清新暖调，传递                                            flowers, creating a
                                         tunnel like effect.  出梦幻又治愈的氛
                                        the path ahead is  围。
                                         also green and
                                       leads into a
                                              brighter, less
                                        defined area. the
                                             overall scene is
                                             bright and filled
                                          with natural light,

========== 主合集 第 45 页 ==========

                                     emphasizing the
                                      greenery and
                                                    floral details.

乡间小路的复古敞                   a pale yellow    运镜：正面跟拍，
篷车                                    vintage      轻微镜头晃动欧式
                                           convertible car,                            复古公路电影质
                                          with a prominent
                            感，夏日乡间小                                  chrome grille and
                            路，米黄色复古敞                                    two large
                                           headlights, drives  篷车载着两人，正
                                  on a narrow,    迎着镜头驶来，背
                                  unpaved road                            景是金黄的草甸与
                                       through a grassy,                            起伏的山丘，镜头
                                                sunlit field. two
                            正面跟拍，带有轻                                      people are visible
                                                in the car; the   微呼吸感晃动，画
                                             driver wears a   面带有柔焦光晕与
                                             visor and the    轻微胶片颗粒感，
                                    passenger wears                            整体色调偏暖黄
                                  a flat cap. the
                            调，捕捉车在乡间
                                             car's license plate
                            行驶的动态，传递                                     reads "byg 7". the
                                     road is flanked by  出自由又浪漫的氛
                                     green and golden  围。
                                                fields under a
                                             bright sky.

女子花园抽烟                       a side profile shot  复古英伦爱情电影
                                             of a woman with  质感，朦胧柔光，
                                          dark, curly hair                            春日花园场景。穿
                                  and fair skin,
                            碎花洋裙的卷发女                                         looking down,
                            子侧身而立，低头                                         holding a lit
                                            cigarette between  轻嗅身旁的花束，
                                       her fingers with   指尖夹着香烟，烟
                                smoke rising. she                            雾在她面前缓缓飘
                                                    is wearing a light                            散，背景是虚化的
                                          colored, sheer
                            绿意与繁花。画面                                      blouse with a floral
                                          or patterned    带有柔焦光晕与复
                                         design. to her left  古胶片颗粒感，整
                                                    is a large     体色调偏清新柔粉
                                    arrangement of                            调，镜头缓慢推
                                         various flowers,

========== 主合集 第 46 页 ==========

                                           including     近，捕捉女子温柔
                                      prominent pink   又怅惘的神态，传
                                        peonies, blue                            递出浪漫又略带忧
                                             bellflowers, and
                            伤的氛围。                                        white
                                    snapdragons or
                                          foxgloves, along
                                          with smaller
                                         purple and white
                                   blooms and green
                                               foliage. the
                                    background is
                                          blurred green
                                               foliage,
                                       suggesting an
                                       outdoor garden
                                               setting. the
                                       composition is a
                                medium close up,
                                        focusing on the
                             woman and the
                                          flower
                                      arrangement. --ar
                                     23:15

化妆镜前回眸                       a medium shot   运镜：缓慢推近，
                                      from behind    轻微呼吸感晃动复
                                 shows a woman                            古英伦电影质感，
                                          with her back
                            暖调柔光，复古化                                       mostly facing the
                            妆镜前，穿墨绿色                                          viewer, wearing a
                                     green backless   吊带礼服的女人回
                                          spaghetti strap   头看向身后，露出
                                         dress. her dark                            优雅的背部线条，
                                             hair is pulled up.                            身后穿黑色燕尾服
                                       her back,
                            的男人站在门口，                                          displaying visible
                                       shoulder blades  背景是昏黄的台灯
                                  and a mole on her 与摆满化妆品的梳
                                       lower back, is   妆台，光影在人物
                                           illuminated by                            身上流动，整体色
                               warm light. to the
                            调偏暖黄，画面带
                                                          left, a wooden
                            有复古胶片颗粒感                                        dressing table is
                                     covered with    与柔焦光晕，镜头

========== 主合集 第 47 页 ==========

                                         various objects,  缓慢推近，捕捉女
                                           including a mirror  人回眸的瞬间，传
                                              reflecting a blurry                            递出暧昧又紧张的
                                        white shape, a
                            氛围。                                   lamp with a
                                          textured shade, a
                                    vase with flowers,
                                  and many small
                                          items. a white
                                            cloth is draped
                                       over a chair or
                                            part of the table
                                  on the far left. the
                                    background
                                          features patterned
                                        wallpaper and soft
                                                 lighting. --ar 9:4

走廊前行                           a medium shot   运镜：缓慢跟拍，
                                          features a woman 轻微呼吸感晃动复
                                                in a dark green                            古英伦电影质感，
                                      dress facing
                            暖调柔光，幽暗的                                       forward in the
                            木质走廊里，穿墨                                        foreground, with a
                             man in a black   绿色礼服的女人向
                                      tuxedo and bow  前走，身后穿黑色
                                                     tie walking behind                            燕尾服的男人紧随
                                       her to the left. the                            其后，背景是昏黄
                                   scene takes place
                            的台灯与复古雕花                                          indoors, with
                               warm lighting    装饰，光影在人物
                                             illuminating    身上流动，整体色
                                wooden paneling  调偏暖黄，画面带
                                  and a tall, elegant                            有复古胶片颗粒感
                                                floor lamp with a
                            与柔焦光晕，镜头
                                        pleated shade on
                            缓慢跟拍，捕捉两                                        the right. an
                                     arched doorway is 人前行的身影，传
                                                visible in the blurry 递出暧昧又紧张的
                                    background on the 氛围。
                                                          left. --ar 37:16

窗台前照镜子的少                   a medium shot   运镜：缓慢推近，
女                                       features a woman 轻微呼吸感晃动欧
                                            reflected in a

========== 主合集 第 48 页 ==========

                                          gilded mirror,    式古典爱情电影质
                                                visible from the   感，暖调柔光，贵
                                       chest up. she has                            族宅邸梳妆镜前场
                                             short, dark, curly
                            景。穿刺绣洋裙的                                             hair and fair skin,
                            卷发女子坐在镜子                                          with a light pink lip
                                              color. her     前，抬手整理耳
                                       expression is calm 饰，眼神沉静望向
                                    as she gazes                            镜中，背景是朦胧
                                               directly forward,                            的水晶吊灯、雕花
                                       her right hand
                            镜框与淡绿色墙                                          gently touching
                                       her hair. she    面，前景虚化的鲜
                                   wears a light    花与光斑营造朦胧
                                        colored patterned  氛围，画面带有柔
                                        top or dress. in                            焦光晕与复古胶片
                                               front of her, a
                            颗粒感，镜头缓慢
                                    bouquet of white
                            推近，捕捉她精致                                         flowers and green
                                             foliage partially   的侧颜与镜中倒
                                     obscures the    影，传递出优雅又
                                       lower part of her  略带忧郁的氛围
                                                reflection. the                            感。
                                           mirror itself has an
                                          ornate, golden
                                        frame. in the
                                        foreground, out of
                                          focus, a crystal
                                         chandelier is
                                                visible on the left,
                                            contributing to a
                                                  soft, ethereal
                                     ambiance. the
                                    background inside
                                        the mirror is a
                                               brightly lit, blurred
                                                 interior with hints
                                             of green and other
                                             colors, suggesting
                                  a room with
                                           natural light.

男子抬手递出物品                   a full shot shows a 运镜：缓慢推近，
                             man in a light blue 轻微呼吸感晃动英
                                           collared shirt and                            式复古爱情电影质

========== 主合集 第 49 页 ==========

                                       dark pants lighting 感，暖调柔光，午
                                  a cigarette for a  后庄园石阶场景。
                             woman in a light                            穿印花洋裙的卷发
                                   brown dress
                            女子抱着金色花                                         holding a large,
                            瓶，与穿衬衫背带                                        ornate golden
                                    vase filled with   裤的男子面对面站
                                               colorful flowers.  在石阶上，男子抬
                                        they stand on a                            手递出物品，背景
                                      stone patio with                            是葱郁的花园与斑
                                       steps leading up
                            驳阳光，画面带有                                      behind them,
                                         flanked by stone  柔焦光晕与复古胶
                                          walls covered in  片颗粒感，镜头缓
                                     green foliage    慢推近，捕捉两人
                                     under a bright sky.                            对视的张力与花瓶
                                        the scene is
                            里的鲜花细节，传
                                       outdoors with lush
                            递出暧昧又充满宿                                      greenery in the
                                      background.    命感的氛围。



 库布里克科幻风提示词

色彩风格:         冷色调主导- 蓝色、灰色、白色为主

              高对比度- 明暗对比强烈

              低饱和度- 色彩纯净而克制

              金属质感- 空间站、飞船的金属光泽

光影特点:         自然光效- 模拟真实太空光照

              柔和阴影- 无强烈明暗对比

              均匀照明- 空间站内部的均匀光线

             太空环境光- 宇宙背景的漫射光

视觉元素:         几何构图- 圆形、环形、对称结构

              机械细节- 精密的太空设备与装置

========== 主合集 第 50 页 ==========

              纯净背景- 大量留白与负空间

             未来主义设计- 简洁而功能性的太空舱

构图特点:         对称构图- 强调秩序与理性

             低角度仰视- 突出空间站的宏伟

              广角镜头- 展现宇宙的浩瀚

              长镜头- 延续时间的流动感

              留白艺术- 大量太空背景的运用


             提示词          图片

空间站              A massive double-ring
                       space station with intricate
                         mechanical structures and
                          evenly distributed windows
                            or lights, positioned on the
                                      left side of the frame, a
                            large planet with cloud
                            layers and surface
                            textures on the right side,
                       deep space with scattered
                               stars, dramatic lighting
                         from the left illuminating
                           the space station with
                             clear shadows and three-
                            dimensionality, planet
                                softly lit, epic sci-fi space
                              epic, monumental and
                                  futuristic aesthetic,
                                 realistic style inspired by
                             classic sci-fi films like
                         2001: A Space Odyssey,
                          gray metallic space station
                            with white or pale blue
                                  lights, interior structures
                            with subtle red/coral tones,
                            planet in soft cyan-green,
                           pale blue and white
                          (clouds/atmosphere) with
                       deep green or brown
                             textures, bright space

========== 主合集 第 51 页 ==========

                              station lights and planet
                            contrasting with dark
                        cosmic background, vast,
                          serene, technological
                        atmosphere with a touch
                              of solitude, cinematic
                           composition, 1960s-70s
                              retro-futurism influence

海报                A retro-futuristic sci-fi
                        movie poster for "2001: A
                      Space Odyssey" featuring
                      a massive rotating ring-
                       shaped space station with
                        modular design and
                             central docking port, a
                           sleek white spacecraft
                         approaching the station
                           center with bright blue light
                    beam connecting them,
                          Earth and asteroid/moon
                                in background, deep
                       space with stars, hand-
                       drawn illustration style,
                         mechanical details,
                          diagonal composition,
                              bright white and gray
                           spacecraft against dark
                            blue-purple-black cosmic
                         background, yellow text
                          "2001: A SPACE
                     ODYSSEY", vintage sci-fi
                                art style, strong color
                             contrast, cinematic
                         atmosphere, 1960s retro-
                            futurism

宇航员              A lone astronaut in bright
                          red spacesuit with red
                           helmet, back to camera,
                       one hand raised upward
                           holding a metal object,
                        orange complex
                         mechanical backpack on
                          back, standing in a

========== 主合集 第 52 页 ==========

geometric octagonal
space station corridor,
pure white walls with
regularly arranged black
rectangular panels,
astronaut suit with fabric
wrinkles, detailed
backpack, small labels
and square holes on
corridor walls, strong
futureism and space
exploration theme, retro-
futurism aesthetic from
mid-20th century sci-fi
films, minimalist design,
clean and simple
environment, cinematic
composition with dramatic
lighting, linear perspective
creating depth from near
to far, octagonal corridor
structure forming
repeating geometric
patterns and symmetrical
visual effects, low angle
emphasizing corridor
height and astronaut's
stature, vibrant red
(spacesuit), pure white
(corridor), black (panels)
creating strong high
contrast, orange
(backpack), metallic gray
(handheld object and
boots), medium-high color
saturation especially red,
red-white-black color
scheme with strong visual
impact, cinematic, 1960s-
70s retro-futurism
influence

========== 主合集 第 53 页 ==========

 《溺水小刀》影像风格提示词


视觉风格         胶片质感- 呈现出复古胶片感,带有明显的颗粒感和柔
             焦效果

              电影感- 整体画面具有电影级的视觉质感和光影处理

              柔焦处理- 前景和背景都采用了不同程度的柔焦处理,
             营造梦幻氛围

              自然光线- 使用自然光线,营造出柔和、真实的氛围

色彩运用         冷暖对比- 运用了冷暖色调的强烈对比(蓝色/绿色背景
               与暖色人物/元素)

              低饱和度- 整体色彩饱和度偏低,营造出柔和、怀旧的
            氛围

              自然色调- 以海洋、天空、山脉等自然元素为主,色彩
             清新自然

构图特点         景深效果- 运用了景深处理,前景、中景、背景层次分
            明

              自然元素- 海洋、天空、山脉等自然景观是重要的背景
            元素

              人物关系- 包含人物,强调亲密关系和情感表达

主题情感         浪漫与爱情- 传达出浪漫、亲密的情感主题

             自由与逃离- 有旅行、摩托车等元素,暗示自由、逃离
             日常的主题

             梦幻与怀旧- 整体氛围梦幻、怀旧,带有诗意和内省的
            情感


            图片           提示词

海边漫步                                                      this scene displays a
                                                    rocky coastline with deep
                                                     blue water and a light
                                                          blue, cloudy sky. two
                                                          figures are visible on the
                                                      shore; one dressed in

========== 主合集 第 54 页 ==========

                                                      white is seen walking into
                                                      the water on the left, and
                                                       another, in a light colored
                                                   garment, stands facing
                                                      the water on a rock to the
                                                                   right. numerous large
                                                    boulders emerge from the
                                              ocean and line the beach.
                                                 green and dry plants
                                               occupy the immediate
                                                      foreground.

水中嬉戏                                         two individuals are
                                                                  partially submerged in
                                                     blue water, seemingly
                                             swimming or floating. one
                                                 person on the left has
                                                   dark hair, a light
                                                    complexion, and appears
                                                            to be looking towards the
                                                                right with their eyes
                                                    closed or downcast. the
                                                       other person on the right
                                               has light blond or white
                                                            hair and is looking
                                                  towards the left with an
                                             open mouth, appearing to
                                             be speaking or singing.
                                                   both are wearing light
                                                     colored that is wet and
                                                           clinging to their bodies.
                                                      the water is a deep blue
                                                        with ripples and some
                                              foamy white patches. in
                                                      the bottom right corner

海边骑行近景                                  a medium shot features a
                                              young man with blonde
                                                            hair and a young woman
                                                        with dark hair, both with
                                                                    light skin, against a
                                                         natural background of
                                                 mountains and water. the
                                       man is in the foreground
                                                       looking towards the right,

========== 主合集 第 55 页 ==========

                                                  wearing a light colored
                                                         collared shirt. the woman
                                                                      is behind him, smiling
                                             and looking towards the
                                             man, wearing a white
                                                        spaghetti strap top. her
                                                                           left hand is resting on his
                                                       shoulder. a red rose is
                                                               visible in the lower left
                                                     corner of the frame,
                                                                  partially obscured.

海边骑行中景                                  a couple on a black
                                                     scooter travels rightward
                                                   across the frame. the
                                              male driver has blond
                                                                hair, and the female
                                                passenger has dark hair,
                                                   both are wearing light .
                                                    red and orange roses
                                                    decorate a white suitcase
                                             on the back of the
                                                     scooter and the
                                                     handlebars. the
                                                background features a
                                                        large expanse of water
                                                       leading to distant
                                                mountainous islands
                                                beneath a soft, bright sky.

花瓣飞落                                            red rose petals fall
                                                    through a bright, overcast
                                                  sky above a body of
                                                       water. rocky, grey islands
                                                        or formations emerge
                                                  from the water,
                                                         silhouetted against the
                                                            bright horizon where the
                                               sun subtly gleams. the
                                                        petals are numerous and
                                                appear blurred due to
                                                      motion, scattered across
                                                      the entire frame. the
                                                            overall scene suggests a
                                                            natural, outdoor

========== 主合集 第 56 页 ==========

                                                  environment with a focus
                                             on the falling petals and
                                                      the rugged coastal
                                                    landscape.

双马尾女孩递易拉罐                        A cinematic photo of a
                                                          delicate slender beautiful
                                              Japanese young girl with
                                                              soft black twin tails, pure
                                             and elegant facial
                                                          features, wearing a white
                                                               sailor uniform with blue
                                                                  collar, holding a green
                                                         Sprite can and extending
                                                                                                     it forward. She has a faint
                                                       gentle subtle smile,
                                                       looking at the camera
                                                         calmly. In the left
                                                      foreground, a blonde
                                                     person's blurred side face
                                                                      is visible wearing white
                                                          clothes. Shallow depth of
                                                                       field, blurred background
                                                        with old weathered brick
                                                          wall texture. Natural soft
                                                         diffused lighting, muted
                                                             retro earthy tones with
                                                        fresh green as the accent
                                                             color. Drowning Knife
                                               movie aesthetic,
                                                 japanese film still style,
                                                  hyper realistic, soft grainy
                                                                film texture, melancholic
                                                         youthful vibe

男女对视特写                             A cinematic close-up
                                                  photo of two Japanese
                                                     teenagers. The boy on
                                                      the left has messy pale
                                                  blonde hair and wears a
                                                            plain white shirt. The girl
                                             on the right has soft black
                                                            hair in a ponytail, dressed
                                                                 in a dark sailor uniform.
                                                       Their faces are extremely

========== 主合集 第 57 页 ==========

                                                          close, moments before a
                                                     tender kiss. The girl shyly
                                                    avoids the boy’s eyes,
                                                    her gaze falling gently on
                                                           his lips. Both carry
                                                    melancholy, timid
                                                shyness and subtle
                                                  hidden desire in their
                                                      expressions. Intimate and
                                                      breathless atmosphere,
                                                     shallow depth of field,
                                                                softly blurred
                                                  background, natural soft
                                                         diffused lighting, low
                                                           saturation, cool muted
                                                         neutral tones, Japanese
                                                                film still aesthetic, hyper
                                                                    realistic, soft film grain,
                                                          delicate youthful texture

亲密特写即将亲吻                          A cinematic photo of two
                                                  Asian teenagers in close-
                                                      up, their faces very close
                                                   almost touching, about to
                                                          kiss or whisper. The
                                                  blonde person on the left
                                               wears a white shirt. The
                                                       black-haired person on
                                                      the right has eyes slightly
                                                       closed. Shallow depth of
                                                                    field with completely
                                                        blurred background.
                                                      Natural soft lighting, low
                                                           saturation, warm tones
                                                        with gray-green
                                                  background. Film-still
                                                                 style, realistic, intimate
                                             and tender atmosphere,
                                                   16:9 aspect ratio

========== 主合集 第 58 页 ==========

坐在石块上并排而坐                        A cinematic photo of two
                                              young people sitting on
                                                 rough stone ground. The
                                                  blonde person on the left
                                               wears a white short-
                                                    sleeve shirt and blue
                                                  backpack, looking at a
                                                 phone. The black-haired
                                                 person on the right has
                                                  low twin tails, wearing a
                                              Japanese sailor uniform,
                                                       holding her knees and
                                                       looking down. Behind
                                             them is an old stone wall
                                                        with black and brown
                                                        pipes. Shallow depth of
                                                                       field, natural lighting,
                                             muted earthy tones. Film-
                                                                                       still style, realistic,
                                                          introspective mood, 16:9
                                                   aspect ratio



 《First Love》影像风格提示词


构图与镜头       偏爱极简留白构图，以蓝天、雪地、列车窗为背景，
             聚焦人物情绪，画面干净克制。

             大量使用特写/ 近景镜头捕捉眼神、发丝等细节，放
             大心动张力；同时用对称构图强化宿命感。

            标志性的动态镜头：风吹发丝、列车移动、光影掠
             过，让静态画面充满呼吸感。


色彩与光影       以蓝色为主色调贯穿全片，用清透浅蓝（少年）和冷
             调灰蓝（成年）区分时空，自带清冷温柔的滤镜。

             光影是核心叙事语言：

             少年组用侧逆光/ 逆光，勾勒发丝金边，营造青春氛
             围感；

========== 主合集 第 59 页 ==========

            成年组用柔光散射光，弱化棱角，传递朦胧疏离的情
            绪。

质感与氛围        全程复刻90 年代胶片质感，保留轻微颗粒感、柔焦和
             镜头光晕，自带复古滤镜。

             整体氛围是「流动的日式纯爱MV」，每一帧都带着呼
             吸感，像被风吹动的记忆碎片。

经典场景          天台/ 屋顶：蓝天、铁丝网与校服少年，逆光发丝的标
             志性场景；

             列车车厢：雪天车窗、耳机线，串联双时空的核心意
            象；

             雪地路灯：冷调雪景与暖光路灯的对比，定格成年后的
             重逢瞬间。


角色与动作        动作设计克制而充满张力：额头相抵、同用一副耳机、
             并肩看远方，用细微互动传递暧昧与羁绊。

             人物状态与镜头适配：少年时的大笑与肆意奔跑，用开
             阔镜头呈现；成年后的沉默与对视，用近景特写放大情
            绪。

色彩色调        少年线：高饱和浅蓝+ 暖调高光，搭配白衬衫、藏青
             校服，明亮干净；

            成年线：低饱和冷调灰蓝+ 雪天白，搭配深蓝色大
             衣、黑色围巾，朦胧柔和；

             全片色彩统一克制，极少出现杂乱撞色，保持了日式美
             学的极简感。


            图片           提示词

天台嬉笑                                             cinematic still, Japanese
                                                   youth drama, Korean
                                                drama, slice of life,
                                                         intimate moments,
                                                    emotional connection,
                                                         natural light, golden hour,
                                                              soft focus, nostalgic
                                                  atmosphere, school

========== 主合集 第 60 页 ==========

                                                        uniform, friendship,
                                                romance, detailed facial
                                                      expressions, outdoor
                                                              setting, two young Asian
                                                      people, man and woman,
                                                                   sitting or standing side by
                                                           side, bright smiles, hair
                                                    blowing in wind, shallow
                                                  depth of field, man in left
                                                  background, woman in
                                                                right foreground, both
                                                        facing right, soft natural
                                                          daylight from side, side
                                                                 lighting, bright blue sky,
                                         warm skin tones, all-white
                                                    school uniforms with
                                                      white inner shirts, black
                                                                hair, natural sunlight, soft
                                                shadows, professional
                                                    photography, 4K quality

火车                                         a photo of two young
                                                 korean men sitting on the
                                                                    train, one wearing blue
                                             and making peace signs
                                                        with his hands in front of
                                                     him, smiling happily at
                                             me. the other is holding
                                             an electric pencil. a
                                       woman sat next to them,
                                                       also smiles and wears
                                                      white gloves. it's winter
                                                      outside the window, a
                                               scene from a k-drama
                                                        series called "small
                                                        charger". the camera
                                                    captures their entire
                                                   body.

手中雪糕                                             the image presents a
                                                      close up of a blue
                                                       popsicle on a stick being
                                                     held by a hand. a drip of
                                                      the blue substance is on
                                                      the hand's finger,

========== 主合集 第 61 页 ==========

                                                           indicating the popsicle is
                                                         melting. a blurred white
                                                garment is visible to the
                                                                   right, and the background
                                                                      is an expanse of light
                                                          blue, suggesting a clear
                                                         sky.

剥糖                                         a close up, eye level shot
                                            shows a person with
                                                        short dark hair in a light
                                                     blue shirt, with only the
                                                                profile of their face visible
                                             on the right side of the
                                                     frame. they are holding a
                                                                    light blue, translucent,
                                                     rock shaped candy or
                                                            object, wrapped in clear
                                                                plastic, with both hands.
                                                      the background is
                                                           blurred, showing a light
                                                   gray and white speckled
                                                        surface, possibly part of a
                                             bag or fabric, on the left
                                                            of the person's torso, and
                                             a darker, indistinct
                                                     surface behind it.

吃雪糕                                        a medium shot features a
                                              young Japan man on the
                                                                           left and a young japan
                                       woman on the right, both
                                                       looking upwards with
                                             open mouths, against a
                                                 backdrop of a road
                                                    receding into the distance
                                                      flanked by lush green
                                                        trees and a pale blue sky.
                                                      the man, with dark hair,
                                               wears a light blue t shirt
                                             and holds a thin stick in
                                                           his right hand, which is
                                                      close to his mouth. the
                                           woman, with dark hair
                                                              tied back with a blue tie,

========== 主合集 第 62 页 ==========

                                               wears a white t shirt and
                                             a black choker, holding a
                                                                    light blue popsicle in her
                                                                right hand.



 娄烨《苏州河》影像风格提示词


构图与镜头       全程手持晃动镜头，画面轻微震颤，纪实感强烈；多
             用失衡构图、挤压式取景、近距离特写，大量浅景深、
             虚焦画面，视角疏离破碎，弱化规整构图，营造不安、
             漂泊的主观情绪。


色彩与光影       光源极简，依靠裸露灯泡、路灯、微弱天光单一硬
            光；多用侧光、顶光，阴影浓重、明暗反差强烈；潮
             湿水汽让光线漫反射，形成朦胧光晕，光影割裂压抑，
             氛围感暧昧。

质感与氛围           16mm 胶片拍摄，粗粝颗粒感明显；画面自带潮湿、
             阴冷、黏腻的液态质感；聚焦城市边缘废墟、旧厂房、
             昏暗小屋，整体氛围忧郁、迷离、压抑，充满都市孤独
             与宿命感。


经典场景         苏州河浑浊河面、昏暗密闭室内、鱼缸水下场景、雨夜
             街头；固定昏暗布光+ 晃镜拍摄，虚实结合，现实与
             梦幻交织，形成标志性娄烨式颓败美学。


角色与动作        多半脸、侧颜、逆光剪影镜头，弱化完整人像；人物动
             作缓慢克制、肢体疏离，神态麻木忧郁，行为徘徊、沉
             默寡言，以压抑的肢体状态，映射情感封闭与内心迷
            失。


色彩色调        整体低饱和、低明度，以灰蓝、浊绿、暗青为主色
             调，色彩发旧发灰；局部用霓虹红、昏黄灯光做冷暖对
             比，色调暗沉浑浊，自带潮湿颓废的复古霉感。

========== 主合集 第 63 页 ==========

            图片           提示词

屋内侧脸                                                      in the style of wong kar-
                                                         wai, a woman with long
                                                            hair and silver
                                             eyeshadow stands in the
                                                     corner of an old room,
                                                   gazing at the light bulb
                                                 hanging from above. the
                                                          wall is beige, and there is
                                                       only one light bulb
                                                 hanging on it. there is no
                                                       other lighting or
                                                      decoration in the room.
                                                      the woman is wearing
                                                 green . movie shot. movie
                                                                               stills. "random title" shot
                                                        with an s200 film camera,
                                                                    f/8 aperture, 56mm focal
                                                          length, and fujifilm color.

美人鱼                                        a grainy close-up shot of
                                             a blonde woman in the
                                                   dark water, her hair
                                                              floating and covering half
                                                    her face. she has long,
                                            wavy bangs hanging
                                          down over one eye, and
                                                    her hand touches
                                                 something underwater.
                                                                                    it's an action scene, with
                                                      the camera angle from
                                                  above, looking down at
                                                          her. the lighting is dimly
                                                                                                     lit, with some light coming
                                                    through the surface of the
                                                       water. she looks sad but
                                                              beautiful, and there's
                                              ample space around her
                                             head for text or graphics
                                                            to fit on the poster.

========== 主合集 第 64 页 ==========

鱼缸                                                 close-up of a woman's
                                             hand holding a red sea
                                                         creature, an underwater
                                               scene from the movie
                                                         "the little mermaid," a
                                                   screenshot from a vhs
                                                        video.





 《天狗的厨房》影像风格提示词


构图与镜头       核心用日式框景构图（推拉门、木格栅），把庭院和
             人物框成“画中画”，自带私密松弛感。

              多用对称/ 固定机位长镜头，节奏慢，不花哨，还原生
             活的流动感。

色彩与光影        主打柔和侧逆光/ 漫射光，光线透过树叶、纸门，形
             成朦胧光斑，自带治愈滤镜。

             光影不强烈，没有硬阴影，整体通透又温柔。


质感与氛围       整体是温润、松弛的日式生活质感，旧木头、竹篮、
             榻榻米的纹理清晰，充满烟火气。

             氛围是安静、治愈的，像在看自己的慢生活日常。


经典场景         室内透过纸门看庭院、猫、西瓜、风扇的夏日场景

             廊下两人择菜、喝茶的田园日常都是日式传统住宅里的
             标志性画面。


角色与动作       角色动作都很舒缓、生活化，没有夸张表演，就是看
             书、择菜、发呆这种日常细节。

             互动自然松弛，像真实的朋友相处，不刻意。

========== 主合集 第 65 页 ==========

色彩色调        整体是低饱和暖调：以原木色、米白、抹茶绿为主，
             色彩干净柔和，没有高对比的鲜艳色。

             色调偏暖，带一点点胶片感，复古又治愈。


            图片           提示词

屋内背影                                                      in the style of wong kar-
                                                         wai, a woman with long
                                                            hair and silver
                                             eyeshadow stands in the
                                                     corner of an old room,
                                                   gazing at the light bulb
                                                 hanging from above. the
                                                          wall is beige, and there is
                                                       only one light bulb
                                                 hanging on it. there is no
                                                       other lighting or
                                                      decoration in the room.
                                                      the woman is wearing
                                                 green . movie shot. movie
                                                                               stills. "random title" shot
                                                        with an s200 film camera,
                                                                    f/8 aperture, 56mm focal
                                                          length, and fujifilm color.

                         场景：日式传统室内空间

                         关键元素：榻榻米、障子
                         门、木质推拉门、庭院景
                         观

                         人物：女性坐在木椅上阅
                         读

                         细节：电风扇、灰猫躺在
                         地上、西瓜托盘

                         光线：自然光从庭院透
                         入、背景虚化

                         氛围：宁静、夏日午后、
                         生活美学

                         风格：日式生活摄影、电
                         影感构图

========== 主合集 第 66 页 ==========

                              比例：21:9（超宽画幅，
                         接近原图比例）

少年对坐                                A peaceful rural Korean
                                                        or Japanese countryside
                                                   scene, two young men
                                                                   sitting outside a
                                                                traditional wooden house
                                                     preparing vegetables,
                                         warm natural afternoon
                                                                       light, nostalgic and
                                                             tranquil atmosphere. On
                                                      the left, a man with black
                                                            hair wearing white long-
                                                    sleeve shirt and dark
                                                   pants sits on a low
                                           wooden stool, washing or
                                                     preparing vegetables in a
                                                   metal basin. On the right,
                                             a younger man with light
                                              brown hair wearing a
                                                     yellow-green patterned t-
                                                                  shirt and shorts sits
                                                        casually on another stool.
                                             Between them are fresh
                                                 green vegetables and
                                                                traditional woven bamboo
                                                      baskets. Traditional
                                           wooden architecture with
                                                              sliding doors and lattice
                                              windows in the
                                                  background, rustic
                                                  ceramic jars and farming
                                                           tools visible, soft bokeh
                                                background with green
                                                              foliage, slice of life
                                                           aesthetic, cinematic
                                                      composition, warm earthy
                                                          color tones, Asian rural
                                                                    lifestyle photography
                                                             style --ar 21:9 --style raw
                                                                --v 6

                         场景：韩国或日本乡村传
                         统木屋外

========== 主合集 第 67 页 ==========

                         人物：两位年轻男性，一
                         个黑发白衣，一个棕发黄
                           绿T 恤

                         活动：准备蔬菜、洗菜的
                         日常场景

                         道具：金属盆、竹编篮
                         子、新鲜蔬菜、陶罐

                         建筑：传统木质房屋、格
                         子窗、推拉门

                         光线：温暖自然光、背景
                         虚化绿色植物

                         氛围：宁静、怀旧、乡村
                         生活美学

                         风格：亚洲乡村生活摄
                         影、电影感

                              比例：21:9（超宽画幅）

三人围坐                                A warm outdoor dining
                                                   scene, three young Asian
                                       men eating together on a
                                           wooden porch outside a
                                                                traditional house, casual
                                          summer afternoon,
                                                         natural soft lighting with
                                                 green foliage framing.
                                                Three men sitting on
                                           wooden benches around
                                             a low wooden table filled
                                                        with various Korean or
                                              Japanese dishes and
                                                     bowls. Left: man in
                                                     patterned short-sleeve
                                                                  shirt and olive pants
                                                       eating with chopsticks.
                                                     Center: man with light
                                              brown hair in white t-shirt
                                                      enjoying his meal. Right:
                                       man in light blue button-
                                             up shirt also eating.

========== 主合集 第 68 页 ==========

Multiple dishes, bowls,
and a dark bottle on the
rustic wooden table.
Background shows
traditional house exterior
with windows and white
curtains, green plants in
soft focus foreground
creating natural frame,
relaxed and convivial
atmosphere, slice of life
aesthetic, cinematic
composition, warm
natural color palette,
Asian lifestyle
photography style --ar
21:9 --style raw --v 6

场景：传统房屋外的木质
门廊/平台

人物：三位年轻亚洲男性
共同用餐

服装：左-花纹短袖+橄榄
绿裤，中-白T 恤，右-浅
蓝衬衫

餐桌：低矮木桌，摆满韩
式或日式料理、碗碟、深
色瓶子

构图：前景绿色植物虚化
形成自然画框

建筑：传统房屋、窗户、
白色窗帘

氛围：轻松、温馨、夏日
聚餐

风格：生活美学摄影、电
影感

比例：21:9（超宽画幅）

========== 主合集 第 69 页 ==========

 URI 影像风格提示词


            图片           提示词

风格：超现实主义绘画、                     A surreal and dreamlike
魔幻现实主义                                            painting of an open
                                             window with flowing
核心元素：蓝色窗框、透                            sheer blue curtains and
明蓝色窗帘、橙红色金鱼                           orange goldfish
在空中游动                                    swimming through the air,
                                                   magical realism style,
色彩：深蓝色调为主，橙                                             deep blue color palette.
色金鱼形成对比                              An open window frame
                                                     painted in rich blue tones,窗外景观：明亮白色天空
                                                      transparent light blue
过渡到深蓝海洋                                                         curtains billowing gently
室内：各种蓝色调营造水                                    in the breeze, multiple
                                                   orange-red goldfish下氛围
                                                              floating and swimming
技法：油画质感、可见笔                             through the curtains and
触、绘画性纹理                                             into the room as if the air
                                              were water. Outside the
氛围：梦幻、诗意、奇幻                                             window shows a bright
与现实交融                                           white sky transitioning to
                                             deep blue ocean water.主题：象征性、隐喻性意
                                            The interior room is
象                                                     painted in various shades
                                                            of blue, creating an比例：7:3
                                                  underwater atmosphere.
                                                          Painterly texture with
                                                               visible brushstrokes, oil
                                                         painting aesthetic,
                                             dreamy and poetic mood,
                                                      fantasy and reality
                                                     blending together,
                                                    symbolic and
                                                     metaphorical imagery,
                                                 contemporary fine art
                                                             style --ar 7:3 --style raw --
                                                  v 6

========== 主合集 第 70 页 ==========

构图：女孩背影站在窗前                     A dreamy and
望向大海                                            melancholic painting of a
                                              young woman with
人物：白色上衣+蓝色裙                                                     braided hair standing by
子，深色长发编成辫子                           an open window,
                                                   watching orange goldfish
超现实元素：橙红色金鱼
                                                                  float in the air, surreal
在空中漂浮游动                                             and poetic atmosphere,
                                                              soft blue and white color窗台细节：玻璃鱼缸内有
                                                             palette. Back view of a金鱼和水草
                                                                           girl wearing a white
窗外景观：深蓝色海洋、                             blouse and blue skirt,
雾蒙蒙的地平线                                      long dark hair in a braid,
                                                     standing at a windowsill
窗帘：白色透明薄纱轻柔                             gazing out at the deep
飘动                                                 blue ocean. Multiple
                                                   orange-red goldfish
色彩：柔和的蓝白色调为
                                             swimming through the air
主，橙色金鱼点缀                                                around her and outside
                                                      the window, as if gravity技法：绘画感、柔和笔
                                                       doesn't exist. On the触、印象派质感、油画纹
                                                          windowsill, a glass
理                                                        fishbowl with goldfish and
氛围：沉思、忧郁、梦                                 aquatic plants. White
                                                  sheer curtains flowing幻、诗意
                                                            gently, open window
主题：孤独与自由、魔幻                              frame, vast blue sea and
现实主义                                             misty horizon outside.
                                                          Painterly style with soft
比例：7:3                                                      brushstrokes,
                                                         impressionistic and
                                                        ethereal quality, oil
                                                         painting texture,
                                                     contemplative and wistful
                                             mood, magical realism,
                                                        loneliness and freedom
                                                 theme, contemporary fine
                                                                art aesthetic --ar 7:3 --
                                                             style raw --v 6

构图：女孩侧面轮廓坐在                     A dreamy impressionistic
窗边                                                     painting of a young girl in
                                             a white dress sitting by a
人物：深色头发，白色飘                           window, watching orange
                                                          goldfish swimming

========== 主合集 第 71 页 ==========

逸连衣裙                                              outside in the air, surreal
                                             and ethereal atmosphere,
超现实元素：橙金色金鱼                                                     blue color palette with
在窗外空中游动                              warm orange accents.
                                                  Side profile view of a girl窗户：蓝色窗框的大窗户
                                                        with dark hair wearing a
窗帘：右侧柔软的白色透                                flowing white dress,
明薄纱                                                           sitting peacefully by a
                                                        large window with blue
室内：蓝色调的房间氛围                                                     frame. Outside the
技法：松散的印象派笔                             window, multiple orange
                                             and golden goldfish float触、绘画质感、柔焦效果
                                             and swim through the air
风格：油画风格、印象派                           as if in water, creating a
                                                   magical scene. Soft white
氛围：沉思、宁静、梦幻                                                  sheer curtains on the
主题：童年的好奇与想                                       right side, blue-toned
                                                                  interior room. Loose象、魔幻现实主义
                                                         impressionistic
光线：柔和自然光透过窗                              brushstrokes, painterly
户                                                          texture, soft focus and
                                             dreamy quality, oil
色彩：蓝色调为主，橙色                                                         painting style,
金鱼形成暖色点缀                                    contemplative and serene
                                             mood, childhood wonder比例：7:3
                                             and imagination theme,
                                                   magical realism
                                                           aesthetic, gentle natural
                                                               lighting filtering through
                                                      the window --ar 7:3 --
                                                             style raw --v 6

人物：动漫风格少女，短                     A beautiful anime girl in
深蓝黑发，琥珀色大眼                             orange yukata with
                                                          goldfish floating around睛，温柔向上凝视
                                                          her, summer festival
服装：橙色浴衣（日式夏                            atmosphere, dreamy and
季和服）带白色花纹                                 magical mood, vibrant
                                                            colors. Close-up portrait
发饰：橙色花朵发饰                                                            of a young anime girl with
                                                        short dark blue-black hair超现实元素：橙白色金鱼
                                             and large expressive在空中漂浮游动
                                            amber eyes, looking up
背景：模糊的日本街道、                                with a gentle and wistful
蓝天白云、橙色店铺招牌                              expression. She wears

========== 主合集 第 72 页 ==========

和灯笼                                        an orange yukata
                                                                (traditional Japanese
色彩：暖色（橙色）与冷                                          summer kimono) with
色（蓝色）对比                                       white floral patterns, and
                                                orange flower hair技法：柔和散景效果、细
                                                ornaments in her hair.
腻阴影和光线处理
                                                          Multiple orange and white
风格：动漫艺术风格、吉                                 goldfish float and swim
                                                    through the air around卜力工作室美学
                                                    her head, creating a
氛围：怀旧、夏日祭典、                                surreal and fantastical
梦幻、魔幻现实主义                                 scene. Blurred
                                                background showing a
比例：21:9（超宽画幅）                                              Japanese street with blue
Midjourney 参数：--niji 6                                sky, white clouds, and
                                                    orange-colored shop（动漫模式）
                                                     signs and lanterns. Soft
                                              bokeh effect, warm and
                                                       cool color contrast
                                                   (orange and blue tones),
                                              anime art style with
                                                         detailed shading and
                                                                 lighting, Studio Ghibli
                                                         inspired aesthetic,
                                                         nostalgic summer festival
                                                 theme, magical realism --
                                                        ar 21:9 --niji 6

人物：动漫风格少年，棕                       An anime boy skydiving
色尖刺发型                                         through a bright blue sky
                                                                         filled with fluffy white
装备：橙色护目镜戴在头                               clouds, exhilarating and
上，橙白色服装                                              joyful atmosphere, sense
                                                            of freedom and
动作：跳伞姿势，四肢展
                                                     adventure, vibrant colors
开，脸上露出灿烂笑容                                             and dynamic
                                                      composition. A young表情：纯粹的喜悦和兴奋
                                              anime boy with spiky
环境：明亮蓝天，蓬松白                          brown hair wearing
色积云在上下方                                   orange goggles on his
                                                  head, orange and white
构图：动态构图，营造深                                                                        outfit, falling through the
度和立体感                                        sky with arms and legs
                                                 spread wide in a光线：明亮自然阳光、清
                                                       skydiving pose, huge

========== 主合集 第 73 页 ==========

晰能见度                                             smile on his face
                                                    expressing pure joy and
动感：运动感、失重感                                                      excitement. Brilliant blue
风格：动漫艺术风格、清                            sky with scattered puffy
                                                      white cumulus clouds晰线条、赛璐珞着色、吉
                                              above and below him,
卜力美学
                                                        creating depth and
主题：冒险、成长、自由                             dimension. Bright natural
                                                             sunlight, clear visibility,
氛围：振奋人心、充满活                                               sense of motion and
力                                                   weightlessness. Anime
                                                                art style with clean lines比例：21:9（超宽画幅）
                                             and cel shading, Studio
Midjourney 参数：--niji 6                                 Ghibli inspired aesthetic,
（动漫模式）                                       adventure and coming-of-
                                             age theme, uplifting and
                                                       energetic mood --ar 7:3 --
                                                                                  niji 6 --raw --p rezi763
                                        786eqwm kq29q87

核心概念：彩色住宅楼在                     A surreal and dreamlike
天空中漂浮旋转，金鱼在                          scene of colorful
                                                            residential buildings空中游动
                                                              floating and spiraling in
建筑：多栋公寓楼，阳台                              the sky with orange
上覆盖绿色植物和树木                                   goldfish swimming
                                                    through the air, magical
色彩：明亮的蓝色、白                                                      realism style, vibrant blue
色、橙色建筑                                  and orange color palette.
                                                          Multiple apartment构图：螺旋或漩涡式构
                                                         buildings with balconies
图，建筑向天空上升                                                 covered in lush green
超现实元素：橙色和金色                                plants and trees, painted
                                                                 in bright blue, white, and锦鲤在建筑间游动，仿佛
                                                orange colors, arranged
天空是水                                                                 in a spiral or vortex
天空：明亮蓝天、戏剧性                             composition rising into
                                                      the sky. Orange and白云、强烈阳光产生镜头
                                                  golden koi fish of various光晕效果
                                                       sizes swimming and
视角：鱼眼或广角畸变、                                   floating through the air
动态透视                                         around and between the
                                                         buildings as if the sky
氛围：运动感、失重感、                          were water. Brilliant blue
奇幻、异想天开                                    sky with dramatic white

========== 主合集 第 74 页 ==========

风格：动漫艺术、鲜艳饱                             clouds and bright sunlight
和色彩、吉卜力+新海诚                                 creating lens flare effects.
                                             Dynamic perspective with美学
                                                       fisheye or wide-angle
主题：城市奇幻、环境和                                    distortion, sense of
谐                                                motion and
                                                     weightlessness,
比例：21:9（超宽画幅）                                                             fantastical and whimsical
                                                  atmosphere. Anime artMidjourney 参数：--niji 6
                                                             style with vibrant（动漫模式）
                                                      saturated colors, Studio
                                                           Ghibli meets Makoto
                                                     Shinkai aesthetic, urban
                                                      fantasy theme,
                                                    environmental harmony
                                                  concept --ar 21:9

人物特写：动漫少女，短                     A stunning close-up
深蓝黑色波波头，琥珀金                                    portrait of an anime girl in
                                                                traditional Japanese色眼睛带细节反光
                                                  kimono, summer festival
表情：直视观众，平静而                            atmosphere, dreamy and
迷人                                                   ethereal mood, vibrant
                                                     blue and orange color
服装：优雅和服，蓝白底                                              scheme. Beautiful anime
色，装饰橙红色花卉图案                                          girl with short dark blue-
和传统图案                                           black bob haircut and
                                                               striking amber-golden
背景：柔和散景、蓝天、                                                eyes with detailed
模糊的橙色灯笼和祭典装                                   reflections, looking
饰                                                             directly at viewer with a
                                               calm and captivating
光线：脸部温暖自然光、                                                      expression. She wears
背景冷蓝色调                                             an elegant kimono with
                                                     blue and white base色彩对比：暖色与冷色高
                                                        colors decorated with
对比（橙蓝对比）
                                                orange and red floral
风格：动漫艺术、半写实                               patterns and traditional
渲染、细腻皮肤质感和布                                 motifs. Soft bokeh
                                                background with blue料细节
                                                         sky, blurred orange
美学：吉卜力+现代动漫                                 lanterns and festival
美学融合                                              decorations. Warm
                                                         natural lighting on her
主题：日本夏日祭典                                                          face, cool blue tones in

========== 主合集 第 75 页 ==========

氛围：宁静优雅                                    background, high
                                                        contrast between warm
比例：21:9（超宽画幅）                                             and cool colors. Anime
Midjourney 参数：--niji 6                                    art style with semi-
                                                                   realistic rendering,（动漫模式）
                                                         detailed skin texture and
                                                              fabric details, Studio
                                                           Ghibli meets modern
                                              anime aesthetic,
                                              Japanese summer
                                                                 festival theme, serene
                                             and elegant atmosphere -
                                                             -ar 21:9 --niji 6

人物特写：动漫少年，凌                     A close-up portrait of an
乱深棕色头发，蓝绿色眼                          anime boy eating bread
                                               by a swimming pool,睛
                                          summer vacation
动作：双手拿着面包/三明                           atmosphere, relaxed and
治正在吃，直视观众                                 casual mood, warm
                                                         natural lighting. Teenage
服装：休闲白色T 恤，带                                              anime boy with messy
蓝色和橙色图案设计                                 dark brown hair and
                                                               striking blue-green eyes环境：明亮的绿松石蓝色
                                                       looking directly at viewer
游泳池边，手臂靠在池边                                                       while taking a bite of
前景：可见泳池水面                               bread or sandwich held in
                                                   both hands. He wears a
背景：模糊的泳池边环                               casual white t-shirt with
境、温暖木质色调、柔和                              blue and orange graphic
散景                                                  design. His arms rest on
                                                      the edge of a bright
细节：湿润头发（刚从泳                                                       turquoise blue swimming
池出来）、皮肤上的水珠                                 pool, water visible in the
                                                      foreground. Background光线：温暖午后阳光、脸
                                            shows blurred poolside
部柔和阴影                                                  environment with warm
风格：动漫艺术、半写实                        wooden tones and soft
                                                  bokeh. Wet hair渲染、细腻眼睛和面部特
                                                    suggesting he just got out
征                                                            of the pool, natural skin
美学：生活切片美学、吉                                texture with water
                                                           droplets, warm afternoon卜力+现代动漫风格
                                                          sunlight creating soft
主题：夏日休闲                                shadows on his face.

========== 主合集 第 76 页 ==========

氛围：放松、随意                              Anime art style with semi-
                                                                   realistic rendering,
比例：21:9（超宽画幅）                                                         detailed eyes and facial
Midjourney 参数：--niji 6                                 features, slice of life
                                                           aesthetic, summer leisure（动漫模式）
                                                 theme, Studio Ghibli
                                              meets modern anime
                                                             style --ar 21:9 --niji 6

视角：低角度仰拍，动态                     A dynamic low-angle shot
构图                                                       of an anime girl lying on
                                                      the roof of a vehicle
人物：动漫少女，长棕色                            under bright blue sky,
头发扎成双辫                                summer adventure
                                                  atmosphere, energetic
配饰：蓝金色护目镜戴在
                                             and carefree mood,
头上                                                          vibrant colors. Beautiful
                                              anime girl with long表情：仰望天空，放松梦
                                                        flowing brown hair in twin幻的表情
                                                          braids, wearing blue and
服装：白色短款背心+蓝                               gold goggles on her
                                                  head, looking up at the色牛仔短裤+黄色腰带
                                                  sky with a relaxed and
姿势：躺在黄色车辆顶部/                                             dreamy expression. She
引擎盖上，双臂伸展放在                          wears a white cropped
脑后                                                 tank top and blue denim
                                                       shorts with yellow belt,
道具：橙色狐狸或猫咪毛                                                             lying casually on what
绒玩具                                           appears to be the roof or
                                             hood of a yellow vehicle.天空：明亮蓝天、大片蓬
                                               Her arms are stretched
松白色积云                                                  behind her head in a
光线：温暖阳光、自然高                              relaxed pose. An orange
                                                        fox or cat plush toy sits光和阴影
                                                  near her. Brilliant blue
氛围：自由、冒险感                                sky filled with large fluffy
                                                      white cumulus clouds in
风格：动漫艺术、半写实
                                                      the background. Warm
渲染、细腻服装纹理和褶                                                          sunlight creating natural
皱                                                         highlights and shadows,
                                               sense of freedom and色彩：鲜艳色彩（蓝、
                                                     adventure. Anime art
橙、黄、白）                                                             style with semi-realistic
美学：现代动漫、电影感                               rendering, detailed
                                                          clothing textures and

========== 主合集 第 77 页 ==========

构图                                                         fabric folds, vibrant color
                                                          palette with blue, orange,
主题：公路旅行、青春                                                          yellow, and white tones.
比例：21:9（超宽画幅）                         Modern anime aesthetic
                                                        with cinematic
Midjourney 参数：--niji 6                                                      composition, road trip
（动漫模式）                                  and youth theme --ar
                                                   21:9 --niji 6



 超现实双重曝光影像风格提示词


            图片           提示词

艺术手法：超现实双重曝                     A surreal double
光、剪影与风景融合                               exposure artwork
                                                     blending a woman's
主体：女性剪影与奔跑的                                 silhouette with wild
马群无缝融合                                      horses running across a
                                                       lush green landscape,
女性元素：飘逸深色头
                                                    dreamlike and poetic
发、侧面轮廓和身体形成                                                      composition, vibrant
风景本身                                                  colors, artistic and
                                                     metaphorical imagery.马匹：多匹白马+一匹显
                                            The silhouette of a
眼的粉红/洋红色马，在起                                       woman with flowing dark
伏绿色山丘上奔跑                                         hair merged seamlessly
                                                        with a scene of multiple景观纹理：绿色草地和植
                                                  horses - white horses and
被覆盖女性剪影和部分马                                             one prominent
匹                                                  pink/magenta horse -
                                                        galloping across rolling背景：明亮蓝天、柔和白
                                                 green hills covered in色和粉色云朵
                                                   grass and vegetation.
色彩：鲜艳饱和色彩- 深                         The woman's profile and
蓝、鲜绿、白色、醒目粉                          body form the landscape
                                                                           itself, with the horses红
                                                   appearing to run across
构图：统一的有机构图，                             her form. Bright blue sky
马匹仿佛在女性形体上奔                                with soft white and pink
                                                    clouds in the background.

========== 主合集 第 78 页 ==========

跑                                          The green landscape
                                                         texture covers both the
风格：超现实艺术、当代                                             woman's silhouette and
美术美学                                               parts of the horses,
                                                        creating a unified organic氛围：梦幻、象征性、诗
                                                      composition. Surreal art
意
                                                             style with vivid saturated
主题：自由、自然、女性                                colors - deep blues,
                                                          vibrant greens, whites,气质、野性精神
                                             and striking pink.
比例：7:3                                         Dreamlike and symbolic
                                             mood, themes of
                                                   freedom, nature,
                                                             femininity, and wild spirit,
                                                 contemporary fine art
                                                        aesthetic --ar 7:3 --style
                                              raw --v 6

主体：白马在田野中奔跑                       An impressionistic
                                                         painting of a white horse
绘画风格：印象派、表现                                                     running through a vibrant
主义、松散的手势笔触                                     colorful landscape,
                                                        abstract and expressive马匹表现：略微模糊，暗
                                                   brushwork, dreamlike and
示速度和运动感
                                                       energetic atmosphere,
色彩构成：水平色带和色                              bold color palette. A white
                                                  horse in motion galloping块
                                                   across a field rendered
翠绿色、柔和粉色、紫                                  with loose, gestural
色、蓝色、橙色、黄色                                 brushstrokes. The
                                                  landscape is composed
景观：抽象但可辨认的田                                                            of horizontal bands and
园场景                                            patches of vivid colors -
                                                 emerald greens, soft背景：山丘或植被的暗
                                                          pinks, purples, blues,
示、彩色花卉区域
                                                   oranges, and yellows -
天空：深蓝色                                           creating an abstract yet
                                                     recognizable pastoral
技法：绘画质感、可见的                                                   scene. The horse
厚重笔触、画布上的色彩                           appears slightly blurred
混合                                                suggesting speed and
                                              movement. Background
氛围：梦幻、充满活力、                                            shows hints of hills or
自由                                                  vegetation with colorful
                                                        flowering areas. Deep

========== 主合集 第 79 页 ==========

情绪：野性能量                                      blue sky above. Painterly
                                                         texture with visible thick
美学：当代风景画、鲜艳                                                     brushstrokes and color
饱和色彩、动态构图                                 mixing on canvas,
                                                         impressionistic and比例：7:3
                                                         expressionistic art style.
                                            Sense of freedom and
                                                           wild energy,
                                                 contemporary landscape
                                                         painting aesthetic with
                                                          vibrant saturated colors
                                             and dynamic composition
                                                                --ar 7:3 --style raw --v 6

艺术形式：超现实拼贴艺                     A surreal collage artwork
术、混合媒介                                              of a woman's portrait with
                                                    her face obscured by a
主体：女性肖像，深色蓬                              layered landscape scene
松头发                                                   featuring horses and
                                                        nature, dreamlike and
背景：深蓝色
                                                        poetic composition,
核心创意：眼睛和上半脸                                 vibrant colors,
                                                 contemporary mixed被风景图像条带遮挡
                                              media aesthetic. A
风景元素：                               woman with dark
                                                  voluminous hair against a白色和彩色马匹在绿色山
                                             deep blue background,
丘上吃草                                                    her eyes and upper face
蓝色水面或天空                                    covered by horizontal
                                                               strips of landscape
不同尺度的马匹（前景                              imagery showing white
大，远景小）                                  and colored horses
                                                      grazing on green hills
延伸效果：风景条带延续
                                                        with blue water or sky.
到颈部和肩膀，肖像与自                                            The landscape bands
然场景无缝融合                                      continue across her neck
                                             and shoulders, creating a色彩：深蓝、翠绿、柔和
                                               seamless blend between
粉色、白色、大地色调                                                                portrait and nature scene.
技法：剪贴拼贴美学、可                        The horses appear in
                                                              different scales - some见边缘和分层
                                                           larger in the foreground,
风格：当代美术、概念摄                       some smaller in the
影美学                                                  distance. Colors include
                                             deep blues, emerald

========== 主合集 第 80 页 ==========

氛围：超现实、隐喻、梦                             greens, soft pinks,
幻、诗意                                               whites, and earth tones.
                                                    Collage art style with cut-
主题：身份、自然、自                              and-paste aesthetic,
由、潜意识                                                   visible edges and
                                                            layering. Surreal and
比例：7:3                                                     metaphorical mood,
                                              themes of identity,
                                                        nature, freedom, and the
                                                  subconscious mind.
                                                Contemporary fine art
                                             and conceptual
                                                  photography aesthetic --
                                                        ar 7:3 --style raw --v 6





 海边度假实拍风格提示词


            图片           提示词

视角：鸟瞰俯拍、正上方                                 Aerial top-down view of a
航拍视角                                                    pristine tropical beach
                                                        with crystal clear
构图：对角线分割（左侧                               turquoise water meeting
海水、右侧沙滩）                                     white sandy shore,
                                                  people swimming and
海水：清澈的绿松石色、
                                                            relaxing, natural and
浅水区                                                          vibrant colors, summer
                                                      vacation atmosphere.沙滩：纯白色细沙
                                                             Bird's eye view showing
人物：多人分散在画面中                              the diagonal division
（游泳、行走、坐卧）                            between shallow
                                                       turquoise ocean water on
细节：蓝色沙滩垫/毛巾、                                                      the left and pure white
海浪白色泡沫、左下角绿                          sand beach on the right.

========== 主合集 第 81 页 ==========

色热带植被                                               Multiple people scattered
                                                   across the scene - some
色彩：鲜艳自然色彩、绿                                             swimming in the clear
松石蓝+纯白+绿色                                                       water, others walking on
                                                      the beach, a few sitting or光线：明亮自然日光
                                                             lying on the sand. A blue
风格：真实航拍摄影、高                          beach towel or mat
清晰度                                                        visible on the upper sand
                                                       area. Lush green tropical
氛围：夏日度假、天堂海                                                      vegetation in the bottom
滩                                                                        left corner. Gentle waves
                                                        creating white foam along比例：7:3
                                                      the shoreline. Realistic
                                                             aerial photography style,
                                                            bright natural daylight,
                                                     high clarity and detail,
                                                              travel and leisure theme,
                                                    paradise beach aesthetic
                                                                --ar 7:3 --style raw --v 6

构图：情侣背影走向大海                     A romantic beach scene
                                                            of a couple walking hand
人物：左-女性白色比基尼                                                                 in hand into the turquoise
长黑发，右-男性蓝色泳                                                  ocean, tropical paradise
裤，手牵手、双臂展开                                     setting, natural and
                                                   candid moment, bright
海水：清澈的绿松石色和
                                               sunny day. Back view of
深蓝色、温柔波浪                                             a young couple entering
                                                      the water together -沙滩：白色细沙
                                       woman on the left
环境：左右两侧深色岩                              wearing a white two-
石、远处黄色浮标                                    piece bikini with long dark
                                                                hair, man on the right
光线：自然户外光线、明                                                  wearing blue swim
亮晴天                                                   shorts, both holding
                                              hands with arms氛围：浪漫、度假、自由
                                                        outstretched. Crystal
自在
                                                          clear turquoise and deep
风格：生活方式摄影、自                              blue ocean water with
                                                       gentle waves, white然抓拍感
                                               sandy beach beneath
主题：热带海滩、情侣旅                                    their feet. Dark rocky
行                                                    formations on both left
                                             and right sides of the
比例：7:3                                                     frame, yellow buoys

========== 主合集 第 82 页 ==========

                                                               visible in the distance on
                                                      the water. Natural
                                                    outdoor lighting, vacation
                                             and romance theme,
                                                                    lifestyle photography
                                                                 style, candid and carefree
                                             mood, tropical beach
                                                        aesthetic --ar 7:3 --style
                                              raw --v 6

场景：热带海湾、隐秘沙                     A scenic tropical beach
滩                                              cove with white sand and
                                                       turquoise water, tourists
前景：一对情侣坐在白色                                relaxing and swimming,
毛巾上，其他游客在后方                             dramatic limestone cliffs
日光浴和行走                                      covered in lush green
                                                        vegetation, natural
海水：清澈的绿松石色浅                                                    paradise setting, bright
水区、温柔波浪                                            daylight. Foreground
                                            shows a couple sitting on沙滩：白色细沙、弧形海
                                                      white towels on the sandy
湾                                                  beach, other beachgoers
地质特征：巨大的石灰岩                                  lying down sunbathing
                                             and walking in the喀斯特悬崖
                                                  background. Crystal clear
植被：茂密的热带绿色植                              turquoise-green shallow
物、垂挂的藤蔓                                     water with gentle waves,
                                                  people wading and
人物活动：放松、日光                                                swimming. Massive
浴、游泳、涉水                                      limestone karst cliff
                                                      formations rising on the光线：自然户外光线、悬
                                                                right side and
崖遮挡形成斑驳阴影                                                  background, covered with
风格：旅行摄影、真实鲜                          dense tropical greenery
                                             and hanging vines. White艳色彩
                                               sandy beach curving
氛围：度假休闲、东南亚                             along the cove. Natural
热带海滩美学                                       outdoor lighting with
                                                 dappled shadows from
比例：7:3                                                      the cliff overhang. Travel
                                                  photography style,
                                                      vacation and leisure
                                                 theme, Southeast Asian
                                                              tropical beach aesthetic,
                                                                   realistic and vibrant

========== 主合集 第 83 页 ==========

                                                        colors --ar 7:3 --style raw
                                                                --v 6



 李安《卧虎藏龙》影像风格提示词


            图片           提示词

人物近景                                A dreamy and ethereal
                                                                portrait of a young Asian
                                       woman partially hidden
                                                  behind lush green foliage,
                                                         natural outdoor setting,
                                                              soft and mysterious
                                                  atmosphere, cinematic
                                                  photography style. Close-
                                             up portrait of a beautiful
                                              young Asian woman with
                                                                        fair porcelain skin, dark
                                                     eyes, and natural pink
                                                                       lips, gazing directly at the
                                             camera with a calm and
                                                     enigmatic expression.
                                                   Strands of her dark black
                                                            hair fall across her face.
                                          She is partially obscured
                                               by vibrant green leaves
                                             and plants in the
                                                      foreground, creating a
                                                         natural frame and sense
                                                            of mystery. Soft diffused
                                                         natural lighting filtering
                                                    through the foliage,
                                                        creating dappled light and
                                            shadow patterns on her
                                                          face. Shallow depth of
                                                                    field with bokeh effect on
                                                      the background greenery.
                                             Muted and natural color
                                                          palette dominated by
                                                       various shades of green

========== 主合集 第 84 页 ==========

                                             and soft skin tones.
                                                            Realistic photography
                                                                 style, intimate and
                                                     contemplative mood,
                                                    connection with nature
                                                 theme, fashion editorial
                                                        or fine art portrait
                                                        aesthetic --ar 7:3 --style
                                              raw --v 6

场景：两个人物漂浮/飞翔                       An ethereal and surreal
在茂密绿色森林树冠之上                          scene of two people in
                                                      white flowing garments
人物：身穿飘逸白色传统                                   floating or flying above a
亚洲长袍或汉服                                        vast lush green forest
                                                  canopy, dreamlike and
动作：优雅的飞行或漂浮
                                                   magical atmosphere,
姿势，衣袍在风中飘扬                                                     cinematic aerial
                                                        perspective. Two figures姿态细节：左侧人物伸出
                                                 dressed in flowing white手臂，右侧人物呼应相似
                                                                traditional Asian robes or
姿势                                                  hanfu suspended in mid-
森林：丰富的绿色层次，                                      air above an endless sea
                                                            of dense green forest形成有质感的树叶地毯
                                                          treetops. The figures
光线：柔和自然日光，轻                           appear to be in graceful
微雾气或薄雾增添神秘感                                    flying or floating poses,
                                                        with their garments
风格：武侠或中国奇幻电                                                           billowing elegantly in the
影美学、武术电影灵感                                wind. One figure on the
                                                                           left reaches out with an氛围：空灵、超现实、梦
                                                 extended arm, while the
幻、魔幻                                                            figure on the right mirrors
视角：电影感航拍视角                           a similar floating posture.
                                            The forest below is a rich
情绪：失重感、自由感、                                tapestry of various
史诗感、诗意                                   shades of green, creating
                                             a textured carpet of
主题：人与自然的连接
                                                              foliage. Soft natural
比例：12:5（超宽画幅）                                 daylight with slight mist or
                                              haze adding to the
                                                        mystical quality. Wuxia or
                                                Chinese fantasy film
                                                           aesthetic, sense of
                                                    weightlessness and

========== 主合集 第 85 页 ==========

                                                   freedom, martial arts
                                               cinema inspired, epic and
                                                        poetic mood, connection
                                               between humanity and
                                                     nature theme --ar 12:5 --
                                                             style raw --v 6

场景：两个人物漂浮/飞翔                       An ethereal and surreal
在茂密绿色森林树冠之上                          scene of two people in
                                                      white flowing garments
人物：身穿飘逸白色传统                                   floating or flying above a
亚洲长袍或汉服                                        vast lush green forest
                                                  canopy, dreamlike and
动作：优雅的飞行或漂浮
                                                   magical atmosphere,
姿势，衣袍在风中飘扬                                                     cinematic aerial
                                                        perspective. Two figures姿态细节：左侧人物伸出
                                                 dressed in flowing white手臂，右侧人物呼应相似
                                                                traditional Asian robes or
姿势                                                  hanfu suspended in mid-
森林：丰富的绿色层次，                                      air above an endless sea
                                                            of dense green forest形成有质感的树叶地毯
                                                          treetops. The figures
光线：柔和自然日光，轻                           appear to be in graceful
微雾气或薄雾增添神秘感                                    flying or floating poses,
                                                        with their garments
风格：武侠或中国奇幻电                                                           billowing elegantly in the
影美学、武术电影灵感                                wind. One figure on the
                                                                           left reaches out with an氛围：空灵、超现实、梦
                                                 extended arm, while the
幻、魔幻                                                            figure on the right mirrors
视角：电影感航拍视角                           a similar floating posture.
                                            The forest below is a rich
情绪：失重感、自由感、                                tapestry of various
史诗感、诗意                                   shades of green, creating
                                             a textured carpet of
主题：人与自然的连接
                                                              foliage. Soft natural
比例：7:3（超宽画幅）                                  daylight with slight mist or
                                              haze adding to the
                                                        mystical quality. Wuxia or
                                                Chinese fantasy film
                                                           aesthetic, sense of
                                                    weightlessness and
                                                   freedom, martial arts
                                               cinema inspired, epic and
                                                        poetic mood, connection

========== 主合集 第 86 页 ==========

                                               between humanity and
                                                     nature theme --ar 7:3 --
                                                             style raw --v 6



 《横道世之介》影像风格提示词


            图片           提示词

金鱼池塘                                      a full shot of a young
                                       woman with dark hair,
                                                  wearing a white shirt and
                                             a black bow tie, floating
                                                  underwater with
                                             numerous orange
                                                          goldfish swimming
                                                around her. her face is
                                                        directed towards the
                                                 camera, and her arms
                                             and torso are visible. the
                                                   water is a clear blue, and
                                         some light patterns are
                                                               visible on the underwater
                                                        surface.

水中仰拍                                      an underwater shot
                                            shows a person sitting at
                                                      the water's surface,
                                                                  partially submerged.
                                             numerous goldfish swim
                                                                 in the blue water below,
                                         some near the surface,
                                         some deeper. white
                                                       objects resembling large
                                                       dice or icebergs, one with
                                                      the number '6' visible and
                                                    another with '1', float on
                                                      the surface. the water
                                               has ripples and
                                                              reflections, and the sky is
                                                                    light with some clouds

========== 主合集 第 87 页 ==========

                                                               visible above the water. a
                                                      small red logo with white
                                                              text is present in the
                                                 bottom right corner,
                                                       along. an emblem with a
                                                                                      'v' and '19' is in the top
                                                                   right.

水产市场                                      a wide shot captures a
                                              young woman with long
                                                   dark hair, wearing a white
                                                        short sleeved shirt and a
                                                   dark skirt, looking up
                                                               intently at multiple large,
                                                              brightly lit fish tanks filled
                                                        with numerous discus fish
                                                            of various colors,
                                                         including white, striped,
                                             and orange. the tanks are
                                                  arranged in rows, with
                                         some showing price signs
                                                                 in japanese characters.
                                                       "¥11,000!" is visible on a
                                                      sign above one tank.
                                                       "discus mix" is visible on
                                             a sign with prices
                                                     "¥6,300" and "¥11,000".
                                                    "¥18,000" is visible on
                                                    another price sign. the
                                                background shows more
                                                          illuminated fish tanks
                                                    extending into the
                                                        distance, creating an
                                              aquascape in a pet store
                                                              setting. the overall
                                                               lighting is dim except for
                                                      the brightly lit tanks.



 《森林边缘的寂寞》影像风格提示词

========== 主合集 第 88 页 ==========

            图片           提示词

场景：户外婚礼或庆典，                     A romantic and whimsical
阳光草坪                                           outdoor wedding or
                                                        celebration scene, young
男性人物：坐姿，黑色马                             couple in vintage-inspired
甲+白衬衫+领结，头戴绿                                       attire, soft natural lighting,
叶和小白花手工花环，温                         dreamy and joyful
                                                  atmosphere, cinematic暖微笑
                                                  photography style. A
女性人物：优雅简约白色                          young man sitting and
短袖连衣裙，站在旁边，                            wearing a black vest over
手轻柔地触碰或调整他的                              white shirt with bow tie,
                                                adorned with a花环
                                          handmade flower crown
互动：温柔亲密的姿态                                    of green leaves and small
                                                      white flowers on his
背景：模糊的宾客穿着浅                                                  head, smiling warmly. A
色复古服装，阳光草坪，                                              young woman in an
绿色植物，柔和散景                                  elegant simple white
                                                   dress with short sleeves
光线：温暖金色自然阳
                                                   stands beside him, her
光，柔和光晕                                             hand gently touching or
景深：浅景深，聚焦在情                                adjusting his flower crown
                                                                 in a tender gesture.侣身上
                                                      Blurred background
风格：复古婚礼美学、胶                           showing other guests in
片摄影灵感                                                light-colored vintage
                                                          clothing on a sunny
色彩：自然色彩、柔和对                                                    outdoor lawn with
比                                                 greenery and soft bokeh.
                                     Warm golden natural氛围：浪漫、异想天开、
                                                          sunlight creating a soft
梦幻、欢乐                                                      glow, shallow depth of
                                                                    field focusing on the情绪：亲密、真挚
                                                      couple. Vintage wedding
主题：乡村浪漫                                          aesthetic, intimate and
                                                              heartfelt moment, rustic比例：21:9（超宽画幅）
                                             romance theme, film
                                                  photography inspired look
                                                        with natural colors and
                                                       gentle contrast --ar 21:9 -
                                                               -style raw --v 6

========== 主合集 第 89 页 ==========

场景：大树下的户外聚                       A peaceful outdoor
会，复古欧洲乡村环境                                 gathering scene under a
                                                        large tree, three people
人物构成：三人坐在地上                                relaxing and enjoying
                                                        drinks together, vintage左：短金发年轻女性，浅
                                              European countryside
色无袖连衣裙
                                                              setting, warm natural
中：白胡子老年男性，黑                                   lighting with dappled
                                                shadows, nostalgic and马甲+白衬衫+深色帽子，
                                                 serene atmosphere.手持杯子
                                                Three people sitting
右：棕发年轻男性，浅米                               casually on the ground
                                                beneath a massive tree色或奶油色敞开衬衫+白
                                                            trunk. On the left, a裤子，手持饮品
                                              young woman with short
背景：巨大树干，白色墙                            blonde hair wearing a
壁                                                         light-colored sleeveless
                                                       dress. In the center, an
光线：柔和阳光透过树                                                            elderly man with white
叶，在墙上形成美丽的斑                           beard wearing a black
驳光影                                                vest over white shirt and
                                             a dark hat, holding a cup
姿态：放松、沉思的姿势                                                        or mug. On the right, a
风格：1970 年代欧洲电影                         young man with brown
                                                            hair wearing a light beige美学、胶片质感
                                                        or cream-colored open
色彩：自然柔和色调、温                                     shirt and white pants,
暖色系                                                also holding a drink. Soft
                                                          sunlight filtering through
氛围：宁静、怀旧、平和                                                          tree leaves creating
                                                            beautiful shadow patterns主题：生活切片、代际连
                                             on the white wall behind接、乡村质朴、永恒感
                                                  them. Relaxed and
比例：21:9（超宽画幅）                              contemplative poses,
                                                      vintage 1970s European
                                                                film aesthetic, natural
                                             muted color palette with
                                         warm tones, slice of life
                                             moment,
                                                         intergenerational
                                                    connection theme, rustic
                                             and timeless quality --ar
                                                   21:9 --style raw --v 6

========== 主合集 第 90 页 ==========

场景：乡村农场庭院，复                     A charming rustic
古欧洲乡村环境                                     farmyard scene with a
                                              young woman in white
主要人物：金发年轻女                               dress chasing or feeding
性，飘逸白色连衣裙，在                              chickens, vintage
院子里奔跑或行走                               European countryside
                                                              setting, warm golden
动物：多只白色鸡和鸭子                                                             sunlight, nostalgic and
散布在她脚边                                           pastoral atmosphere. A
                                              young woman with背景人物：穿棕色衣服的
                                                  blonde hair wearing a
人蹲着或在鸡群附近工作                                                        flowing white dress
建筑：质朴石头建筑、赤                              running or walking
                                                          energetically through a陶瓦屋顶、木质结构、风
                                                   farmyard courtyard,
化白墙                                                  surrounded by multiple
环境：大树提供阴凉、自                              white chickens and ducks
                                                       scattered around her feet.然泥土地面
                                                            In the background, rustic
光线：斑驳阳光透过树                               stone buildings with
叶，形成温暖金色调和柔                                 terracotta tile roofs,
和阴影                                      wooden structures, a
                                                        large tree providing
风格：1970 年代欧洲乡村                           shade, and a person in
电影美学、胶片质感                              brown clothing crouching
                                                        or working near the
色彩：自然柔和色调，以                                                      chickens. Weathered
白色、大地色和绿色为主                              white walls, natural dirt
                                                    ground, dappled sunlight氛围：怀旧、田园、生动
                                                                      filtering through tree
动感：运动感和活力感                               leaves creating warm
                                                  golden tones and soft主题：田园生活、永恒的
                                                shadows. Vintage 1970s
乡村魅力                                              European rural film
                                                           aesthetic, natural muted比例：21:9（超宽画幅）
                                                          color palette dominated
                                               by whites, earth tones,
                                             and greens, sense of
                                           movement and liveliness,
                                                        pastoral life theme,
                                                       timeless countryside
                                             charm --ar 21:9 --style
                                              raw --v 6

========== 主合集 第 91 页 ==========

场景：复古欧洲乡村，质                     A charming vintage
朴白色房屋外                                   European village scene
                                                        with people gathered
建筑细节：风化白色灰泥                               outside a rustic white
墙、两扇黄色木框窗户、                          house with yellow-framed
窗台上有红色天竺葵花盆                           windows, nostalgic 1970s
                                                                film aesthetic, warm
人物构成：四人                                                         natural lighting, slice of
                                                                              life atmosphere. Four最左：深色西装+软呢帽
                                                  people in a casual男性，手里拿着东西
                                                    outdoor setting against a
左窗：深色衣服女性探出                           weathered white stucco
身子                                                      wall with two windows
                                                          featuring yellow wooden
中央：金发年轻女性，浅                            frames and flower boxes
粉色无袖连衣裙，站在外                                with red geraniums. On
面                                                    the far left, a man in a
                                                   dark suit and fedora hat
右侧：橙棕色衬衫男性，                                                       holding something in his
双臂交叉                                          hands. In the left window,
                                             a woman in dark clothing光线：柔和自然日光
                                                       leaning out. In the center,
色彩：柔和温暖色调，白                         a young blonde woman
色、大地色和粉彩色                                wearing a light pink
                                                      sleeveless dress standing
风格：1970 年代欧洲乡村                                                         outside. On the right, a
电影美学、胶片质感                         man in an orange-brown
                                                                  shirt with arms crossed.
氛围：放松、沉思、怀旧
                                                        Soft natural daylight,
主题：社区生活、乡村生                         muted and warm color
                                                          palette with whites, earth活、永恒的乡村魅力
                                                       tones, and pastels.
情绪：生活切片、日常时                             Vintage European
刻                                                    countryside film aesthetic
                                                      reminiscent of 1970s
比例：21:9（超宽画幅）                                                  cinema, relaxed and
                                                     contemplative mood,
                                               community and rural life
                                                 theme, timeless rustic
                                             charm --ar 21:9 --style
                                              raw --v 6

场景：阳光明媚的草地山                     A idyllic outdoor picnic
坡，田园风光                                         gathering in a sunlit
                                        meadow with rustic

========== 主合集 第 92 页 ==========

人物活动：大群人分散在                           farmhouse in
画面中                                            background, large group
                                                            of people in vintage
前景：坐在毯子上野餐                                   clothing enjoying leisure
                                                          time, nostalgic European中景：站立或行走
                                                      countryside setting, warm
服装：1970 年代复古风                             golden afternoon light,
格，浅色连衣裙、帽子、                                pastoral and peaceful
                                                  atmosphere. Wide休闲装
                                                  landscape view of a
背景建筑：传统红棕色木                             grassy hillside meadow
质农舍、赤陶屋顶、绿树                                with multiple people
环绕                                                  scattered across the
                                               scene - some sitting on
远景：起伏的山丘和森林                              blankets having a picnic
                                                                 in the foreground, others草地：明亮的绿色草地
                                                     standing or walking in the
光线：明亮自然阳光，在                             middle ground, all
草地和树叶上形成温暖金                            dressed in vintage 1970s
                                                             style clothing including色调
                                                            light-colored dresses,
风格：复古欧洲电影美                                   hats, and casual attire. In
学、柔焦、自然色彩                                   the background, a
                                                                traditional red-brown
氛围：田园、宁静、怀旧                                           wooden farmhouse with
主题：社区感、团聚、夏                                 terracotta roof nestled
                                         among lush green trees,日休闲、乡村生活、永恒
                                                        with rolling hills and forest
的乡村田园诗
                                                                 in the distance. Bright
视角：广阔风景视角                                     natural sunlight creating
                                         warm golden tones
比例：21:9（超宽画幅）                                                   across the green grass
                                             and foliage. Vintage
                                              European film aesthetic,
                                                              soft focus and natural
                                                            colors, sense of
                                               community and
                                                      togetherness, summer
                                                            leisure and rural life
                                                 theme, timeless
                                                      countryside idyll --ar 21:9
                                                                 --style raw --v 6

场景：阳光草地上的家庭                     A heartwarming family
                                                           picnic scene with adults

========== 主合集 第 93 页 ==========

野餐                                         and children gathered on
                                             a blanket in a sunny
人物构成：七人（成人和                                           meadow, vintage 1970s
儿童）坐在白色毯子上                            European aesthetic,
                                         warm natural lighting,中心：格子连衣裙+深色
                                                                joyful and intimate
帽子女性，温暖微笑
                                                  atmosphere. A group of
周围：多个穿浅色衣服                            seven people - adults and
                                                         children - sitting together（白色和米色衬衫）的儿
                                             on a white blanket on童和其他成人
                                                       grass, engaged in a
互动：所有人紧密围坐，                            shared activity or meal. In
表情欢乐和专注，共同参                              the center, a woman in a
                                                 checkered dress and与活动或用餐
                                                   dark cap smiling warmly.
姿态：自然抓拍姿势，捕                          Around her, several
捉真实的团聚时刻                                       children in light-colored
                                                          clothing (white and beige
背景：柔焦的茂密绿树                                                                shirts) and other adults,
                                                                           all leaning in close光线：明亮自然阳光从上
                                                       together with expressions方照射，形成温暖光晕
                                                            of joy and concentration.
风格：1970 年代欧洲复古                               Bright natural sunlight
胶片摄影美学、柔和色                              from above creating a
                                         warm glow, lush green彩、温和对比
                                                        trees in the soft-focus
氛围：温馨、亲密、欢                              background. Candid and
乐、怀旧                                                natural poses capturing a
                                                 genuine moment of
主题：家庭纽带、代际连                                                      togetherness. Vintage
接、夏日时光、永恒的田                                    film photography
园魅力                                                  aesthetic with soft colors
                                             and gentle contrast,
比例：21:9（超宽画幅）                                                          family bonding and
                                                         intergenerational
                                                    connection theme,
                                                         nostalgic summer day
                                                              feeling, timeless pastoral
                                             charm --ar 21:9 --style
                                              raw --v 6

窗台偷瞄的山羊                                a white goat with small
                                                  horns and a dark collar
                                               peeks through an open
                                                 window, looking down at

========== 主合集 第 94 页 ==========

                                             a black baking tray filled
                                                        with numerous golden
                                              brown buns. two potted
                                                        plants with pink flowers
                                                    are to the right of the
                                              buns on the windowsill. a
                                                    red and white gingham
                                                           curtain is tied back on the
                                                                             left, a wooden window
                                                     frame. --ar 15:11

乡村牧场场景                                  a full shot of three figures
                                             and a cow standing in a
                                                   grassy area with a
                                           wooden fence in the
                                                  background. a young boy
                                                                 in a striped shirt and dark
                                                       shorts stands on the left,
                                                           his hand near his mouth.
                                             a young girl with pigtails
                                               wears a colorful block
                                                     patterned shirt with a red,
                                                          yellow, and blue design,
                                                                    light shorts, and stands
                                                     next to the cow, touching
                                                                           its back. the cow is brown
                                             and white, has a chain
                                                around its head, and is
                                                      grazing in the grass. an
                                                        older man in a dark vest,
                                                      white shirt with elbow
                                                     patches, and a light
                                                     colored apron stands on
                                                      the right, holding the
                                                   cow's chain. the ground
                                                                      is covered in green grass
                                             and small plants. --ar
                                                  15:11



 《cmbyn》影像风格提示词

========== 主合集 第 95 页 ==========

            图片           提示词

亲吻                                             two men are kissing in a
                                               sunny field of tall grass
                                             and plants. the man on
                                                      the left has dark curly hair
                                             and is wearing a loose
                                                      white long sleeved shirt.
                                             he is leaning in towards
                                                      the other man. the man
                                             on the right has lighter
                                                  brown, slightly wavy hair
                                             and is wearing a light
                                                     colored striped long
                                                   sleeved shirt, with the
                                                               collar open. his left hand
                                                                      is lightly gripping the front
                                                            of his shirt near his chest.
                                                      the background shows a
                                                        continuation of the field
                                                        with some scattered trees
                                             and a hazy sky.

抚摸                                             two men are lying on their
                                                      sides in lush green grass
                                                 under natural light. one
                                             man, on the right, is
                                                  wearing a light colored,
                                                           striped collared shirt with
                                                        short sleeves and has
                                                                    light brown hair styled to
                                                      the side. he is positioned
                                              above the other man and
                                                appears to be gently
                                                     touching his face or neck
                                                        with his right hand. the
                                               second man, lying on his
                                               back on the left, has dark
                                                           curly hair and is wearing
                                             a light colored t shirt with
                                             a dark design on the
                                                                  front. a patterned
                                                   garment, possibly a
                                                      blanket or scarf, is

========== 主合集 第 96 页 ==========

                                                draped over his lower
                                                   body. the background
                                                       consists of more green
                                             and light brown wild
                                                       grass, indicating an
                                                       outdoor, natural setting.

躺在草坪上                                       two men are lying on their
                                                backs in tall green grass
                                                 under natural light. one
                                             man, on the left, has dark
                                                            hair and is wearing a light
                                                     colored shirt with a
                                                        pattern and patterned
                                                          shorts. his arm is visible.
                                                      the other man, on the
                                                                   right, has light brown hair
                                             and is wearing a light
                                                     colored long sleeved shirt
                                             and white pants with
                                                       three red stripes on the
                                                           side. both men are
                                                       looking upwards. the
                                                   grass is abundant and
                                                   covers the ground, with
                                         some patches of dry
                                                   grass in the background.

对视                                             two men are in a field
                                                        with tall green and brown
                                                       grass, under a bright sky.
                                             one man is lying on his
                                                    back, looking up and
                                                           smiling, wearing a light
                                                     colored striped shirt. the
                                                       other man is lower, on his
                                              stomach or hands and
                                                   knees, with his head
                                               down, wearing a white t
                                                                     shirt. the man looking
                                          down has curly dark
                                              brown hair and appears
                                                            to have something red on
                                                           his lips or chin. in the
                                                  background, there are

========== 主合集 第 97 页 ==========

                                                rows of green plants,
                                                        possibly crops. a small
                                                      white square .

躺在草垫上                                 An adult man lying on
                                                       grass, bare-chested
                                                  wearing yellow shorts, a
                                              book open on his chest,
                                             head resting on a green
                                                      cushion. Background with
                                                        blurred green vegetation
                                             and distant building
                                                             outlines. Horizontal
                                                      composition, diagonal or
                                                                  slightly tilted angle. Bright
                                                        colors with moderate
                                                           saturation, strong light
                                             and shadow contrast.
                                                   Cinematic film screenshot
                                                             style with natural lighting.
                                        Summer sunlight warmth.

弹吉他少年                                    a young man with dark,
                                                           curly hair sits on a mossy
                                                   stone bench in a lush
                                                 green outdoor setting,
                                                       playing an acoustic
                                                               guitar. he wears denim
                                                       shorts and a thin gold
                                                    chain around his neck.
                                                           his right arm is draped
                                                    over the guitar, and his
                                                                           left hand is on the
                                                           fretboard. the guitar has a
                                                                    light brown body with a
                                                     darker back and sides,
                                             and a lighter blue or white
                                                   design on the front. to his
                                                                           left on the bench are two
                                                   books. a large tree with
                                                       textured bark and vines is
                                                               visible behind him to the
                                                                   right, and abundant green
                                                           foliage fills the
                                                  background, suggesting a

========== 主合集 第 98 页 ==========

                                                            forest or garden.

桃子                                         a close up shot of ripe
                                              peaches on a tree,
                                                  surrounded by green
                                                       leaves. the peaches are a
                                                mix of red, orange, and
                                                      yellow hues. sunlight
                                                                         filters through the leaves,
                                                        creating bright spots in
                                                      the background. the
                                                    focus is on a prominent
                                              peach in the center right,
                                                        with other peaches visible
                                                                 in the foreground and
                                                  background, partially
                                                 obscured by foliage. the
                                              image captures the
                                                         natural texture of the fruit
                                             and leaves.



 《傲慢与偏见》影像风格提示词


            图片           提示词

躺在椅子上                              A young woman lying in a
                                                      white bathtub outdoors,
                                                  surrounded by lush green
                                                           foliage and trees, golden
                                                  hour sunlight filtering
                                                    through leaves creating
                                         warm bokeh effects,
                                                      she's holding a small
                                                      potted plant, dreamy and
                                                        ethereal atmosphere, soft
                                                    focus on foreground
                                                       leaves, warm color
                                                     grading with orange and
                                                      yellow tones, cinematic
                                                                 lighting, shallow depth of

========== 主合集 第 99 页 ==========

                                                                       field, romantic and
                                                    whimsical mood --ar 21:9
                                                                 --style raw --v 6

花园里浇花                              A woman in a flowing
                                                      white dress standing in a
                                                          vibrant yellow flower field,
                                                  surrounded by lush green
                                                            trees, magical light rays
                                                        bursting through the
                                                           foliage creating a dreamy
                                                   haze, ethereal and
                                                        mystical atmosphere, soft
                                                         diffused sunlight, glowing
                                                             particles in the air,
                                                     cinematic composition,
                                         warm and cool color
                                                        contrast with golden
                                                      yellows and deep greens,
                                                                  fairy tale aesthetic,
                                                     shallow depth of field,
                                                    romantic and enchanting
                                        mood --ar 21:9 --style raw
                                                                --v 6

花园里舞蹈                                Two young women
                                                  dancing joyfully in a
                                                  golden sunlit meadow
                                                                         filled with yellow
                                                          wildflowers, flower petals
                                                              floating and swirling
                                                    through the air, one
                                       woman wearing white
                                                                  shirt with black
                                                suspender overalls
                                                       holding yellow flowers,
                                                      the other in white top with
                                                burgundy red skirt, both
                                                        with long flowing hair,
                                                  golden hour warm lighting
                                                        creating a dreamy
                                                   atmospheric glow, soft
                                              haze and bokeh effect,
                                                          vibrant yellow and green
                                                          color palette, cinematic

========== 主合集 第 100 页 ==========

                                                      composition, shallow
                                                  depth of field, carefree
                                          summer vibes, friendship
                                             and joy theme, nostalgic
                                             and romantic mood --ar
                                                   21:9 --style raw --v 6

教做作业                                A mother and child doing
                                           homework together at a
                                                       kitchen table in a warm
                                              1980s home, woman in
                                                   beige cardigan leaning
                                                    over to help young boy in
                                                            plaid shirt, vintage
                                                       kitchen with white
                                                      cabinets and checkered
                                                                   floor, soft warm tungsten
                                                               lighting creating a cozy
                                                         nostalgic atmosphere,
                                               books and papers spread
                                             on the table, rotary phone
                                                               visible on counter, shot
                                             on 35mm film, kodak
                                                         portra 400, film grain
                                                            texture, warm yellow and
                                                   beige color palette,
                                                         intimate family moment,
                                                     cinematic composition,
                                                     shallow depth of field,
                                                         nostalgic and tender
                                        mood --ar 21:9 --style raw
                                                                  --stylize 400 --v 6

人物特写                                          Close-up portrait of a
                                              young woman with long
                                            wavy golden blonde hair,
                                                         natural beauty, soft facial
                                                          features, green-blue
                                                     eyes, natural makeup
                                                        with rose-tinted lips,
                                                  wearing delicate lace or
                                                 embroidered beige dress,
                                                  golden hour backlighting
                                                        creating a warm glow on
                                                    her hair, soft bokeh

========== 主合集 第 101 页 ==========

                                                  background, dreamy and
                                                        ethereal atmosphere,
                                                     shot on 35mm film,
                                                     cinematic portrait
                                                    photography, shallow
                                                  depth of field, warm color
                                                          palette with golden and
                                                   beige tones, romantic
                                             and gentle mood, film
                                                        grain texture --ar 21:9 --
                                                             style raw --stylize 300 --v
                                             6

人物近景                                A young woman sitting on
                                             an ornate chair in a dimly
                                                                                                         lit room, contemplative
                                             and melancholic pose
                                                        with head resting on
                                                   knees, wearing a black
                                                       dress, warm cinematic
                                                               lighting with orange and
                                            amber glow from the left
                                                       side creating dramatic
                                              bokeh effect, window with
                                                            grid pattern in the
                                                  background, moody and
                                                         intimate atmosphere,
                                                     shot on 35mm film,
                                                     cinematic movie scene,
                                                     shallow depth of field,
                                         warm color palette with
                                                    orange, amber and deep
                                                     blue tones, emotional and
                                                          introspective mood,
                                                    dramatic lighting, film
                                                        grain texture --ar 21:9 --
                                                             style raw --stylize 500 --v
                                             6

迷雾中走来                              A solitary figure standing
                                                                 in a misty valley at dawn,
                                                          silhouette of a person in
                                                   dark clothing facing
                                                away, thick fog rolling
                                                    through the landscape,

========== 主合集 第 102 页 ==========

                                                       forested mountains on
                                                   both sides, dramatic
                                                    cloudy sky with soft pink
                                             and orange hues at
                                                         sunrise, layers of
                                                   atmospheric haze
                                                        creating depth, moody
                                             and contemplative
                                                  atmosphere, epic
                                                     cinematic landscape
                                                    photography, muted color
                                                          palette with blue-grey fog
                                             and warm sky tones,
                                                    mysterious and
                                                    melancholic mood,
                                                        ethereal and dreamlike,
                                                 wide composition --ar
                                                   21:9 --style raw --stylize
                                             600 --v 6

花园看书                                A young woman reading
                                             a book outdoors in
                                                  golden hour sunlight,
                                                  wearing an elegant black
                                                      period dress with short
                                                       sleeves, hair styled in a
                                                           classic updo with loose
                                                        strands, soft focused
                                                    expression looking down
                                                            at an open book, warm
                                                         backlighting creating a
                                                  golden rim light around
                                                    her silhouette, lush green
                                                        trees in the soft focus
                                                  background, dreamy and
                                                    romantic atmosphere,
                                                      period drama aesthetic,
                                                     shot on 35mm film,
                                                     cinematic composition,
                                                     shallow depth of field,
                                         warm color palette with
                                                  golden yellows and soft
                                                     greens, peaceful and
                                                     contemplative mood,
                                                        ethereal glow, soft

========== 主合集 第 103 页 ==========

                                                               lighting --ar 21:9 --style
                                              raw --stylize 500 --v 6

夕阳下亲吻                              A romantic couple facing
                                              each other in intimate
                                          moment at golden hour
                                                      sunset, silhouette
                                                    composition with warm
                                                           backlighting, young
                                       woman with wavy hair
                                                       looking up at man in dark
                                                                 suit jacket and white shirt,
                                                                their faces close together
                                                  about to kiss, brilliant
                                                  golden sun creating a
                                                     halo effect between them,
                                                       lens flare and sun rays,
                                         warm color palette with
                                                  golden yellows and soft
                                                orange tones, dreamy
                                             and romantic
                                                  atmosphere, shot on
                                    35mm film, romantic
                                               movie scene, cinematic
                                                      composition, shallow
                                                  depth of field with soft
                                                  bokeh, emotional and
                                                     tender mood, golden
                                                 glow --ar 21:9 --style raw
                                                                  --stylize 600 --v 6



 《泰坦尼克号》影像风格提示词


            图片           提示词

甲板对话                                         two women are seated,
                                             engaged in conversation
                                             on an outdoor deck. the
                                       woman on the left has
                                                    red hair and is wearing a

========== 主合集 第 104 页 ==========

                                                                    light colored dress with
                                                 green embellishments
                                             and pearl drop earrings.
                                                    her right hand is near the
                                                       other woman's hands. the
                                       woman on the right has
                                                           curly brown hair and is
                                                  wearing a dark blue dress
                                                        with a white collar, a
                                                      white apron, and a white
                                                     cap. a small, round,
                                                 bronze colored pendant
                                                        or brooch is pinned to her
                                                        chest. she is holding a
                                                          small, red, round object in
                                                    her hands. in the
                                                  background, there is a
                                           wooden table with a silver
                                                      teapot and a silver dish.
                                                     wicker chairs are visible
                                             on either side of the
                                       women and behind them.
                                             a dark colored jacket is
                                                draped over a wicker
                                                          chair on the far right.
                                                 green plants are also
                                                               visible in the background.

喝茶特写                                      a medium shot of rose
                                                          dewitt bukater from
                                                                     titanic, seated outdoors in
                                             a wicker chair, holding a
                                                      white teacup and saucer.
                                               she is bathed in warm
                                                          sunlight from the right,
                                                           highlighting her auburn
                                                                hair, styled partly in an
                                             updo and partly in a braid
                                                    over her shoulder. she
                                               wears a pale yellow dress
                                                        with delicate lace overlay
                                             and floral patterns. her
                                                                    light skin, red lipstick, and
                                                        pearl drop earrings are
                                                               visible as she gazes to

========== 主合集 第 105 页 ==========

                                                      the right. the background
                                                                      is blurred, showing green
                                                           foliage and architectural
                                                 elements like windows
                                             and columns, with a hint
                                                            of red flowers on a table
                                                            to the far right.



 巨物美学影像风格提示词


            图片           提示词

金色殿堂                                      a vast, monumental
                                               scene featuring a
                                                          colossal, white, draped
                                                            figure standing centrally,
                                                          illuminated by bright
                                                          sunlight from the left. dust
                                                             particles are visible in the
                                              sunbeams. the figure
                                                     casts a sharp shadow on
                                                      the right wall. the ground
                                                                      is a flat, expansive, dark
                                              brown surface. small,
                                                         silhouetted human figures
                                                  walk on the ground,
                                                        creating a sense of
                                           immense scale. haze and
                                                    clouds are present on the
                                                                           left side, behind the
                                                               figure. the overall color
                                                          palette is warm, with
                                                      strong contrasts between
                                                                    light and shadow. the
                                              image has a watermark
                                                        with chinese characters .

红桥                                         a digital rendering of a
                                                     grand, dark, and misty
                                                            architectural scene with a

========== 主合集 第 106 页 ==========

                                                 dominant red draped
                                                               figure. numerous dark,
                                                     ornate lanterns hang by
                                                    chains from above,
                                                          illuminated by faint light
                                                                      filtering through the haze.
                                                         structures with railings
                                             and decorative elements
                                                    are stacked, creating a
                                                           multi level environment.
                                                                 in the background, large
                                                              circular patterns are
                                                               visible on the wall, and in
                                                      the foreground at the
                                                     bottom, smaller figures in
                                                    red attire are on a lower
                                                         bridge.

赛博风                                        a scene rendered in a
                                                     dystopian aesthetic
                                                       features two central
                                                          figures in orange robes
                                                     standing on a dark, wet,
                                             and reflective walkway.
                                                      the figure in the
                                                    foreground is seen from
                                                      behind, looking left, while
                                                      the figure in the
                                                midground looks right. to
                                                      the right of the walkway,
                                             a vast array of smaller,
                                                   dark figures stand in
                                                   organized rows,
                                                          illuminated by a vivid
                                                orange light that appears
                                                            to be fire or energy,
                                                         emitting sparks. above,
                                                          colossal, grey,
                                                            architectural elements
                                                        with visible cables extend
                                              upwards into a hazy,
                                                            bright expanse. the
                                                 dominant colors are dark
                                                       greys, deep oranges, and
                                                          white.

========== 主合集 第 107 页 ==========

 日系影像风格提示词


         图片       图片提示词     视频提示词

水族馆背影                         a wide shot from   运镜：固定机
                                      behind of two    位，轻微呼吸感
                                        people, an adult and                            晃动日系电影空
                                  a child, standing in
                             镜，清冷蓝调，                                  an aquarium,
                             少年少女背对着                                         looking up at the
                                           illuminated water. a  镜头站在水族馆
                                          large dolphin swims 前，望向巨大的
                                                in the upper left,                             水族箱，箱内海
                                         while a ray or large                             豚与鱼群游动，
                                                fish is partially
                             阳光透过水面洒                                                visible in the bright
                                     area to the right.   下光束，画面带
                                         smaller fish are   有轻微胶片颗粒
                                         scattered      和柔焦光晕，整
                                       throughout the blue                             体色调偏清冷的
                                         water, which is
                             蓝调，镜头固定
                                          heavily lit by
                             不动，仅捕捉鱼                                            sunlight filtering
                                      from the surface,   群游动与光束的
                                          creating visible light 变化，传递出静
                                        rays and patterns of 谧又浪漫的氛
                                                     light. the adult on                             围。
                                        the left wears a light
                                        colored top with a
                                             strap, and the child
                                  on the right wears a
                                       red top with a white
                                             strap.

水族馆双人仰拍                  A cinematic shot   运镜：缓慢拉
                                  showcases two   远，轻微呼吸感
                                          characters, with a                            晃动日系电影特
                                              particular focus on a
                             写镜头，清冷蓝                                        boy. His gaze is
                             调，水族馆前的                                  upward and he is
                                         leaning against a   少年少女仰头望

========== 主合集 第 108 页 ==========

                                      prominent blue    向镜头，背景是
                                      background. The   巨大的蓝色水族
                                     person on the right                             箱，水中的光斑
                                   has dark, textured
                             和气泡营造出梦                                             hair and fair skin,
                             幻氛围，画面带                                          with a soft facial
                                          contour. He is    有轻微胶片颗粒
                                      wearing a dark blue 和柔焦光晕，整
                                          or gray collared                             体色调偏清冷的
                                                    shirt. The left edge                             蓝调，镜头缓慢
                                                  faintly reveals a
                             拉远，捕捉两人                                     person wearing a
                                       red sweater, with a  安静又温柔的神
                                    buzz cut, looking   态，传递出水族
                                      towards the main   馆独有的治愈氛
                                          character. The                             围。
                                    background is a
                                       uniform blue with
                               some subtle light-
                                        colored spots,
                                           giving a sense of a
                                         vast and open
                                      space.

短发少女特写                          Cinematic portrait of 运镜：缓慢推
                                  a young Asian    近，轻微呼吸感
                             woman with                            晃动日系电影特
                                         shoulder-length
                             写镜头，清冷蓝                                        black straight hair
                             调，短发少女穿                                  and bangs, wearing
                                  a dark red      着酒红色高领毛
                                           turtleneck sweater,  衣，侧脸望向镜
                                         side profile view                             头，背景是虚化
                                         looking to the left,                             的城市夜景，画
                                    calm melancholic
                             面带有轻微胶片                                         expression, soft
                                         side lighting on    颗粒和柔焦光
                                           face, deep blue   晕，整体色调偏
                                      background,     清冷的蓝调，镜
                                        shallow depth of                             头缓慢推近，捕
                                                     field, blurred
                             捉少女温柔又坚
                                            silhouette of another
                             定的眼神，传递                                     person in dark coat
                                                in foreground right,  出都市夜晚的疏
                                         cool blue color

========== 主合集 第 109 页 ==========

                                       grading with warm  离与心动氛围。
                                       red accent, low
                                            saturation, high
                                            contrast, moody
                                     atmosphere,
                                    Japanese/Korean
                                                film aesthetic,
                           35mm film look,
                                      atmospheric
                                                 lighting, emotional
                                               storytelling
                                       composition

海边小摊三人                       a medium shot on a 运镜：固定机
                                  beach shows three  位，轻微呼吸感
                                        people, an adult                            晃动日系胶片电
                                  man, an adult
                             影质感，夏日海                                woman, and a
                             边小摊，穿红衬                                   young child, at an
                                       outdoor counter. the 衫的卷发男人、
                             man on the left    穿白上衣的少女
                                   wears a white                             和小男孩，围在
                                    headband, a red                             小摊前，少女正
                                          short sleeved shirt
                             在操作摊位上的                                          with a white pattern,
                                  and a white     饮品机，背景是
                                            undershirt. he has  沙滩、大海和绿
                                          dark, curly hair and  色遮阳伞，画面
                                                    is looking down and                             带有复古胶片颗
                                             to his right. the
                             粒感，整体色调
                             woman in the
                             偏清冷的浅绿                                           center, with long
                                       dark hair tied back  调，镜头固定不
                                                in a ponytail, wears  动，仅捕捉三人
                                  a white short    的互动与摊位的
                                      sleeved shirt and a                             细节，传递出慵
                                                   light colored skirt
                             懒治愈的海边日                                               tied at the waist.
                                   she is scooping   常氛围。
                                     something into a
                                        small cup with a
                                        blue and white
                                      design held by her
                                                        left hand. a light
                                        blue shaved ice

========== 主合集 第 110 页 ==========

                                   machine is on the
                                                right of the counter.
                                      behind the machine,
                                  a child with dark
                                             hair is partially
                                                 visible, looking
                                          forward. in the
                                      background, the
                                  ocean is visible
                                     under a cloudy sky,
                                          with beach
                                       umbrellas and white
                                          chairs on the sand. -
                                              -ar 3:2

小镇街道少年少女                   a full shot shows a  运镜：固定机
                                   young woman with  位，轻微呼吸感
                                        long dark hair,                            晃动日系胶片电
                                      wearing a yellow t
                             影质感，夏日小
                                                  shirt and jeans,
                             镇街道，穿黄色                                        standing on the left
                                         side of a paved      T 恤的少女和穿
                                          path. to her right, a  白色T 恤的少
                                   young man with                             年，推着自行车
                                       dark hair, wearing a                             站在路边，背景
                                        white t shirt with
                             是电线杆和远处                                          "glen crist 26 track"
                                  and dark pants, is  的房子，画面带
                                       walking beside a   有复古胶片颗粒
                                        blue and silver    感，整体色调偏
                                             bicycle, holding its                             清冷的浅绿调，
                                        handlebars. a blue
                             镜头固定不动，
                                  and white road sign
                             仅捕捉两人安静                                          depicting two
                                            figures walking is   站立的状态，传
                                                visible behind the  递出清新的青春
                                woman. in the    日常氛围。
                                      background, there
                                       are houses, trees,
                                   power lines, and a
                                       cloudy sky.

花店写字少女                       a close up,     运镜：缓慢推
                                        cinematic shot    近，轻微呼吸感
                                 shows a woman

========== 主合集 第 111 页 ==========

                                          with dark hair tied in 晃动日系胶片电
                                  a high ponytail,   影特写镜头，清
                                     dressed in an off                             冷柔和的青调，
                                       shoulder white
                             穿白色露肩绣花                                      blouse with blue
                             上衣的少女俯身                                     embroidered
                                        designs, intensely  低头，专注地在
                                     focused while    花丛边写字，周
                                              writing on a small                             围环绕着红白鲜
                                        white notepad with                             花，背景虚化，
                                  a silver pen. she is
                             画面带有复古胶                                   seen in profile,
                                         looking down,    片颗粒感与柔焦
                                     surrounded by    光晕，整体色调
                                         various green plants 偏清冷的浅绿
                                  and colorful flowers,                             调，镜头缓慢推
                                           including red,
                             近，捕捉少女温
                                       orange, and white
                             柔专注的神态，                                      blossoms, creating
                                  a lush, vibrant    传递出安静治愈
                                        foreground. the   的氛围。
                                    background is softly
                                          blurred with hints of
                                     green foliage.

夜晚小镇观景台                     a full shot of two   运镜：缓慢推
                                        people, a man and  近，轻微呼吸感
                                  a woman, sitting                            晃动日系电影质
                                     under a rustic
                             感，清冷蓝调，                                wooden shelter on a
                             夜晚的海边小镇                                       gray sandy or
                                      pebbly ground. the  观景台，穿蓝上
                             woman on the left  衣的女人和穿白
                                   wears a blue                             衬衫的男人并肩
                                        patterned dress and                             坐着，望向远处
                                        black flat shoes, her
                             的万家灯火与海                                             hair appears wet.
                                   she holds a spoon,  面，背景是连绵
                                      scooping from a   的山脉，夜色中
                                                   light blue bowl held  透出小镇的点点
                                    by the man on the                             灯光，画面带有
                                                   right. the man wears
                             复古胶片颗粒感
                                  an orange and blue
                             与柔焦光晕，整                                                    floral short sleeved
                                                    shirt, light colored  体色调偏清冷的

========== 主合集 第 112 页 ==========

                                            shorts, and brown  蓝调，镜头缓慢
                                        sandals. his hair is  推近，捕捉两人
                                       dark and short. a                             温柔对视的瞬
                                         hat rests on the
                             间，传递出浪漫                                  bench next to him.
                             又安静的氛围。                                                in the foreground, to
                                        the left, a chicken is
                                                visible on the
                                       ground. the
                                    background
                                          features green
                                               foliage, suggesting
                                  an outdoor, possibly
                                             natural, setting. the
                                               lighting suggests
                                        overcast weather.

碎石海滩对坐                       a woman and a man 运镜：固定机
                                                         sit on a beach    位，轻微呼吸感
                                 composed of sand                            晃动日系电影质
                                  and stones. the
                             感，清冷青调，
                             woman wears a
                             夏日碎石海滩                                        blue t shirt and a
                                        spotted skirt, while  上，穿蓝上衣波
                                        the man wears a   点裙的女人和穿
                                                   light shirt and dark                             白衬衫的男人对
                                           trousers. behind                             坐交谈，背景是
                                      them, a rocky
                             灰色的岩石与茂                                     mountain covered
                                          with green      密的绿植，海面
                                         vegetation is visible. 风平浪静，画面
                                          driftwood pieces are 带有复古胶片颗
                                         scattered on the                             粒感，整体色调
                                    ground near them.
                             偏清冷的浅绿
                                       both are looking
                             调，镜头固定不                                      towards the right
                                         side of the frame. a  动，仅捕捉两人
                                      chinese character  安静交谈的状
                                    watermark is     态，传递出治愈
                                       present at the                             又松弛的氛围。
                                     bottom right.

雨中小亭喂食                       a wide outdoor shot 运镜：固定机
                                             at dusk or night   位，轻微呼吸感
                                          features two young

========== 主合集 第 113 页 ==========

                                              individuals, a    晃动日系电影质
                             woman and a man,  感，清冷青调，
                                     seated on a wooden                             夏日雨天的乡村
                                      fence overlooking a
                             木亭下，穿蓝上                                         coastal town. the
                             衣花裙子的女                                woman, on the left,
                                   wears a light blue  人，用勺子喂穿
                                          short sleeved top   橙色花衬衫的男
                                               tied at the front over                             人吃东西，男人
                                  a white top and a                             手里捧着蓝色的
                                                    floral patterned skirt.
                             碗，背景是被雨                                   she looks up and to
                                        the left. the man, on 水打湿的绿植，
                                        the right, wears a   雨丝清晰可见，
                                                   light blue short    画面带有复古胶
                                      sleeved button up                             片颗粒感与柔焦
                                                  shirt and dark pants,
                             光晕，整体色调
                                         looking to his right.
                             偏清冷的浅绿                                                in the background,
                                      across a body of   调，镜头固定不
                                         water, a town glows 动，仅捕捉两人
                                          with numerous    温柔互动与雨丝
                                                        artificial lights, and                             的流动，传递出
                                     mountains rise
                             治愈又暧昧的氛                                     under a dark blue
                                          sky.        围。

海边张开双臂                       a young woman   运镜：缓慢推
                                          with dark hair tied  近，轻微呼吸感
                                    back in a ponytail                            晃动日系胶片电
                                          stretches her arms
                             影特写镜头，夏                                   upwards on a bright
                             日海边，穿白色                                        day. she is wearing
                                  a white tank top and 背心的少女张开
                                          smiling with her   双臂，迎着海风
                                    eyes mostly closed.                             闭眼微笑，发丝
                                        the background                             被风吹起，背景
                                          features a light blue
                             是湛蓝的大海和                                          sky, a rocky
                                           shoreline, and some 岩石滩，阳光洒
                                     green foliage on the 在她脸上，画面
                                                right side. a faint   带有复古胶片颗
                                           structure is visible in                             粒感与柔焦光
                                        the distance on the
                             晕，整体色调偏
                                                          left.

========== 主合集 第 114 页 ==========

                             明亮的蓝调，镜
                             头缓慢推近，捕
                             捉少女舒展的瞬
                             间，传递出自由
                             治愈的青春氛
                             围。

沙滩小店少女                       a full shot captures  运镜：固定机
                                  a young woman in a 位，轻微呼吸感
                                        white tank top and                            晃动日系胶片电
                                         shorts adjusting a
                             影质感，夏日海
                                        white and green
                             边沙滩小店，穿                                  beach umbrella. the
                                   scene is outdoors,  白色背心和浅蓝
                                                   likely a beachside  短裤的少女，撑
                                        cafe area, with                             着绿白条纹遮阳
                                            multiple white                             伞，背景是彩色
                                              plastic tables and
                             招牌、红白旗帜                                          chairs on sandy
                                       ground. in the    和塑料桌椅，阳
                                      background, there  光明媚，画面带
                                       are other beach   有复古胶片颗粒
                                         umbrellas, one with                             感与柔焦光晕，
                                      "coleman" visible,
                             整体色调偏明亮
                                  and a light blue
                             暖调，镜头固定                                           structure that
                                    appears to be a   不动，仅捕捉少
                                        small shop or food  女撑伞的动作和
                                      stand with a red roof 微风带动的细
                                  and a large red                             节，传递出慵懒
                                      snowflake like
                             治愈的夏日氛                                    symbol on its side.
                                       red and white flags  围。
                                       are visible in the
                                   mid ground. a small
                                              child in a blue shirt
                                                  sits on the sand
                                      near some life
                                        preservers and a
                                         sign with japanese
                                                  text. the setting is
                                             bright and clear,
                                             indicating daylight.

========== 主合集 第 115 页 ==========

海边少年少女                       a full shot of a man  运镜：缓慢推
                                  and woman in a   近，轻微呼吸感
                                             bright outdoor                            晃动日系胶片电
                                               setting, possibly a
                             影特写镜头，夏                                  beach or
                             日海边，穿彩色                                amusement park.
                                        the man on the left  花衬衫的少年和
                                   has light brown    穿白T 恤的少女
                                         spiky hair and                             并肩站着，少年
                                   wears a colorful                             眼神看向远方，
                                          short sleeve button
                             少女略带娇憨地                                  up shirt with a floral
                                          or abstract pattern  看向前方，背景
                                                in red, yellow, blue,  是虚化的沙滩和
                                        green, and white. he 彩色装饰，画面
                                        looks forward with a                             带有复古胶片颗
                                           neutral expression.
                             粒感，整体色调
                                        the woman on the
                             偏明亮暖调，镜                                                right has dark hair
                                               tied back in a    头缓慢推近，捕
                                            ponytail and wears  捉两人的神态互
                                  a simple white t   动，传递出青春
                                                    shirt. she looks                             独有的暧昧氛
                                      towards her right
                             围。                                          with a slightly
                                    concerned or
                                      pensive expression,
                                       her mouth slightly
                                      open. in the
                                      background, out of
                                          focus, are other
                                        people, a red and
                                        white flag or sign
                                          with a circular motif,
                                  and a light blue
                                                vertical pole. a white
                                    watermark with
                                      chinese characters.

靠窗听歌少年                         two young men are  运镜：缓慢推
                                           inside a vehicle,   近，轻微呼吸感
                                          possibly a bus or                            晃动日系电影质
                                             car, with one in the
                             感，阳光透过车                                       foreground facing
                             窗洒进列车车                                                right with his head

========== 主合集 第 116 页 ==========

                               down and partially  厢，穿白衬衫的
                                      obscured. the    少年戴着白色耳
                                   second young man,                             机，靠在窗边闭
                                     seated further back,
                             目听歌，光影在                                                    is facing right and
                             他脸上缓缓流                                         looking out a
                                     window. he has   动，画面带有复
                                          short dark hair and  古胶片颗粒感与
                                                    is wearing a white                             柔焦光晕，整体
                                           collared shirt. white                             色调偏暖调，镜
                                    earbuds are visible
                             头缓慢推近，捕                                                in his ears, with the
                                         wire running down.  捉少年安静放空
                                            his right arm is bent, 的神态，传递出
                                  and his hand is   青春独有的慵懒
                                            resting near his                             与温柔氛围。
                                             chin. bright sunlight
                                     streams through the
                                     window, illuminating
                                            his face and shirt.
                                        the interior of the
                                          vehicle has blue
                                          patterns on the
                                          seats. --ar 34:15

车窗风景                           a bright, blurry,    运镜：固定机
                                                 slightly over shot   位，背景动态模
                                      from inside a                            糊日系电影质
                                            vehicle, looking out
                             感，列车车窗视                                  a window at a sun
                             角，窗外的绿树                                      drenched, vibrant
                                     green forest. the   与阳光因列车行
                                         sun's rays are    驶形成强烈的横
                                      prominent in the                             向运动拖影，光
                                     upper right, casting                             线透过树叶形成
                                  a strong glare. the
                             斑驳的光斑，画                                          trees and foliage
                                    appear as a moving 面带有复古胶片
                                             blur of green and   颗粒感，整体色
                               some blue sky,    调偏明亮的绿
                                             indicative of motion.                             调，镜头固定不
                                        the dark frame of
                             动，仅捕捉窗外
                                        the vehicle's window
                             风景的动态，传                                                    is visible on the left
                                  and top. --ar 25:11  递出夏日旅途的

========== 主合集 第 117 页 ==========

                             清新与治愈氛
                             围。

车厢全景                           a full shot inside a  运镜：缓慢拉
                                        bus, showing many  远，轻微呼吸感
                                   young people, likely                            晃动日系电影质
                                          students, sitting in
                             感，行驶的列车                                        blue seats with
                             车厢内，穿校服                                        white headrests. the
                                   bus has windows on 的学生们或听歌
                                       both sides, a blurry  或交谈，窗外的
                                     green landscape,                             树木因列车行驶
                                       suggesting it's                             形成动态模糊，
                                      moving. blue
                             蓝色窗帘被阳光                                           curtains are drawn
                                             to the side of the   照透，画面带有
                                     windows. many   复古胶片颗粒
                                        students have dark  感，整体色调偏
                                                hair, and some are                             清冷的浅绿调，
                                         looking around or at
                             镜头缓慢拉远，
                                                their phones. a male
                             捕捉车厢内的青                                        student in a white
                                                  shirt and earbud sits 春群像，传递出
                                  on the right. another 夏日旅途的治愈
                                   male student with a  氛围。
                                    buzz cut and white
                                                  shirt looks towards
                                        the camera. a girl in
                                  a school uniform
                                                  sits in the
                                       foreground on the
                                                          left. another person
                                                in a dark shirt holds
                                  a yellow bottle with
                                  a green cap. --ar
                                     34:15

海边对视                           a medium shot of   运镜：缓慢推
                                    two people on a   近，轻微呼吸感
                                       rocky beach with                            晃动日系电影质
                                        the ocean in the
                             感，夏日海边，
                                      background. the
                             穿蓝棕拼色外套                                     person on the left
                                   wears a two tone   的少年和穿蓝白
                                           jacket with a tan

========== 主合集 第 118 页 ==========

                                     upper half and a   外套的少女，站
                                        blue lower half, with 在碎石滩上对视
                                  a black strap across                             微笑，背景是翻
                                                their chest. their
                             涌着白色浪花的                                       dark hair is shaggy.
                             湛蓝大海，阳光                                        the person on the
                                                   right, facing left,   洒在海面波光粼
                                   wears a blue jacket  粼，画面带有复
                                       over a white hoodie,                             古胶片颗粒感与
                                                their dark hair tied                             柔焦光晕，整体
                                       back. the ocean
                             色调偏明亮的蓝                                          features waves
                                         breaking, and the  调，镜头缓慢推
                                     sky is bright blue. --  近，捕捉两人温
                                          ar 37:16      柔对视的瞬间，
                             传递出清新治愈
                             的青春氛围。

海边独走少女                       a full shot of a    运镜：缓慢跟
                                     person with dark   拍，轻微呼吸感
                                             hair and a pale face,                            晃动日系电影质
                                      wearing a blue
                             感，夏日海边，                                  hooded jacket and a
                             穿蓝色连帽外                                        long patterned skirt,
                                       walking on a rocky  套、印花长裙的
                                  beach with white   少女，提着帆布
                                     sneakers and a                             包在海边的岩石
                                  cream colored tote                             上行走，背景是
                                  bag over their
                             湛蓝的大海与翻                                         shoulder, with light
                                        blue ocean water   涌的浪花，阳光
                                  and white waves in  洒在海面波光粼
                                        the background   粼，画面带有复
                                     under a light blue                             古胶片颗粒感与
                                          sky. --ar 37:16
                             柔焦光晕，整体
                             色调偏明亮的蓝
                             调，镜头缓慢跟
                             拍，捕捉少女的
                             动态，传递出清
                             新治愈的氛围。

海边牵手漫步                         two people walk   运镜：缓慢拉
                                      along a pebble

========== 主合集 第 119 页 ==========

                                  beach next to the  远，轻微呼吸感
                                      ocean. the person  晃动日系电影质
                                  on the left wears a                             感，夏日海边，
                                                   light brown jacket
                             穿棕色外套的少                                       over dark and blue
                             年和穿蓝色外套                                       sneakers. the
                                     person on the right  的少女，手牵手
                                   wears a blue jacket  走在碎石滩上，
                                       over a light colored                             少女伸手指向海
                                      dress or skirt, white                             面，背景是翻涌
                                       sneakers, and
                             着白色浪花的湛                                            carries a white and
                                   brown shoulder bag. 蓝大海与远处的
                                                this person is    礁石，阳光洒在
                                           pointing towards the 海面波光粼粼，
                                                        left with their right                             画面带有复古胶
                                 arm extended. the
                             片颗粒感，整体
                                  ocean has clear
                             色调偏明亮的蓝                                        blue water with
                                        white waves     调，镜头缓慢拉
                                       breaking on the   远，捕捉两人漫
                                         shore. the sky is   步的背影，传递
                                             bright blue. in the                             出清新治愈的青
                                          distance, dark rocks
                             春氛围。                                       are visible where
                                        the ocean meets the
                                          horizon. --ar 37:16

花摊人群                           a wide outdoor shot 运镜：缓慢拉
                                             of a flower market  远，轻微呼吸感
                                      scene, with several                            晃动日系治愈电
                                            individuals tending
                             影质感，暖调阳                                             to displays of
                             光，乡村花摊                                            vibrant flowers. a
                             woman in a light top 前，几个人在摆
                                      stands behind a   满向日葵和各色
                                             collection of yellow                             鲜花的摊位前挑
                                  and white flowers                             选，背景是写着
                                  on the left. another
                                                         “welcome” 的木                                     person in a light
                                        long sleeved shirt  牌与远处的山
                                       leans over the same 脉，画面带有复
                                            display. to the right, 古胶片颗粒感，
                                  a person in a pink                             整体色调偏暖
                                        long sleeved shirt

========== 主合集 第 120 页 ==========

                                                  sits on a stool next  黄，镜头缓慢拉
                                             to a woven basket,  远，捕捉花摊热
                                        arranging light pink                             闹又温馨的场
                                            flowers. further
                             景，传递出治愈                                                   right, a person in a
                             又明媚的田园氛                                                   light brown top
                                      squats near     围。
                                       sunflowers and
                                         other potted plants.
                                                in the background, a
                                          large wooden sign
                                          with a "welcome"
                                message on a
                                     green chalkboard
                                  and the japanese
                                               text "歓迎光臨"
                                   above is visible.
                                                fields and distant
                                     mountains complete
                                        the rural setting.

木屋小羊                           a full outdoor shot of 运镜：固定机
                                  a white lamb     位，轻微呼吸感
                                        standing to the right                            晃动日系治愈电
                                             of a rustic wooden
                             影质感，暖调阳                                      shed. the shed has
                             光，乡村草地上                                  an open door a dark
                                                 interior and a    的旧木屋前，一
                                         smaller slatted    只白色小羊站在
                                     opening on the right                             干草上，背景是
                                             side. on the shed's                             开满野花的田野
                                         door, there's text "ソ
                             与远处的湖水，
                          ーヴァ". a white
                             画面带有复古胶
                                     bowl is on the
                             片颗粒感，整体                                    ground in front of
                                        the shed. hay and  色调偏暖黄，镜
                                        dry grass are    头固定不动，仅
                                         scattered around   捕捉小羊轻微的
                                        the base of the shed                             动作与微风带动
                                  and where the lamb
                             的细节，传递出
                                         stands. in the
                             慵懒治愈的田园                                      background, there's
                                  a field of green    氛围。
                                      grass with pink,
                                           yellow, and orange

========== 主合集 第 121 页 ==========

                                            flowers. beyond the
                                                     field, trees line a
                                   body of water under
                                  a light blue sky. a
                                        small house with a
                                   brown roof is visible
                               among the distant
                                             trees.

花摊少年                           a medium shot    运镜：缓慢推
                                 shows a man with  近，轻微呼吸感
                                          dark, curly hair                            晃动日系治愈电
                                      wearing a striped
                             影质感，暖调阳
                                                    shirt, smiling and
                             光，街边花摊                                         looking to his right.
                                  he is holding a    旁，穿条纹衬衫
                                        sunflower in his left  的卷发少年笑着
                                      hand. to his left, a                             看向向日葵花
                                          large collection of                             丛，周围摆满向
                                             bright yellow
                             日葵和粉色菊                                       sunflowers in
                                         various stages of   花，阳光洒在花
                                   bloom are visible,  瓣上，画面带有
                                          with some smaller  复古胶片颗粒感
                                         pink and orange                             与柔焦光晕，整
                                         flowers in a silver
                             体色调偏暖黄，
                                      bucket further to the
                             镜头缓慢推近，                                                          left. the background
                                                    is blurred, showing  捕捉少年温柔的
                                  a light colored    笑容，传递出治
                                       outdoor setting. a  愈又明媚的氛
                                         sign with japanese                             围。
                                               text "ひまわり" is
                                                 partially visible at
                                        the top center.

樱花湖畔少女                       a full shot of a    运镜：缓慢拉
                             woman with braided 远，轻微呼吸感
                                             hair standing in a                            晃动日系胶片电
                                       park next to a lake
                             影质感，春日樱                                     under a cherry
                             花湖畔，穿粉色                                   blossom tree,
                                      wearing a light pink  上衣白裙子的少
                                       cardigan over a   女站在栏杆边，
                                        white dress and

========== 主合集 第 122 页 ==========

                                        white shoes. the   抬头望向漫天樱
                                             lake's surface    花，阳光洒在湖
                                     shimmers, reflecting                             面形成波光，花
                                        the sunlight. a dark
                             瓣随风飘落，画                                wooden fence runs
                             面带有复古胶片                                      along the edge of
                                        the lake. in the    颗粒感，整体色
                                        foreground, there   调偏暖调，镜头
                                       are green bushes                             缓慢拉远，捕捉
                                  and a small, empty                             少女与樱花湖的
                                wooden bench. the
                             唯美场景，传递                                    background shows
                                          trees with some   出治愈又浪漫的
                                         cherry blossoms on  氛围。
                                        the far side of the
                                            lake, under a bright
                                          sky.

打电话的少女                        eye level medium  运镜：缓慢推
                                        shot captures a   近，轻微呼吸感
                                   young woman from                            晃动日系胶片电
                                        the chest up, with a
                             影特写镜头，穿                                          blurred background
                             粉色毛衣的少女                                             of circular bokeh
                                                  lights. she has fair  拿着翻盖手机打
                                              skin, dark hair    电话，背景是虚
                                          pulled back from her                             化的光斑与朦胧
                                        face with a small                             的绿光，画面带
                                         decorative clip, and
                             有复古胶片颗粒                                  a light pink cardigan
                                       over a white lace   感与柔焦光晕，
                                             top. a silver pendant 整体色调偏暖
                                  hangs from her   调，镜头缓慢推
                                       neck. her head is                             近，捕捉少女惊
                                                     tilted slightly
                             喜的神态，传递
                                     upward, and her
                             出温柔又心动的                                  mouth is slightly
                                      open, as if she is   氛围。
                                      speaking or
                                              listening intently on
                                        the flip phone held
                                             to her left ear with
                                       her left hand. the
                                  bokeh lights in the
                                    background are out

========== 主合集 第 123 页 ==========

                                             of focus, creating a
                                  dreamy effect.

草地睡颜                            eye level shot    日系胶片电影特
                                 shows a person   写镜头，穿牛仔
                                              lying in vibrant                             外套的少女侧躺
                                     green grass,
                             在青草地中熟                                                 partially obscured.
                             睡，发丝被阳光                                        the person's face is
                                                   light skinned and   照亮，皮肤在柔
                                         out of focus, with an 光下呈现细腻质
                                       ear visible on the                             感，前景是虚化
                                                        left side of the                             的青草与小花，
                                        frame. dark hair
                             画面带有复古胶                                     frames the face and
                                         flows around the   片颗粒感与柔焦
                                      head. a dark blue  光晕，整体色调
                                   denim garment with 偏清新的浅绿
                                                visible stitching is                             调，镜头缓慢推
                                   seen on the left side
                             近，捕捉少女安
                                             of the image, close
                             静柔和的睡颜，                                             to the person's
                                      head. the green   传递出静谧治愈
                                      grass forms the   的氛围。
                                    background and
                                        foreground, with
                               some blades in
                                     sharp focus.

花田双生少女                         two women stand in 运镜：缓慢拉
                                  a field of small white 远，轻微呼吸感
                                         flowers under a light                            晃动日系胶片电
                                        blue sky. the
                             影质感，薄雾笼                             woman on the left
                             罩的白色雏菊花                                   has her hair in a
                                  bun and wears a   田中，两个穿深
                                       dark jacket, light   色衣服的少女面
                                         pants, and a light                             对面站着，其中
                                        colored messenger                             一个少女举着相
                                       bag. she faces right,
                             机指向对方，背                                         looking at the
                                   second woman. the  景是朦胧的天空
                             woman on the right  与绿植，画面带
                                   has long dark hair  有复古胶片颗粒
                                  and wears a dark

========== 主合集 第 124 页 ==========

                                                      outfit. she is holding 感，整体色调偏
                                  a camera with a   清冷的浅蓝调，
                                          strap around her                             镜头缓慢拉远，
                                    neck and pointing a
                             捕捉花田与少女                                             finger towards the
                             的身影，传递出                                                          first woman. in the
                                      background, there is 文艺又疏离的氛
                                  a line of green trees 围。
                                  and bushes.

烟花下的吻                         a romantic evening  运镜：缓慢推
                                        shot shows a couple 近，轻微呼吸感
                                           kissing under a                            晃动日系胶片电
                                             large, bright
                             影质感，夜晚烟                                          fireworks display at
                             花大会，穿和服                                              night. the man, on
                                        the right, wears a   的少年少女在桥
                                       dark yukata with   上接吻，背景是
                                                vertical stripes,                             炸开的金色烟
                                         leaning in to kiss the                             花，光影在两人
                                woman, who wears
                             身上流动，画面                                  a traditional white
                                  and red yukata with  带有复古胶片颗
                                  a floral hair     粒感与柔焦光
                                       accessory. their   晕，整体色调偏
                                           silhouettes are                             暖黄调，镜头缓
                                      prominent against
                             慢推近，捕捉烟
                                        the warm glow of
                             花下的浪漫瞬                                        the fireworks, which
                                     spread across the  间，传递出温柔
                                     upper and right   又心动的氛围。
                                          portions of the dark
                                          sky. a different,
                                      rounder fireworks
                                            pattern, composed
                                             of small orange
                                                circles, is visible on
                                        the left side of the
                                        frame. a wooden
                                                   railing, reddish
                                   brown and
                                             horizontal,
                                       separates the
                                      couple from the
                                        foreground, which is

========== 主合集 第 125 页 ==========

                                          dark. the
                                       composition is
                                     focused on the
                               moment with the
                                            vibrant light of the
                                          fireworks serving as
                                  a dramatic
                                      background.

捧脸少年                            eye level shot    运镜：缓慢推
                                 shows a young man 近，轻微呼吸感
                                          with dark hair and a                            晃动日系胶片电
                                         surprised
                             影特写镜头，暖
                                         expression, gazing
                             调柔光下，少女                                               directly forward as a
                                woman, seen from  的双手捧着少年
                                      behind with curled  的脸，少年睁大
                                   brown hair and a                             眼睛看着她，背
                                       red floral hair                             景虚化，画面带
                                       accessory, gently
                             有复古胶片颗粒                                    cups his face with
                                       both hands. her   感与柔焦光晕，
                                  hands have long,   整体色调偏暖
                                          pointed, light pink  调，镜头缓慢推
                                    manicured nails. the                             近，捕捉少年温
                             man is wearing a
                             柔又惊讶的神
                                       dark colored top.
                             态，传递出暧昧                                        the background is a
                                                  soft, warm orange  又心动的氛围。
                                         pink blur,
                                       suggesting an
                                         indoor setting with
                                           diffused lighting.

树与天空                           a low angle full shot 运镜：缓慢推
                                       captures a vibrant  近，轻微呼吸感
                                            tree with lush green                            晃动日系电影质
                                             foliage and some
                             感，清新薄荷绿                                         yellow leaves on the
                             滤镜，夏日户外                                                        left side of the
                                        frame, set against a 场景。镜头仰
                                               bright, slightly    拍，画面左侧是
                                       desaturated teal                             树枝与绿叶，右
                                          sky. large, fluffy                             侧是薄荷绿色的
                                        white clouds occupy

========== 主合集 第 126 页 ==========

                                        the right side of the  天空和蓬松的白
                                      image, extending   云，画面带有复
                                      from the middle to                             古胶片颗粒感，
                                        the top and bottom
                             镜头缓慢推近，                                                right corners. the
                             捕捉树叶在微风                                            tree branches
                                          diagonally ascend  中晃动的细节，
                                      from the lower left  传递出治愈又宁
                                      towards the upper                             静的氛围。
                                                   right, partially
                                    obscured by the
                                          clouds.

野花特写                           a wide shot of a   运镜：缓慢推
                                                   field of white and   近，轻微呼吸感
                                         pink flowers against                            晃动日系电影质
                                  a light blue sky. the
                             感，清新薄荷绿                                         flowers have long,
                             滤镜，野花场                                               thin green stems
                                  and small, delicate  景。画面是高低
                                      blossoms. the white 错落的白色与红
                                         flowers are on the                             色野花，背景是
                                                        left side of the                             薄荷绿色的天
                                        frame, while the
                             空，画面带有复                                         pink flowers
                                    dominate the center 古胶片颗粒感，
                                  and right. the    镜头缓慢推近，
                                    background sky is a 捕捉花瓣在微风
                                                  soft, uniform blue                             中晃动的细节，
                                          with a hint of lighter
                             传递出清新又治
                                        blue or white,
                             愈的氛围。                                          possibly a wispy
                                          cloud, near the
                                        horizon on the left.

山坡行人                           a wide shot depicts  运镜：缓慢横
                                  a vast, light blue sky 移，轻微呼吸感
                                          with numerous fluffy                            晃动日系电影质
                                        white clouds. below
                             感，清新薄荷绿                                        the sky, a grassy hill
                             滤镜，山坡场                                          with some dirt rises
                                      from the bottom of  景。三位穿古
                                        the frame. three   装、戴斗笠的人
                                            figures are                             物在草地上行
                                         positioned on top of

========== 主合集 第 127 页 ==========

                                        the hill, from left to  走，背景是薄荷
                                                   right: a person in a  绿色的天空和大
                                     wide brimmed straw                             片白云，画面带
                                         hat and a light
                             有复古胶片颗粒                                        colored top, another
                             感，镜头缓慢横                                     person in a reddish
                                    orange garment,   移，捕捉人物在
                                  and a third person  开阔天地间前行
                                                in a light colored hat                             的画面，传递出
                                  and shirt, holding a                             悠远又自由的氛
                                               stick like object.
                             围。

公交车内                           a side profile of a   运镜：缓慢推
                                   young asian woman 近，轻微呼吸感
                                          with dark hair tied in                            晃动日系清新电
                                  a ponytail, standing
                             影质感，公交车                                           inside a bus and
                             内场景。穿学生                                         holding onto a white
                                    overhead handrail  制服的少女站在
                                          with her right hand.  车厢里，抓着扶
                                   she is wearing a                             手望向窗外，背
                                        white collared shirt                             景是虚化的窗外
                                     under a dark blue or
                             绿植与车内乘                                        black sleeveless
                                             top. her gaze is   客，画面带有复
                                          directed towards the 古胶片颗粒感与
                                                          left. the bus interior  柔焦光晕，镜头
                                                    is bright with white                             缓慢推近，捕捉
                                  and grey surfaces.
                             她的侧脸与窗外
                                       through the bus
                             光影变化，传递                                     windows, a blurry
                                     green background  出安静又日常的
                                             of trees and foliage  氛围。
                                                    is visible,
                                       suggesting the bus
                                                    is in motion. other
                                    passengers are
                                                  faintly visible in the
                                       foreground and
                                      background,
                                           including the back
                                             of a person's head
                                      wearing a dark
                                       uniform in the lower

========== 主合集 第 128 页 ==========

                                                          left.

海边小路                           a full shot from    运镜：缓慢跟
                                      behind of a young  拍，轻微呼吸感
                                     person with dark                            晃动日系清新电
                                             hair in a ponytail,
                             影质感，夏日户                                      wearing a black
                             外场景。穿学生                                          pinafore dress over
                                  a white short    制服的少女背对
                                      sleeved shirt and   着镜头，走在通
                                       dark shoes, walking                             往海边的林荫小
                                away from the                             路上，两侧是茂
                                       viewer down a
                             密的绿树与木栅                                        narrow, sun
                                       dappled, paved   栏，前方是蔚蓝
                                          path. the path    的大海与蓝天白
                                      extends towards a  云，画面带有复
                                             bright blue ocean                             古胶片颗粒感与
                                     under a partly
                             柔焦光晕，镜头
                                       cloudy sky,
                             缓慢跟拍，捕捉                                             transitioning to a dirt
                                     road with two visible 她走向海边的背
                                             tracks. lush green  影与光影变化，
                                          trees and bushes   传递出治愈又宁
                                                 line both sides of                             静的氛围。
                                        the path, with a
                                wooden fence
                                       running along the
                                                right side leading
                                      towards the beach.
                                        the foliage casts
                                 shadows on the
                                          path.

草地特写                           a medium close up  运镜：缓慢推
                                             of a young asian   近，轻微呼吸感
                             woman with her hair                            晃动日系清新电
                                          pulled back in a low
                             影质感，户外特                                              ponytail, facing
                             写场景。穿蓝色                                                 slightly left with her
                                   gaze directed    背心的少女站在
                                          forward, wearing a  草地上，侧脸对
                                              teal blue tank top.                             着镜头，背景是
                                   she stands against                             虚化的绿色草
                                  a blurred

========== 主合集 第 129 页 ==========

                                    background of    地，画面带有复
                                     green grass and a  古胶片颗粒感与
                                       gray pathway. the                             柔焦光晕，镜头
                                               lighting highlights
                             缓慢推近，捕捉                                       her face and the
                             她的眼神与发丝                                              teal tank top.
                             细节，传递出清
                             爽又略带迷茫的
                             氛围。

花丛雀斑特写                       a close up portrait of 运镜：缓慢推近
                                  a young woman   复古清新胶片特
                                          with dark brown hair                             写，少女雀斑脸
                                  and light brown
                             颊被白色细碎野
                                       eyes, looking
                             花与绿叶环绕，                                               directly at the
                                          viewer. her face has 暖调日光在皮肤
                                  a subtle blush and  形成明暗光斑，
                                                   light freckles. her                             发丝零散落在额
                                   nose and upper lip                             头，花草随微风
                                       are slightly shiny.
                             轻轻晃动，胶片                                   she is partially
                                    obscured by green  颗粒质感。
                                       leaves and clusters
                                             of small white
                                         flowers on the left
                                         side of the frame.
                                        the background is a
                                              soft blend of green
                                  and muted orange
                                   brown tones,
                                       suggesting an
                                       outdoor setting with
                                     dappled sunlight.

花草仰躺少女                       a close up, eye level 运镜：缓慢俯推
                                        shot of a person   日系复古胶片质
                                              lying on their back                             感，夏日野外草
                                      amidst lush green
                             地，少女仰面躺                                             foliage and white
                             在细碎白色野花                                            flowers. the
                                        person's face is   与绿叶间，闭眼
                                           illuminated by    沐浴阳光，树叶
                                     dappled sunlight,                             阴影落在脸颊，
                                          creating shadows of

========== 主合集 第 130 页 ==========

                                       leaves and flowers  暖调做旧胶片色
                                  on their nose and  调，微风晃动身
                                      cheek. their eyes                             边花草。
                                       are closed, lips
                                                 slightly parted,
                                        glossy pink lips.
                                            freckles are visible
                                      across their nose
                                  and cheeks. dark
                                   brown hair frames
                                        the right side of their
                                           face. the
                                    background
                                          consists of out of
                                       focus green leaves
                                  and small white
                                      blossoms,
                                       suggesting a natural
                                       outdoor setting.



 是枝裕和《怪物》影像风格提示词


         图片       图片提示词      视频提示词

鱼缸里的金鱼                     a close up      运镜：固定机位，
                                   underwater shot of a 轻微呼吸感晃动日
                                     school of goldfish in                            系胶片电影质感，
                                an aquarium, with a
                            鱼缸特写镜头，橙                                                light blue
                            白相间的金鱼在水                                   background. the
                                    foreground shows   中游动，鱼鳍随水
                                      the white pebbled   流轻轻摆动，背景
                                   bottom of the                            是虚化的水底砂石
                                    aquarium, with some                            与气泡，画面带有
                                      small black and
                            复古胶片颗粒感与                                brown pebbles
                                        interspersed. one   柔焦光晕，整体色
                                         goldfish is prominent 调偏清冷的青调，
                                             in the bottom left,   镜头固定不动，仅
                                                light orange and                            捕捉金鱼游动与水

========== 主合集 第 131 页 ==========

                                         white, with its mouth  面的轻微波动，传
                                   near the pebbles.   递出静谧治愈的氛
                                       other goldfish, mostly                            围。
                                    orange, are visible in
                                      the midground and
                                   background, some
                                        with flowing white
                                                fins. the image has a
                                        subtle shallow depth
                                          of field, blurring the
                                  background slightly. -
                                           -ar 19:14

少年侧脸特写                     a close up, soft focus 运镜：缓慢推近，
                                             portrait captures the  轻微呼吸感晃动日
                                             right side of a                            系胶片电影特写镜
                                      person's face in
                            头，少年低垂的侧                                               profile, looking down
                            脸，发丝被阳光照                                and to the right. the
                                   person has short,   亮，皮肤在光影下
                                    dark brown hair that  呈现出细腻的质
                                                  falls across their                            感，背景是虚化的
                                    forehead and                            蓝绿色光斑，画面
                                              partially obscures
                            带有复古胶片颗粒                                             their right eye. the
                                        skin tone is warm,   感与柔焦光晕，整
                                        with hints of reddish  体色调偏清冷的浅
                                and light peach    绿调，镜头缓慢推
                                    hues. the lighting is                            近，捕捉少年温柔
                                            soft and diffused,
                            的神态，传递出安
                                        creating a dreamy,
                            静又细腻的氛围。                                              slightly blurred effect.
                                a bright, light blue
                                and white area
                                  dominates the lower
                                             right portion of the
                                   image, while the
                                  upper left is darker,
                                     suggesting shadows
                                        or a different
                                  background element.
                                      the person's ear is
                                             visible near the top
                                                      left, and the bridge of
                                             their nose and upper

========== 主合集 第 132 页 ==========

                                                     lip are softly defined.
                                      the image is
                                      characterized by its
                                     shallow depth of field
                                and ethereal quality.

林间少年                          two little boy are   运镜：缓慢推近，
                                              partially visible    轻微呼吸感晃动日
                                    amidst dense green                            系胶片电影质感，
                                          foliage in a bright
                            夏日林间，穿格子                                    outdoor setting. the
                             衬衫和白T 恤的少                           man on the left
                                 wears a light colored 年并肩前行，前景
                                          plaid shirt and has  是虚化的绿叶与光
                                        dark, shaggy hair.                            斑，阳光透过树叶
                                      the man on the right,                            洒下斑驳光影，画
                                      also with dark,
                            面带有复古胶片颗                                 shaggy hair, wears a
                                                light shirt and is    粒感与柔焦光晕，
                                       looking slightly up.  整体色调偏清冷的
                                      the foreground is   浅绿调，镜头缓慢
                                        heavily blurred with                            推近，捕捉少年安
                                          bright green leaves,
                            静的身影，传递出
                                        creating a soft,
                            青春独有的清新氛                                       ethereal effect.
                                above them, the dark 围。
                                  branches and leaves
                                          of a tree form a
                                        natural canopy. in
                                      the distant
                                   background, blurred
                                  green trees and a
                                                light colored
                                           structural element
                                    are discernible. the
                                          overall impression is
                                one of natural beauty
                                and tranquility.

旧车厢里的孩子                   a medium shot within 运镜：固定机位，
                                a rustic vehicle,    轻微呼吸感晃动日
                                  showing two children                            系胶片电影质感，
                                      seated. the child on
                            老旧的车厢内，两                                      the left faces away,
                            个孩子背对着镜头                                       looking out a window

========== 主合集 第 133 页 ==========

                                            into lush green    坐在窗边，窗外是
                                            foliage. this child   飞速掠过的绿色风
                                 wears a light colored                            景，车窗上挂着彩
                                      top and a yellow
                            色的手绘装饰，画                                  garment on their
                            面带有复古胶片颗                                     back. the child on the
                                             right is seen from the 粒感，整体色调偏
                                          side, with dark hair,  清冷的浅绿调，镜
                                   wearing a blue and                            头固定不动，仅捕
                                      white plaid shirt, and                            捉车厢轻微晃动与
                                      holding a small stick
                            窗外风景的动态，                                      out the window. the
                                window above shows 传递出怀旧又治愈
                                             childlike drawings   的氛围。
                                and cutouts of
                                            celestial bodies and
                                       leaves. the interior
                                 has worn seats and
                                             visible texture on the
                                          walls, with green
                                          foliage blurring in the
                                    foreground and
                                   background.

飞驰的孩童                       a close up, eye level, 日系复古胶片质
                                        natural light, medium 感，孩童抓着扶手
                                     shot of a young boy                            随交通工具飞驰，
                                        with dark hair and a
                            脸上洋溢着灿烂的                                      wide, joyful smile,
                            笑容，背景因运动                                        with his head tilted
                                              slightly upwards and  形成强烈的横向拖
                                          to the right, looking  影，画面带有复古
                                               off camera. he is                            颗粒与褪色暖调滤
                                      holding onto two                            镜，整体充满童真
                                    metal bars, one dark
                            的快乐与自由感，                                    grey and vertical, the
                                       other red and     镜头特写，捕捉孩
                                          horizontal, which   童明亮的笑脸与风
                                     cross in the upper   驰电掣的瞬间。
                                                     left of the frame. the
                                  background is out of
                                        focus, showing
                                   motion blur with light
                                and dark horizontal
                                        streaks, suggesting

========== 主合集 第 134 页 ==========

                                movement. the
                                            lighting is bright,
                                          highlighting the boy's
                                     face and smile.

奔跑少年                        a blurry, motion    日系复古胶片电影
                                        blurred photograph  质感，穿白T 恤的
                               shows a young                            少年在街道上全力
                                   person with dark,
                            奔跑，头发被风吹
                                          curly hair running
                            起，背景因运动形                                   from left to right
                                    across the frame.   成强烈的横向动态
                                     they are wearing a  模糊，画面带有复
                                                light colored t shirt                            古颗粒与暖调褪色
                                        with a graphic and                            滤镜，整体充满青
                                    dark pants. the
                            春张力，镜头跟                                  background is
                                     extremely blurred,   拍，捕捉奔跑的速
                                  showing hints of   度感与少年的活
                                          buildings, possibly  力。
                                      signs with indistinct
                                               text, and green
                                            foliage. a prominent
                                             vertical band on the
                                             far left of the image
                                                 is red, white, and
                                    dark blue or black,
                                    resembling a flag.



 《少年斯派维的奇异旅行》影像风格提示词


            图片           图片提示词

男孩水中探头                                  a unique underwater
                                                      perspective of a young
                                               boy looking into an
                                                aquarium or body of
                                                       water, with numerous
                                                      small orange fish
                                             swimming between his

========== 主合集 第 135 页 ==========

                                                     face and the camera. the
                                                      boy's face, with light
                                              brown hair and a focused
                                                      expression, is seen from
                                                below the water's
                                                        surface, partially
                                                 obscured by the aquatic
                                                                                life. the lighting is bright,
                                                        creating reflections and
                                                                glints on the water. the
                                                    composition emphasizes
                                                      the interaction between
                                                      the child and the fish,
                                                        with a clear blue water
                                                  background. there are air
                                                  bubbles visible in the
                                                       water. --ar 9:4

男孩火车上看画                                a full shot of a child with
                                                                    light brown hair, wearing
                                             a mustard yellow jacket
                                             and blue jeans, holding
                                             up a white paper with
                                                      black stick figures in
                                                       various poses. the child's
                                               back is to the viewer,
                                                     standing on a moving
                                                                 train or vehicle with dark
                                              brown railings. the
                                                background shows
                                                        blurred green trees, a
                                                   dark green forest, and
                                                 mountains with snow
                                               caps under a light blue
                                             and white sky. a white
                                             and light pink vehicle or
                                                                      trailer with a silver ladder
                                                                      is visible on the right side
                                                            of the frame. --ar 34:15

========== 主合集 第 136 页 ==========

男孩望远镜                                    a medium shot shows a
                                              young boy with blond
                                                                hair, wearing a brown
                                                          jacket and a striped shirt,
                                                       looking through
                                                         binoculars. he is
                                                       positioned in the
                                                      foreground, peering over
                                                      the edge of a rustic,
                                                   metal container. in the
                                                  background, there is a
                                                                 pile of light brown
                                                        material inside the
                                                         container, and lush green
                                                        trees under a bright sky.
                                                      the side of the container
                                               has white text "rfwx
                                                  157030". --ar 9:4

 杨德昌《一一》影像风格提示词


         图片       图片提示词    视频提示词

婚礼气球厅                         a full shot depicts  运镜：缓慢推近，
                                  an indoor scene  轻微呼吸感晃动
                                          with a red curtain                                                   90 年代华语电影
                                    backdrop adorned
                            质感，复古胶片色                                          with a circular,
                            调，昏暗的婚礼大                                           illuminated
                                      chinese character  厅，红色幕布上挂
                                         '囍' (double    着发光的双喜霓虹
                                        happiness).    灯，地面铺满粉色
                                  numerous pink                            气球，气球柱与心
                                        balloons are                            形气球散落四周，
                                         scattered across
                            几个穿白衬衫的男                                        the floor and
                                      arranged in    人和小男孩或站或
                                            clusters on tall   蹲在气球中，画面
                                         stands. three men 带轻微颗粒感与朦
                                       are visible; one on                            胧柔光，镜头缓慢
                                        the left in a white
                            推近，捕捉场景的
                                                  shirt and black
                                      pants is partially

========== 主合集 第 137 页 ==========

                                                 visible, walking   荒诞与怅惘氛围。
                                    away. two men in
                                        white shirts and
                                        black pants are
                                     seated on the
                                                   floor, surrounded
                                    by balloons. one
                                             of them holds a
                                         heart shaped pink
                                           balloon. a littile
                                   boy in a black suit
                                      stands facing
                                away from the
                                          viewer,
                                     surrounded by
                                        balloons on the
                                                   floor. metallic
                                      streamers hang
                                      from the ceiling.

举相机的男孩                       a young asian boy 运镜：缓慢推近，
                                          with short dark   轻微呼吸感晃动
                                                hair, wearing a                                                   90 年代华语电影
                                         yellow t shirt with
                            质感，复古胶片色                                        black chinese
                            调，照相馆内景，                                        characters "龍安"
                             穿黄色T 恤的小男                                  and green pants,
                                       holds a black and  孩举着老式胶片相
                                                silver compact   机对准镜头，背景
                                  camera up to his                            是挂满相框的粉色
                                           face, looking                            墙面，画面带轻微
                                       through the
                            颗粒感与暖调柔                                           viewfinder. he is
                                         positioned     光，镜头缓慢推
                                               centrally, slightly  近，捕捉男孩专注
                                             to the right, in a   的神态与相机的细
                                               brightly lit room                            节，传递出纯真又
                                                       filled with
                            略带疏离的氛围。
                                  numerous framed
                                       photographs.
                               many framed
                                               portraits and
                                     group photos
                                  hang on the walls
                                      behind him,

========== 主合集 第 138 页 ==========

                                         varying in size and
                                     frame color,
                                           including beige
                                  and red. a large
                                    framed group
                                     photo is visible on
                                        the left, and a
                                              similar one
                                                 partially obscured
                                  on the right. a
                                          blurred white and
                                         pink floral
                                    arrangement is
                                                visible on the far
                                                   right. more framed
                                     photos are
                                        displayed on a
                                        surface in the
                                        foreground,
                                           including a portrait
                                             of an older man.
                                        the overall setting
                                    appears to be a
                                     photography
                                          studio or gallery.



 徐克《青蛇》影像风格提示词


         图片       图片提示词    视频提示词

持月牙刃的古装女                   a full shot of a   运镜：缓慢推近，
子                            woman with pale  轻微呼吸感晃动老
                                          skin and dark hair                            港片武侠电影质
                                                in a top bun,
                            感，古风场景，古                                      wearing a light
                            装女子发髻高挽，                                        colored dress with
                               some red accents, 白衣广袖，手持一
                                         holding a large,   把刻有云纹的月牙
                                        curved, silver                            形弯刀，刀刃带着
                                   weapon, standing                            流光，背景是朦胧

========== 主合集 第 139 页 ==========

                                  on a light green   的青绿色调，画面
                                    ground with a   带复古胶片颗粒感
                                    hazy green                            与柔光滤镜，镜头
                                      background. she
                            缓慢推近，捕捉女                                                    is facing towards
                            子清冷锐利的眼神                                        the left side of the
                                        frame, looking   与弯刀的细节，传
                                      towards the    递出飒爽又神秘的
                                          viewer. the                            氛围。
                                weapon is highly
                                             detailed, with
                                        ornate patterns on
                                                        its surface.

施法古装女子                       a medium shot   运镜：缓慢推近，
                                          features a woman 轻微呼吸感晃动老
                                          with her right hand                            港片奇幻电影质
                                            raised, index
                            感，室内场景，古                                             finger pointing up,
                            装女子发髻高挽，                                         against a warm,
                                                   light brown     白衣广袖，单指竖
                                    background with a 起施法，身旁升起
                                               colorful column of                            一团紫橙渐变的彩
                                smoke or energy                            色烟雾，背景为素
                                  on the right side.
                            色墙面，画面带复                                        the woman has
                                       dark hair styled in  古胶片颗粒感与柔
                                    two buns on top of 光滤镜，镜头缓慢
                                       her head. she   推近，捕捉女子清
                                   wears a light                            冷坚定的眼神与烟
                                        colored garment,
                            雾的动态，传递出
                                          possibly white,
                            神秘又古典的氛                                  and has a focused
                                         expression,    围。
                                         looking slightly to
                                       her right. the
                                               colorful column on
                                        the right displays
                                   shades of purple,
                                           blue, orange, and
                                            red, appearing
                                 somewhat
                                          textured and cloud
                                                     like.

========== 主合集 第 140 页 ==========

月夜抚琴                      A high-angle shot  运镜：缓慢推近，
                                       captured a scene  轻微呼吸感晃动古
                                           inside the room at                            风电影质感，月夜
                                              night. The picture
                            楼阁露台，穿素色                                         featured a long
                            汉服的女子凭栏抚                                        shot that showed
                                    two characters.   琴，白色轻纱在夜
                              One of them was  风中缓缓飘动，背
                                  on the left side of                            景是灯火昏黄的古
                                        the frame, partially                            建筑与朦胧夜色，
                                    obscured by white
                            暖黄灯笼光影摇                                                fabric. Behind a
                                        white curtain, a   曳，整体色调清冷
                             woman was    柔和，画面带轻微
                                          playing the guqin.  胶片颗粒与朦胧柔
                                 The other person                            光，镜头缓慢推
                                was standing in
                            近，捕捉抚琴的身
                                        the lower right
                            影与轻纱流动，传                                          corner, facing
                                away from the   递出静谧又悠远的
                                     audience and   古风意境。
                                      wearing a long
                                         robe. A metal bird
                                         statue was located
                                                in the lower left
                                        corner of the
                                        frame. The white
                                            curtain hung in the
                                      scene, creating a
                                          flowing effect. The
                                    background
                                 showed
                                           illuminated
                                             architectural
                                            structures,
                                          possibly belonging
                                             to a building,
                                    beneath the dark
                                          sky.

眼眸特写                                 cinematic, slightly  运镜：缓慢推近，
                                             blurry shot of two  轻微呼吸感晃动古
                                    eyes of a person                            风电影特写镜头，
                                          with dark brown
                            清冷夜色中，少女                                                  irises, looking

========== 主合集 第 141 页 ==========

                                                 slightly upwards.  的眼眸特写，瞳孔
                                        the left eye is    映着微光，睫毛在
                                          closer to the                            光影下投下细碎阴
                                       viewer and
                            影，整体色调偏清                                                 partially obscured
                            冷的蓝调，画面带                                    by a dark shadow
                                          or object on the   轻微胶片颗粒与朦
                                                          left, while the right 胧柔光，镜头缓慢
                                   eye is further                            推近，捕捉眼眸中
                                away and more                            的光影变化，传递
                                                     fully visible. the
                            出温柔又含情的氛                                          skin around the
                                    eyes appears   围感。
                                                     light, with a subtle
                                        blue or teal tint
                                      from the lighting.
                                        the eyebrows are
                                       dark and faintly
                                                 visible. a slight
                                              reflection or
                                             highlight is
                                       present in both
                                              pupils. --ar 25:14

抚琴的手                            eye level shot   运镜：缓慢推近，
                                 shows hands   轻微呼吸感晃动古
                                          playing a guqin,                            风电影特写镜头，
                                          with an ornate
                            夜晚的古琴旁，一                                    vase to the right.
                            双素手轻拨琴弦，                                        the guqin is dark
                                   wood, with white  指节在琴弦上微
                                               strings, and some  动，旁边摆放着绘
                                       red and turquoise                            有仕女图的瓷瓶，
                                      accents near the                            光影在琴弦上流
                                        top of the frame.
                            动，整体色调清冷                                        the hands are fair
                                        skinned, with well  柔和，画面带轻微
                                    manicured nails,  胶片颗粒与柔焦光
                                  and delicate    晕，镜头缓慢推
                                              fingers. the vase                            近，捕捉抚琴的细
                                                    is white porcelain,
                            节，传递出细腻又
                                          with an ornate
                            静谧的氛围。                                           painting of a
                                     person with a
                                         basket, with a

========== 主合集 第 142 页 ==========

                                                    floral pattern
                                   above them. the
                                    background is a
                                          blurred teal color,
                                          creating a serene
                                     atmosphere. the
                                               lighting is soft and
                                       even, highlighting
                                        the details of the
                                        instrument and the
                                      hands. --ar 16:9

侠女                               eye level shot   港风武侠电影质
                                 shows a young   感，冷调青蓝夜色
                             woman with a                            光影，林间夜景特
                                      sword, looking
                            写，古装女子手持                                               directly at the
                            一柄冷刃长剑，剑                                          viewer. her face is
                                           illuminated by a  身泛清冷寒光，前
                                         cool blue light,   景虚化绿植叶片遮
                                     emphasizing her                            挡部分画面，暗调
                                       red lipstick and                            朦胧氛围感，复古
                                       dark eyes. she
                            胶片颗粒质感，镜                                   has dark hair
                                          pulled back from  头缓慢微微推进，
                                       her face. a     眼神沉静凌厉，夜
                                     gleaming sword is 色薄雾弥散，冷色
                                         positioned                            环境光在肌肤与剑
                                                vertically in front
                            刃形成明暗光影，
                                             of her, reflecting
                            静谧又带着肃杀的                                                     light. the
                                    background is   江湖氛围。
                                            blurred, with
                                   shades of blue
                                  and hints of green
                                               foliage. --ar 37:16



 王家卫《重庆森林》影像风格提示词


         图片       图片提示词      视频提示词

========== 主合集 第 143 页 ==========

地铁站奔跑的男人                  a male figure,    运镜：低角度跟
                                    dressed in a trench  拍，带轻微推拉
                                          coat, a striped shirt                            变焦王家卫电影
                                         with a red tie, and
                             质感，复古胶                                       blue jeans, is seen
                             片，强运动模                                      walking down an
                                          escalator. he has   糊，地铁扶梯场
                                         dark, short hair. the  景。穿卡其色风
                                          escalator's steps are                             衣、牛仔裤的男
                                         dark, and its sides                             人提着公文包，
                                      are reflective silver
                             逆着扶梯奔跑，                                         with several glowing
                                       white rectangular   镜头从低角度跟
                                                 lights. green and   拍，背景的灯光
                                                 light brown      与墙面因运动形
                                           architectural                             成放射状拖影，
                                    elements are present
                             画面带强烈颗粒
                                               in the background,
                             感、漏光与柔焦                                 and the entire scene
                                                   is tilted for a sense  光晕，整体色调
                                            of movement.    偏冷调，镜头轻
                             微推拉变焦，捕
                             捉他奔跑的速度
                             感与城市的疏离
                             氛围。

霓虹吧台前的少女                  a medium shot    镜头2：霓虹吧
                                        features a person in  台前的少女运
                                 a white short sleeve                             镜：缓慢推近，
                                          collared shirt, black
                            带轻微晃动王家                                        pants, and a red bow
                             卫电影质感，复                                                      tie, standing in a
                                       dimly lit indoor    古胶片，高对比
                                             setting. the person  光影，深夜吧台
                                  wears dark oval                             场景。穿白衬
                                    sunglasses and has                             衫、红领结的少
                                     dark hair. their hands
                             女戴着墨镜靠在                                      are behind their
                                      back. to the right, an 吧台边，背景是
                                   orange counter is   虚化的霓虹灯光
                                                visible, with a blurred 与模糊人影，暖
                                   background showing                             橙调的吧台与冷
                                           bottles and another
                             绿调的光影交
                                    person in a light

========== 主合集 第 144 页 ==========

                                       colored shirt. the   织，画面带颗粒
                                              lighting creates a   感、朦胧光晕与
                                       strong contrast                             轻微漏光，镜头
                                  between the
                             缓慢推近，带轻                                          illuminated figure
                             微呼吸感晃动，                                 and the dark
                                       surroundings. --ar   传递出暧昧又疏
                                       3:2         离的都市夜氛
                             围。



 陈凯歌《霸王别姬》影像风格提示词


         图片       图片提示词    视频提示词

贵妃醉酒特写                        eye level shot   固定镜头，眼睛看
                                 shows an     着斜下方，非常悲
                                             individual in                            伤的眼神，不要眨
                                                intricate east
                            眼睛，人物身子不                                       asian ceremonial
                            要有呼吸起伏，仅                                                     attire, angled
                                   upwards from the  人物的眼神有轻轻
                                     bottom left. the   微的变化，眼神从
                                        face is painted                            柔意的眷恋
                                        white with striking                            （痴），逐渐泛起
                                         pink and black
                            沉郁的水光                                  makeup,
                                     emphasizing the  （痛），眼睫轻
                                    eyes and lips. a  颤，泪光在眼尾打
                                            vibrant headdress, 转却不落。不要有
                                    adorned with                            睁眼这样的动作，
                                            multiple strings of
                            眼睛仅有很细微的
                                            pearls, intricate
                            变化，眼珠不要                                        gold and silver
                                                   filigree patterns,  动，眼皮不要抬，
                                  and red accents,  眼神中逐渐泛起眼
                                     frames the face.  泪，胶片颗粒质
                                        the individual's red                            感，慢镜头，传递
                                   costume is visible
                            人的破碎感。                                  on the right,
                                           featuring

========== 主合集 第 145 页 ==========

                                     embroidered gold
                                             swirls and pink
                                                    floral patterns. the
                                    background is a
                                              soft blend of pink
                                  and warm yellow,
                                          creating a
                                      luminous glow.

舞台独舞全景                                Full body Peking  运镜：缓慢拉远，
                                     opera dan     轻微呼吸感晃动中
                                       performer on                            式戏曲电影质感，
                                         stage, elaborate
                            暖调舞台灯光，传
                                      phoenix
                            统戏台场景。穿红                                    headdress with
                                        long tassels,    色绣花戏服的戏曲
                                          flowing water    演员头戴凤冠，跪
                                       sleeves in yellow                            于散落彩纸的舞台
                                  and pink, crimson                            中央，背景是绣金
                                     embroidered robe
                            龙的红色幕布，动                                          with dragon
                                           patterns, dramatic 作舒展，画面带有
                                  dance pose with  复古胶片颗粒感与
                                  arms extended,   柔光滤镜，镜头缓
                                         scattered paper                            慢拉远，捕捉演员
                                  on stage floor, red
                            的身段与舞台整体
                                            curtain backdrop
                            氛围，传递出戏曲                                          with golden
                                    dragon      表演的张力与故事
                                       embroidery,    感。
                                              theatrical
                                               spotlight, Farewell
                            My Concubine
                                                   final scene
                                            aesthetic, tragic
                                     atmosphere,
                                        cinematic wide
                                           shot, 35mm film
                                             grain,
                                       masterpiece, 8k,
                                                ultra detailed --ar
                                       21:9 --style raw --v
                                  6

========== 主合集 第 146 页 ==========

霸王别姬对手戏                   Two Peking opera 运镜：缓慢推近，
                                       performers on   轻微呼吸感晃动中
                                         stage, dan and                            式戏曲电影质感，
                                                jing roles,
                            暖调舞台灯光，传                                        Farewell My
                            统戏台场景。两位                                   Concubine iconic
                                      scene, elaborate  戏曲演员身着华丽
                                   costumes in    戏服，头戴精致头
                                         yellow and gold vs                            饰，在绣有传统纹
                                        black and white,                            样的红色幕布前对
                                                traditional Chinese
                            戏，妆容浓艳，动                                          theater backdrop
                                          with red curtain   作程式化，画面带
                                  and cloud     有复古胶片颗粒感
                                           patterns, dramatic 与柔光滤镜，镜头
                                          confrontation                            缓慢推近，捕捉演
                                      pose, theatrical
                            员的神态与戏服细
                                      stage lighting,
                            节，传递出古典戏                                    Chinese opera
                                      performance,    曲的张力与氛围
                                        cinematic wide   感。
                                           shot, emotional
                                                intensity, 35mm
                                                film grain, vintage
                                           color grading,
                                       masterpiece, 8k,
                                                ultra detailed --ar
                                       21:9 --style raw --v
                                  6



 《寂静的朋友》影像风格提示词


         图片       图片提示词    视频提示词

草丛特写                                  detailed shot of a  运镜：轻微呼吸感
                               human face, with  晃动文艺电影质
                                  a green eye                            感，自然光特写镜
                                                 visible, partially
                            头。高草丛中的人                                      hidden by blades
                            脸局部特写，翠绿                                             of green grass.

========== 主合集 第 147 页 ==========

                                        the image has a  的草叶遮挡住部分
                                           textured, grainy   视线，焦点落在人
                                     appearance,                            物清澈的绿眼睛
                                             indicating a film
                            上，皮肤纹理清晰                                                  like quality. the
                            可见，画面带有复                                               lighting suggests
                                              direct sunlight on  古胶片颗粒感与轻
                                        the person's skin,  微柔焦，整体色调
                                     which is a light                            清新自然，镜头缓
                                       complexion. the                            慢推近，捕捉人物
                                       composition
                            眼神的细微变化，                                      focuses on the
                                        face within a    传递出隐秘又疏离
                                             natural, grassy   的氛围。
                                       environment.

废墟草地少年                       a young man with  运镜：缓慢拉远，
                                                   light brown hair   轻微呼吸感晃动文
                                  and a fringe sits in                            艺电影质感，午后
                                                           tall green grass,
                            自然光场景。穿酒                                          facing forward
                             红色T 恤的少年坐                                          with his legs bent.
                                  he wears a dark  在荒草丛生的石墙
                                       red short sleeve  前，面前放着一个
                                                  shirt and dark blue                            带托盘的折叠小
                                         pants, with a                            桌，旁边立着一把
                                    watch on his left
                            空木椅，背景是茂                                                wrist. to his left
                                  and in the     密的绿植与斑驳石
                                        foreground, there  墙，画面带有复古
                                                    is a small, light   胶片颗粒感与柔焦
                                        colored folding                            光晕，整体色调偏
                                           table with a dirty
                            暖绿，镜头缓慢拉
                                             tray on top. to his
                            远，捕捉少年的静                                                right and also in
                                        the foreground, a  态姿态与空旷环境
                                                   light yellow     的对比，传递出孤
                                wooden folding   独又静谧的氛围。
                                           chair with an open
                                             slatted back faces
                                away from the
                                    camera. in the
                                      background, a
                                      stone wall and
                                 more dark green

========== 主合集 第 148 页 ==========

                                             foliage are visible.
                                        the scene is
                                       outdoors with
                                           natural lighting.





 《暖》影像风格提示词


         图片       图片提示词      视频提示词

溪边洗菜                        a medium shot shows 运镜：缓慢推近，
                               a young woman with  轻微呼吸感晃动江
                                    dark hair in two                            南水乡电影质感，
                                        braids, wearing a light
                            暖调自然光，古镇                                brown top with red
                            溪边场景。梳双麻                               and white plaid
                                      sleeves, intently    花辫的少女穿着格
                                       picking through green 子衬衫，坐在水边
                                    leaves on a large,                            的石阶上，低头整
                                  round woven tray. her                            理竹篮里的绿叶蔬
                                hands are in the
                            菜，背景是爬满藤                                  upper center of the
                                             tray, which occupies  蔓的石屋、游着锦
                                     the lower right     鲤的池塘与堆成小
                                     foreground. behind  山的水果，画面带
                                        her, a tranquil body of                            有柔焦光晕与复古
                                  green water, likely a
                            胶片颗粒感，镜头
                               pond or stream, is
                            缓慢推近，捕捉少                                              visible, with hints of
                                    red koi fish      女温柔的神态与蔬
                                 swimming. the    菜的细节，传递出
                                 background features  宁静又治愈的氛
                               a stone wall adorned                            围。
                                       with lush green
                                           foliage, and to the
                                                      left, a wooden shelf
                                    holds several brown,
                                  round objects,

========== 主合集 第 149 页 ==========

                                      possibly fruit or nuts.
                                             --ar 31:15

盆中蒸汽                         eye level shot of a   运镜：缓慢推近，
                                               light green      轻微呼吸感晃动华
                                enamelware bowl,                            语老电影质感，暖
                                              partially filled with
                            调室内灯光，昏暗                                        clear water, on a dark
                            厨房场景。绿色搪                              wooden surface. a
                                               light pinkish cloth is  瓷盆里盛着冒着白
                                 draped over the rim  汽的热水，一条条
                                          of the bowl and                            纹布料搭在盆沿，
                                   extends into the                            背景是老旧的木
                                      water. the
                            桌，画面带有复古                                 background is very
                                    dark and out of focus. 胶片颗粒感与柔光
                            some steam is visible 滤镜，镜头缓慢推
                                            rising from the water,  近，捕捉蒸汽升腾
                                           particularly on the left                            的动态与布料的褶
                                      side of the bowl. the
                            皱细节，传递出朴
                                            lighting highlights the
                            素又充满生活感的                                  bowl and cloth. --ar
                                   31:15        氛围。

稻田漫步                        a full shot of two    运镜：缓慢跟拍，
                                   people walking    轻微呼吸感晃动华
                                    through a field of                            语乡村电影质感，
                                      yellow crops, with a
                            暖调自然光，秋日                                dense green forest
                            午后的金黄稻田。                               and a large, gnarled
                                        tree in the      一对男女的背影并
                                   background. a utility  肩走在稻田间，前
                                     pole with wires is                            方是茂密山林与古
                                            visible on the left side                            树，电线杆立在画
                                          of the frame. the
                            面左侧，画面带有                                  person on the left
                                 wears a reddish    复古胶片颗粒感与
                                brown top and light  柔焦光晕，镜头缓
                                      pants, while the    慢跟拍，捕捉两人
                                  person on the right                            行走的动态与稻浪
                                 wears a light colored
                            起伏的细节，传递
                                        jacket over a dark
                            出平淡又温情的氛                                              shirt and dark pants.
                                     the field fills the lower 围。
                                           half of the image, and

========== 主合集 第 150 页 ==========

                                     the trees cover the
                                  upper half. --ar 31:15





 《绿山墙的安妮》影像风格提示词


         图片       图片提示词    视频提示词

女孩                              a medium close
                       镜头1（女孩                                  up shot features a
                                   young girl with red 视角：中近
                                       braided hair,
                      景）                                      wearing a straw
                                         hat and a white                            简奥斯汀式田园电
                                            striped dress with
                            影质感，暖调柔                                  a green collar,
                            光，玉米地场景。                                         looking towards
                                        the right with a   梳红棕色麻花辫、
                                         surprised     戴草帽的少女站在
                                         expression. she is                            玉米田中，正惊讶
                                         positioned slightly                            地抬头望向画面
                                             to the left of the
                            外，背景是层层叠                                        frame, surrounded
                                    by lush green corn 叠的玉米叶，画面
                                            stalks that fill the  带柔焦光晕与复古
                                    background and  胶片颗粒感，镜头
                                        foreground,                            轻微推近，捕捉她
                                          creating a sense
                            错愕的表情与发丝
                                             of being immersed
                            被风吹动的细节，                                                in nature. the
                                               lighting is soft and 传递出被惊扰的紧
                                             natural,      张氛围。
                                             highlighting her
                                                      fair skin. the text
                                           "oh_shirbert" is

========== 主合集 第 151 页 ==========

                                                visible in the top
                                                right corner.

男孩                              a young man with
                       镜头2（男孩                                       dark hair wears a
                                       straw hat, a white 视角：中近
                                           collared shirt, and
                      景）                                  a light brown vest
                                          with a dark strap                            简奥斯汀式田园电
                                      across his
                            影质感，暖调柔                                         shoulder. he looks
                            光，苹果园场景。                                                 slightly to the right
                                          with a neutral   戴草帽、穿复古马
                                         expression. he is  甲的少年站在苹果
                                         positioned in the                            树旁，侧头望向画
                                                        left center of the                            面外，背景是结着
                                        frame, surrounded
                            红苹果的枝叶，画                                    by a vibrant green
                                           natural setting,   面带柔焦光晕与复
                                          with an apple tree  古胶片颗粒感，镜
                                     branch with red   头轻微推近，捕捉
                                      apples and green                            他略带无措的神
                                       leaves visible on
                            态，传递出意外闯
                                        the right side of
                            入的氛围。                                        the image. the
                                    background is
                                          blurred green
                                               foliage.

花中捧蝶                           a medium shot   暖调柔光，秋日野
                                          features a young  花田场景。梳双麻
                                                        girl with red hair in                            花辫的雀斑少女蹲
                                                  pigtail braids,
                            在花丛中，双手捧                                      wearing a light
                            着一只黑色蝴蝶，                                        blue dress or shirt
                                          with a white    低头温柔注视，背
                                          pinafore over it, in 景是金黄的草穗与
                                  a field of dry                            野花，画面带柔焦
                                     grasses and                            光晕与复古胶片颗
                                            flowers. she is
                            粒感，镜头缓慢拉                                         holding a small,
                                       dark object     远，捕捉少女与花
                                   between her    海融为一体的画
                                  cupped hands,   面，传递出宁静又
                                      gazing intently

========== 主合集 第 152 页 ==========

                                   downwards. her  温柔的氛围。
                                                      fair skin shows a
                                           scattering of
                                             freckles. the
                                    background is a
                                              soft blur of green
                                  and yellow
                                          vegetation,
                                             indicating an
                                         outdoor, natural
                                               setting.

指尖蝶舞                         medium shot of a  暖调柔光，野花田
                                   young girl with red 特写场景。雀斑少
                                             hair and freckles                            女的指尖停着一只
                                  on her face,
                            帝王蝶，她微微低                                         looking down with
                            头，眼神温柔地注                                       her mouth slightly
                                      open. her left    视着蝴蝶，发丝被
                                  hand is raised,   阳光染成金棕色，
                                  and a monarch                            画面带柔焦光晕与
                                               butterfly is                            复古胶片颗粒感，
                                    perched on her
                            镜头缓慢推近，捕                                       index finger. the
                                    background is   捉蝴蝶的细节与少
                                          blurred with green 女的神态，传递出
                                  and yellow tones,  纯真又梦幻的氛
                                             indicating an                            围。
                                       outdoor setting
                                          with sunlight. the
                                               lighting is warm,
                                             highlighting her
                                             hair and the
                                                 butterfly's wings.

蝴蝶停发                               outdoor shot    暖调柔光，金色野
                                 shows a young   花田场景。梳红棕
                             woman with long                            色麻花辫的雀斑少
                                        reddish hair,
                            女仰头微笑，一只                                          pulled into two
                            帝王蝶停在她的发                                         braids on each
                                             side, smiling with  间，几只蝴蝶在她
                                       her mouth open.  伸出的指尖旁飞
                                       her face is                            舞，背景是虚化的
                                           illuminated by

========== 主合集 第 153 页 ==========

                               warm sunlight   草地与光斑，画面
                                      from behind,    带柔焦光晕与复古
                                             highlighting the                            胶片颗粒感，镜头
                                       red hues in her
                            缓慢推近，捕捉少                                                hair. she is looking
                            女的笑容与蝴蝶的                                             to her right, and
                                       her right hand is  动态，传递出治愈
                                     extended forward  又梦幻的氛围。
                                      toward two
                                  monarch
                                                 butterflies. one
                                               butterfly is resting
                                  on her head, while
                                        the other is near
                                       her outstretched
                                      hand. the
                                    background is a
                                              soft blur of green
                                             foliage and bright
                                         yellow light.

微笑特写                           a medium shot   运镜：缓慢推近，
                                 shows a young   轻微呼吸感晃动复
                             woman with long                            古田园电影质感，
                                        reddish brown
                            暖调柔光，户外廊                                                hair, styled in two
                            下场景。梳红棕色                                            braids, smiling
                                  and looking    双麻花辫的雀斑少
                                   upwards to the   女穿着碎花洋裙，
                                                          left. she is wearing                            抬头微笑着望向对
                                  a light colored,                            面的人，背景是虚
                                        long sleeved
                            化的绿植与光斑，                                      blouse with a
                                        small floral     画面带有复古胶片
                                            pattern. her skin is 颗粒感，镜头缓慢
                                                        fair, and she has  推近，捕捉少女明
                                                visible dimples                            亮的笑容与眼中的
                               when she smiles.
                            光，传递出温柔又
                                        the background is
                            心动的氛围。                                               brightly lit,
                                    showing blurred
                                     green foliage and
                                    what appears to
                                  be a white framed
                                  window or

========== 主合集 第 154 页 ==========

                                     doorway. to the
                                                          left, the shoulder
                                  and back of
                                       another person,
                                         out of focus and
                                      wearing a dark,
                                          possibly brown or
                                          grey, garment, is
                                                 visible, partially
                                       obscuring the view
                                             of the young
                                woman. the
                                             overall image has
                                  a grainy texture.

田野骑马远景                       a wide outdoor   运镜：缓慢跟拍，
                                        shot of a person  轻微呼吸感晃动复
                                  on horseback,                            古田园电影质感，
                                    viewed from
                            朦胧柔焦，浅绿调
                                        behind, riding
                            滤镜。穿复古长裙                                      across a grassy
                                                     field. the person is 的少女骑马穿过开
                                      wearing light    阔的草地，前景是
                                        colored with an                            虚化的树叶，背景
                                    orange or brown                            是朦胧的树林与天
                                       lower garment. the
                            空，画面带有复古                                     horse is dark
                                      brown. the     胶片颗粒感，镜头
                                    background    缓慢跟拍，捕捉骑
                                          features a light   马前行的背影，传
                                        blue sky with                            递出自由又治愈的
                                        white haze and a
                            氛围。
                                                 line of green trees
                                  on the horizon. the
                                       foreground
                                        contains out of
                                       focus green
                                               foliage, adding
                                     depth to the
                                      scene.

马厩对视                           a soft focus, film  运镜：缓慢推近，
                                          grain photograph  轻微呼吸感晃动复
                                         depicts a woman                            古田园电影质感，
                                                in a long white

========== 主合集 第 155 页 ==========

                                      dress and hat,   暖调柔光，木造马
                                   seen from the   厩场景。穿白色长
                                         waist up, facing a                            裙戴草帽的少女站
                                                   light brown foal in
                            在围栏旁，低头温                                  a barn stall. the
                            柔地看向围栏里的                                                  foal, also light
                                      brown, has its   小马，阳光透过窗
                                  head extended   户洒下丁达尔光
                                       over a wooden                            束，画面带有复古
                                      fence towards the                            胶片颗粒感，镜头
                                woman. behind
                            缓慢推近，捕捉少                                        the foal, another
                                            larger brown    女与小马对视的瞬
                                     horse is partially  间，传递出静谧又
                                                 visible, facing   治愈的氛围。
                                away from the
                                          viewer. two sunlit
                                  windows with
                                                visible frames are
                                                in the background.
                                        the barn interior
                                          features wooden
                               beams and walls,
                                          with visible light
                                              flares from the
                                     windows.

雏菊特写                            eye level shot of a 运镜：缓慢推近，
                                        person's hand   轻微呼吸感晃动复
                                         holding a single,                            古田园电影质感，
                                        small daisy with
                            暖调柔光，特写镜                                        white petals and a
                            头。少女的手握着                                         yellow center,
                                         against a soft   一朵白雏菊，阳光
                                          focus, brightly lit  透过花瓣洒下柔和
                                      background. the                            的光晕，背景是虚
                                               lighting is strong                            化的裙摆，画面带
                                      from the left,
                            有复古胶片颗粒                                          creating a slight
                                                   flare. the      感，镜头缓慢推
                                    background    近，捕捉雏菊的花
                                 shows hints of a  瓣与少女的指尖，
                                                   light colored shirt                            传递出温柔又充满
                                          or fabric and
                            希望的氛围。
                                  warm, muted

========== 主合集 第 156 页 ==========

                                         tones. the image
                                   has a grainy
                                             texture.

雏菊喂马特写                        eye level shot of a 运镜：缓慢推近，
                                        person's hand   轻微呼吸感晃动复
                                         holding a single,                            古田园电影质感，
                                        small daisy with
                            暖调柔光，户外场                                        white petals and a
                            景。浅棕色小马的                                         yellow center,
                                         against a soft   特写，少女的手拿
                                          focus, brightly lit  着一朵白雏菊，轻
                                      background. the                            轻递到小马鼻尖，
                                               lighting is strong                            阳光洒在小马柔软
                                      from the left,
                            的绒毛上，画面带                                          creating a slight
                                                   flare. the      有复古胶片颗粒
                                    background    感，镜头缓慢推
                                 shows hints of a  近，捕捉小马的眼
                                                   light colored shirt                            睛与雏菊的细节，
                                          or fabric and
                            传递出温柔又治愈
                                  warm, muted
                            的氛围。                                         tones. the image
                                   has a grainy
                                             texture.

                                  a full shot depicts
                                    two women in a
                                             lush, green
                                    greenhouse
                                       environment. the
                             woman on the left
                                                  sits on a light
                                   brown wicker
                                              chair, facing
                                       forward with a
                                                slight gaze to the
                                                   right. she has
                                        blonde, wavy hair
                                  and wears a light
                                           blue, floral
                                        patterned dress
                                          with short, ruffled
                                         sleeves. her
                                  hands are clasped

========== 主合集 第 157 页 ==========

with the hands of
the other woman,
who is kneeling on
the right, looking
up at her. this
kneeling woman
has blonde hair
styled in a braid
across her head
and wears a light
pink short sleeved
dress. in the upper
left background, a
light colored
statue is visible. a
vase of pink
flowers sits on a
woven stand to
the left of the
seated woman,
surrounded by
long, green
leaves.

two young women
stand outdoors,
looking at each
other against a
blurred
background of
green foliage with
small light purple
flowers. the
woman on the left
has light brown
hair tied back,
wearing a white
dress with blue
floral patterns and
tiered ruffles on
the shoulders. the
woman on the
right has blonde
hair in a braid
secured with two

========== 主合集 第 158 页 ==========

hairpins, wearing
a white short
sleeve collared
shirt with subtle
floral embroidery
and a light pink
skirt.

a full shot of a
woman in a short
teal dress sitting
on a window sill,
facing right, in a
dimly lit room. she
holds a cigarette
to her mouth.
sunlight streams
through the
window,
illuminating light
brown patterned
curtains on the
right side. her left
leg is bent with
her foot on the
window sill, while
her right leg
extends down to
rest on a white
radiator beneath
the window. the
room has dark
green walls, and a
small round
wooden stool with
papers on it is
visible in the lower
left foreground.

a young woman
with long dark
hair, wearing a
striped t shirt and
denim shorts,
leaning back

========== 主合集 第 159 页 ==========

against a window
frame with her
head tilted
upwards, eyes
closed or looking
up. the window
shows bright
green foliage
outside. to the
right, a sheer
patterned curtain
with light brown
floral designs
hangs. a small
white lamp with a
curved neck sits
on the windowsill
next to a white
ashtray or dish. a
dark wall or door
frame is visible on
the left side of the
image, obscuring
part of the room.

a young woman
with long dark
hair, wearing a
white and red
striped short
sleeve shirt and
dark pants, stands
indoors by a
window. her arms
are crossed in
front of her. the
window shows
blurred green
foliage outside. to
the right of the
window, a light
brown curtain with
a floral pattern
hangs. a small
white and orange

========== 主合集 第 160 页 ==========

                                   lamp sits on the
                                           windowsill. the
                                                 interior wall to the
                                                        left is dark.





 《风的第一声呼吸》影像风格提示词


         图片       图片提示词    视频提示词

窗边剪影                           a side profile    运镜：缓慢推近，
                                            silhouette of a   轻微呼吸感晃动复
                                       person, likely a                            古文艺电影质感，
                                woman, with
                            逆光柔光，室内场
                                        reddish brown
                            景。少女的侧脸剪                                                hair, positioned on
                                        the left side of the  影被窗外的阳光勾
                                        frame, looking   勒出来，背景是模
                                   downwards. the                            糊的绿植与光斑，
                                    background is                            画面带有复古胶片
                                               brightly lit,
                            颗粒感，镜头缓慢                                    showing blurred
                                     green foliage and  推近，捕捉她低垂
                                            hints of a pink   的眼神与发丝的轮
                                          flower and a blue  廓，传递出温柔又
                                             object, possibly a                            略带伤感的氛围。
                                    vase or stem. the
                                               lighting creates a
                                         strong contrast,
                                        rendering the
                                        person's face and
                                     upper body almost
                                               entirely in shadow,
                                     emphasizing her
                                                profile against the
                                             bright backdrop.

========== 主合集 第 161 页 ==========

暗夜花影                           a still life      运镜：缓慢推近，
                                     photograph    轻微呼吸感晃动复
                                  showcases                            古文艺电影质感，
                                         several vibrant
                            暗调柔光，夜景场                                    orange flowers
                            景。红色的花朵在                                  and green leaves
                                      arranged in a dark 黑暗中被光线照
                                               setting. to the   亮，花瓣纹理清
                                     upper right, a                            晰，背景是深绿色
                                     branch with small,                            的叶子和红色果
                                        round, orange
                            实，画面带有复古                                                    fruits or flowers is
                                                 visible. the lighting 胶片颗粒感，镜头
                                                    is focused on the  缓慢推近，捕捉花
                                                   flora, creating a   朵的细节与光影变
                                     glow around the                            化，传递出神秘又
                                    blossoms and
                            充满张力的氛围。
                                             highlighting the
                                          textures of the
                                          petals and leaves.
                                        the background is
                                       predominantly
                                           black, providing a
                                           stark contrast to
                                        the illuminated
                                           subjects.

陶罐与光影                         a still life      运镜：缓慢横移，
                                     photograph    轻微呼吸感晃动复
                                  showcases                            古文艺电影质感，
                                         several vibrant
                            暖调柔光，室内静                                    orange flowers
                            物场景。陶土色的                                  and green leaves
                                      arranged in a dark 陶罐里插着干花，
                                               setting. to the   阳光透过窗户在墙
                                     upper right, a                            上投下清晰的影
                                     branch with small,                            子，画面带有复古
                                        round, orange
                            胶片颗粒感，镜头                                                    fruits or flowers is
                                                 visible. the lighting 缓慢横移，捕捉光
                                                    is focused on the  影随时间变化的动
                                                   flora, creating a   态，传递出静谧又
                                     glow around the                            怀旧的氛围。
                                    blossoms and
                                             highlighting the

========== 主合集 第 162 页 ==========

                                          textures of the
                                          petals and leaves.
                                        the background is
                                       predominantly
                                           black, providing a
                                           stark contrast to
                                        the illuminated
                                           subjects.

低光特写                                cinematic shot   运镜：缓慢推近，
                                      focuses on the left 轻微呼吸感晃动复
                                         side of a person's                            古文艺电影质感，
                                           face, angled
                            暖调低光，室内特
                                   downward. loose
                            写场景。少女的脸                                        strands of dark
                                             hair fall across the 部特写，光线从一
                                      forehead and    侧打过来，照亮她
                                      cheek. the                            的脸颊与发丝，眼
                                        person's eyes are                            神低垂，画面带有
                                       closed or looking
                            复古胶片颗粒感，                                   down, with the
                                         bridge of the nose 镜头缓慢推近，捕
                                  and upper lip    捉她眼中的情绪与
                                                 visible. the skin   光影细节，传递出
                                       tone is warm with                            忧郁又沉静的氛
                                    shadows. a light
                            围。
                                         pink garment with
                                  a floral pattern is
                                                visible on the
                                         shoulder. the
                                    background is
                                                softly blurred.

栅栏旁的少女                       a medium shot   运镜：缓慢推近，
                                          features a person  轻微呼吸感晃动复
                                          with long reddish                            古田园电影质感，
                                   brown hair, seen
                            暖调柔光，户外场                                      from the back,
                            景。红头发的少女                                         leaning on a rustic
                                wooden fence. the 穿着深色上衣与碎
                                     person is wearing  花裙，靠在老旧的
                                  a dark blue top                            木栅栏旁，望向远
                                  and a dark blue                            处的河流，背景是
                                                   skirt with a light
                            葱郁的绿植，画面                                                    floral pattern. the

========== 主合集 第 163 页 ==========

                                      fence consists of  带有复古胶片颗粒
                                           horizontal planks  感，镜头缓慢推
                                  and a vertical post                            近，捕捉她的背影
                                  on the right. lush
                            与发丝被风吹动的                                     green foliage with
                            细节，传递出宁静                                         various shades of
                                        green, including  又略带迷茫的氛
                               some brighter   围。
                                              highlights, forms
                                        the soft focus
                                      background.

钢琴剪影                           a full shot from   运镜：缓慢拉远，
                                      behind of a person 轻微呼吸感晃动复
                                                  sitting in front of a                            古文艺电影质感，
                                      piano in a dimly lit
                            逆光柔光，室内场                                     room. the room
                            景。少女的背影坐                                          features a wall
                                          with multiple    在钢琴前，阳光透
                                    framed pictures on 过白色的窗帘洒进
                                        the left. two large                            房间，照亮地板上
                                  windows at the                            的光影，背景是墙
                                    back allow natural
                            上的相框与窗外的                                                   light to stream in,
                                     green trees    绿植，画面带有复
                                           outside. a sheer,  古胶片颗粒感，镜
                                        white curtain is   头缓慢拉远，捕捉
                                                visible on the right                            她与钢琴融为一体
                                     window. on the
                            的剪影，传递出温
                                                right side of the
                            柔又充满故事感的                                     room, a small
                                     round table with  氛围。
                                  an object on it is
                                          present. the
                                              flooring has a
                                        patterned design.

林间漫步                           a full shot shows a 运镜：缓慢拉远，
                             woman walking  轻微呼吸感晃动复
                                away from the                            古文艺电影质感，
                                  camera on a dirt
                            逆光柔光，林间场
                                       path through a
                            景。穿深色裙子的                                                sunlit forest. tall
                                          trees with green  少女背对着镜头，
                                       leaves line both  走在被树木环绕的

========== 主合集 第 164 页 ==========

                                        sides of the path,  小路上，阳光透过
                                          creating an    树叶洒下斑驳的光
                                   archway effect.                            影，画面带有复古
                                            sunlight filters
                            胶片颗粒感，镜头                                       through the
                            缓慢拉远，捕捉她                                      canopy, dappling
                                        the path and    逐渐远去的背影，
                                       undergrowth. the  传递出孤独又自由
                             woman has long,                            的氛围。
                                       dark hair and
                                   wears a dark top
                                  and a dark,
                                          possibly blue,
                                                     skirt. her back is
                                             to the viewer, and
                                   she appears to be
                                       walking deeper
                                               into the woods.

光影特写                                cinematic portrait  运镜：缓慢推近，
                                 shows a person  轻微呼吸感晃动复
                                          with short brown                            古文艺电影质感，
                                                hair, a serious
                            暖调低光，室内特
                                         expression, and
                            写场景。雀斑少女                                                      fair skin, with
                                                visible freckles on  的脸部特写，一侧
                                                their nose and   被阴影笼罩，另一
                                      cheeks. the left                            侧被柔和的光线照
                                         side of the face is                            亮，眼神带着疏离
                                           illuminated by a
                            与沉思，画面带有                               warm light,
                                             highlighting the   复古胶片颗粒感，
                                        eye, which has a  镜头缓慢推近，捕
                                                visible reflection,  捉光影在她脸上流
                                  and parts of the                            动的细节，传递出
                                      nose, lips, and
                            神秘又忧郁的氛
                                             chin. the right side
                            围。                                             of the face is in
                                  deep shadow, with
                                         only a faint
                                     glimmer in the
                                                right eye. the
                                        person's lips are
                                                 slightly parted, no
                                             teeth. the

========== 主合集 第 165 页 ==========

                                    background on the
                                                                               lit side appears to
                                  be a light colored
                                            wall or window
                                        frame, while the
                                 shadowed side is
                                             dark..

远景                              a wide shot    运镜：缓慢推近，
                                       captures two    轻微呼吸感晃动日
                                           silhouetted figures                            系电影质感，黄昏
                                        standing next to a
                            海边场景。空旷的                                               brightly illuminated
                            悬崖边，一台发光                                      vending machine
                                          with the text       的“dydoo” 自动贩
                                       "dydo" on it,    卖机是唯一光源，
                                         against the                            两个少女的剪影站
                                    backdrop of a                            在贩卖机前，背景
                                                 twilight sky that
                            是渐变的暮色天空                                             transitions from
                                       dark blue to a faint 与海面，画面带有
                                    orange at the    复古胶片颗粒感与
                                          horizon. the    轻微电影噪点，镜
                                    ground is dark and                            头缓慢推近，捕捉
                                            featureless, with
                            贩卖机的冷光与少
                                             distant faint lights
                            女的轮廓，传递出                                                visible near the
                                        horizon on the left 孤独又治愈的氛
                                             side, under a vast  围。
                                   expanse of sky.

近景                              a medium shot at  运镜：缓慢推近，
                                                 twilight shows two 轻微呼吸感晃动日
                                   young women                            系电影质感，黄昏
                                        standing near a
                            海边场景。穿校服                                               brightly lit vending
                            的两个少女站在                                   machine in an
                                       outdoor setting.     “dydo” 自动贩卖机
                                        the woman on the 前，贩卖机的冷光
                                                          left, in a school                            照亮她们的侧脸，
                                       uniform with a                            一人手里拿着饮
                                        white short sleeve
                            料，背景是暮色天                                                  shirt and dark
                                     jumper dress,   空与荒草，画面带
                                       faces right and   有复古胶片颗粒感

========== 主合集 第 166 页 ==========

                                        looks towards the  与轻微电影噪点，
                                      vending machine.  镜头缓慢推近，捕
                                        the woman on the                            捉贩卖机里的饮料
                                                   right, mostly in
                            与少女的神态，传                                             silhouette, stands
                            递出安静又略带疏                                               directly in front of
                                        the "dydo"     离的氛围。
                                    branded vending
                                     machine, holding
                                  a drink. the
                                   machine displays
                                         various beverages
                                  and has "cold"
                                              labels. the
                                    background
                                          features a dark,
                                             blurry sky
                                             transitioning from
                                        blue to a faint
                                       orange, with a
                                       dark fence line
                                                 visible.

浴缸青苹果特写                      eye level shot   运镜：缓慢推近，
                                 shows a young   轻微呼吸感晃动暗
                                     person                            黑文艺电影质感，
                                  submerged in
                            低光冷调，浴缸特                                      water with
                            写场景。少年的脸                                  numerous green
                                         apples. the    半浸在水中，周围
                                        person's face is  漂浮着大量青苹
                                         positioned                            果，水面反光映在
                                               centrally, with their                            他的脸上，眼神直
                                    eyes and nose
                            勾勾望向镜头，画                                                visible above the
                                            waterline, while   面带有复古胶片颗
                                                their mouth and  粒感与轻微水雾效
                                         chin are mostly   果，镜头缓慢推
                                    obscured by the                            近，捕捉水面晃动
                                         apples. their hair
                            与少年眼神的细
                                                    is dark and wet,
                            节，传递出神秘又                                       framing their face.
                                        the apples are   不安的氛围。
                                             bright green and
                                    appear to be

========== 主合集 第 167 页 ==========

                                               floating around
                                      them, filling the
                                       lower and outer
                                          portions of the
                                        frame. the lighting
                                                    is soft and
                                 somewhat dim,
                                          creating a
                                               reflective sheen
                                  on the water and
                                        the person's skin.

咬苹果特写
                     镜头2：咬苹
                     果特写

                            运镜：缓慢推近，
                           轻微呼吸感晃动暗
                            黑文艺电影质感，
                            低光冷调，浴缸特
                            写场景。少年的脸
                            半浸在水中，手里
                            拿着一颗青苹果凑
                            近嘴边，水面反光
                            映在他的脸上，眼
                            神直勾勾望向镜
                            头，周围漂浮着青
                            苹果，画面带有复
                            古胶片颗粒感与轻
                            微水雾效果，镜头
                            缓慢推近，捕捉苹
                            果表面的水珠与少
                            年的神态，传递出
                            紧张又诡异的氛
                            围。

侧脸特写                               shallow depth of  运镜：缓慢推近，
                                                   field shot of a   轻微呼吸感晃动复
                                        person's face from                            古文艺电影质感，
                                        the nose to the
                            暖调柔光，户外特                                             chin, partially

========== 主合集 第 168 页 ==========

                                    obscured by green 写场景。红发少女
                                           plant leaves in the 的侧脸特写，阳光
                                        foreground.                            在她脸上切割出明
                                            sunlight
                            暗对比，前景是虚                                            illuminates the
                            化的草叶，画面带                                         bridge of the nose,
                                         casting a shadow  有复古胶片颗粒
                                       below. the person  感，镜头缓慢推
                                   has light skin and                            近，捕捉她专注的
                                        reddish brown hair                            眼神与光影细节，
                                          flowing to the
                            传递出神秘又疏离                                                   right. the
                                    background is   的氛围。
                                       dark and out of
                                          focus.

光影特写                           a close up portrait 运镜：缓慢推近，
                                             of a young woman 轻微呼吸感晃动复
                                          with reddish                            古文艺电影质感，
                                   brown hair,
                            暖调柔光，户外特                                         looking towards
                            写场景。红发雀斑                                        the viewer with a
                                                slight smile. her  少女的脸部特写，
                                        face is partially   阳光透过树叶在她
                                           illuminated by                            脸上投下斑驳的光
                                             sunlight, creating                            影，发丝边缘泛着
                                            highlights on her
                            金光，她嘴角带                                      nose, upper lip,
                                  and right cheek.  笑，画面带有复古
                                       her left eye is   胶片颗粒感，镜头
                                                visible and dark,  缓慢推近，捕捉光
                                         while her right eye                            影流动与她温柔的
                                                    is mostly in
                            神态，传递出治愈
                                   shadow. the
                            又慵懒的氛围。                                    background is
                                       dark and out of
                                          focus, showing
                                            hints of green and
                                   brown foliage. a
                                               bright, vertical,
                                      golden light streak
                                                    is visible on her
                                                right cheek.

========== 主合集 第 169 页 ==========

奔跑的少女                         a blurry, motion   运镜：跟拍镜头，
                                                         filled, eye level,  轻微动态模糊复古
                                medium shot of a                            文艺电影质感，暖
                                     person with long,
                            调柔光，户外场                                            flowing, red hair.
                            景。红发少女在林                                        the person is
                                      wearing a dark   间奔跑，发丝在风
                                        colored tank top  中飞扬，背景是虚
                                  and is shown from                            化的绿植，画面带
                                        the chest up, with                            有复古胶片颗粒感
                                                their right arm
                            与动态模糊效果，                                       bent and hand
                                      clenched into a fist 镜头跟拍她的身
                                                visible on the left  影，捕捉奔跑的动
                                         side of the frame.  感与阳光透过树叶
                                                their face is                            的光斑，传递出自
                                             largely obscured
                            由又充满活力的氛
                                    by the motion blur
                            围。                                  and the movement
                                             of their hair. the
                                    background is a
                                         streaky blur of
                                     green and hints of
                                                lighter areas,
                                             indicating foliage
                                  and possibly sky,
                                                         all heavily affected
                                    by motion. the
                                               lighting appears
                                               bright, highlighting
                                        the red hair.

黑白小猫                           a full shot of two  运镜：缓慢推近，
                                                kittens, one black  轻微呼吸感晃动复
                                  and one white,                            古文艺电影质感，
                                        standing in vibrant
                            暖调柔光，户外场
                                     green grass under
                            景。一只黑色小猫                                     dappled sunlight.
                                        the black kitten is  与一只白色小猫站
                                  on the left, slightly 在草地上，阳光透
                                      behind the white                            过树叶洒在它们身
                                       one, which is                            上，背景是虚化的
                                         positioned
                            绿植与红花，画面                                      towards the right
                                         side of the frame.  带有复古胶片颗粒

========== 主合集 第 170 页 ==========

                                       both kittens face  感，镜头缓慢推
                                      towards the right.  近，捕捉小猫的神
                                         lush green foliage                            态与毛发细节，传
                                          with hints of red
                            递出治愈又温馨的                                         flowers is visible in
                            氛围。                                        the background,
                                         out of focus. the
                                      grass in the
                                       foreground is also
                                     green and slightly
                                         out of focus, with
                                  a few dry leaves
                                           scattered.

 《音乐之声》影像风格提示词


         图片       图片提示词    视频提示词

河畔歌唱                           a side profile    运镜：缓慢拉远，
                                            silhouette of a   轻微呼吸感晃动复
                                       person, likely a                            古田园电影质感，
                                woman, with
                            暖调柔光，河畔场                                        reddish brown
                            景。穿长裙的少女                                                hair, positioned on
                                        the left side of the  抱着吉他，在河边
                                        frame, looking   的草地上为孩子们
                                   downwards. the                            歌唱，背景是河
                                    background is                            流、青山与村庄，
                                               brightly lit,
                            画面带有复古胶片                                    showing blurred
                                     green foliage and  颗粒感，镜头缓慢
                                            hints of a pink   拉远，捕捉少女与
                                          flower and a blue  孩子们互动的场
                                             object, possibly a                            景，传递出治愈又
                                    vase or stem. the
                            充满希望的氛围。
                                               lighting creates a
                                         strong contrast,
                                        rendering the
                                        person's face and
                                     upper body almost
                                               entirely in shadow,
                                     emphasizing her
                                                profile against the

========== 主合集 第 171 页 ==========

                                             bright backdrop.

河畔行进                           a full shot depicts  运镜：缓慢跟拍，
                                  a lively scene with 轻微呼吸感晃动复
                                  a group of women                            古田园电影质感，
                                     descending a
                            暖调柔光，河畔场                                      grassy bank
                            景。一群穿长裙、                                      towards a wide
                                                 river under bright  戴头巾的少女沿着
                                             daylight. a young  开满黄花的河岸前
                             woman in the                            行，有人提着篮
                                       foreground wears                            子，有人抱着乐器
                                  a white head
                            箱，背景是河流与                                        covering and a
                                   brown dress,    草地，画面带有复
                                          carrying a black  古胶片颗粒感，镜
                                       musical      头缓慢跟拍，捕捉
                                        instrument case,                            她们轻快的步伐与
                                       her left arm
                            笑容，传递出自由
                                          outstretched.
                            又欢快的氛围。                                      behind her, a line
                                             of women in light
                                        colored dresses,
                               some carrying
                                        baskets, follows
                                        the slope. the river
                                                                 fills the left side of
                                        the frame, with a
                                       simple wooden
                                       boat docked on
                                        the bank in the
                                       lower left corner.
                                        the sunny
                                          conditions
                                            illuminate the
                                      scene, casting soft
                                                   light on the water
                                  and the vibrant
                                     green grass
                                         dotted with yellow
                                            wildflowers.

========== 主合集 第 172 页 ==========

 《月麟绮纪》影像风格提示词


         图片       图片提示词    视频提示词

红衣女子特写                        eye level shot   运镜：缓慢推近，
                                 shows a woman  轻微呼吸感晃动古
                                          with long dark                            风武侠电影质感，
                                                hair, parted
                            暖调柔光，室内特
                                           center, and bright
                            写场景。穿红色古                                  makeup, including
                                    winged eyeliner  装的女子直视镜
                                  and vibrant red   头，眼神清冷又带
                                                   lipstick. she is                            着故事感，背景是
                                      wearing a                            虚化的光影与模糊
                                    shimmering red
                            的男性剪影，画面                                    garment and
                                         looking directly at  带有柔焦光晕与复
                                someone out of   古胶片颗粒感，镜
                                     frame to the right.  头缓慢推近，捕捉
                                       her face is softly                            她精致的五官与发
                                                                           lit, creating a glow,
                            丝细节，传递出清
                                          with some light
                            冷又神秘的氛围。                                              flares visible. the
                                    background is out
                                             of focus and warm
                                         toned, suggesting
                                  an indoor setting.

双人同框特写                           cinematic shot   运镜：缓慢推近，
                                 shows two young  轻微呼吸感晃动古
                                       asian individuals,                            风武侠电影质感，
                                  a woman on the
                            暖调柔光，室内特                                                        left and a man on
                            写场景。红衣女子                                        the right, looking
                                 downwards with  与黑衣男子紧挨在
                                              soft expressions.  一起，两人同时低
                                        the woman has                            头，神情专注，背
                                        long dark hair and                            景是朦胧的暖光与
                                   wears a red
                            镜头眩光，画面带                                      garment. the man
                                   has long dark hair 有柔焦光晕与复古
                                          with some strands 胶片颗粒感，镜头
                                                  falling over his   缓慢推近，捕捉两
                                        face and wears a

========== 主合集 第 173 页 ==========

                                       dark top with    人的神态与发丝细
                               some reflective   节，传递出暧昧又
                                       elements. both are                            紧张的氛围。
                                     bathed in a warm,
                                       glowing light that
                                        creates lens flare,
                                               particularly
                                         noticeable over
                                        the man's right
                                        eye, giving the
                                   scene a dreamy
                                  and ethereal
                                                quality. the
                                    background is
                                                softly blurred and
                               warm toned.



 杜可风影像风格提示词


         图片       图片提示词    视频提示词

复古舞厅                           a medium shot   运镜：缓慢推近，
                                          features a woman 轻微呼吸感晃动复
                                          with short, dark,                            古港风电影质感，
                                 wavy hair, wearing
                            暖调柔光，舞厅场                                  a white
                            景。穿白色改良旗                                 cheongsam dress
                                          with short sleeves 袍的女子直视镜
                                  and a high collar.  头，戴着黑手套的
                                   she has a                            手向前伸出，背景
                                          sparkling v                            是霓虹灯与复古装
                                  shaped necklace
                            饰，画面带有复古                                          with a red stone
                                           center. her eyes  胶片颗粒感与柔焦
                                       are open and she  光晕，镜头缓慢推
                                   has red lipstick.   近，捕捉她冷艳的
                                       her right arm is                            神态与服饰细节，
                                     extended towards
                            传递出魅惑又疏离
                                        the viewer,
                            的氛围。                                      wearing a dark

========== 主合集 第 174 页 ==========

                                       glove with red
                                              fabric near her
                                      hand. in the
                                      background, to the
                                                          left, is a circular
                                emblem with a
                                         heart shape
                                              inside. to the right,
                                  a vertical red neon
                                                   light outline of a
                                             figure is visible
                                         against a dark
                                      background. the
                                               lighting is soft and
                                  warm.

玫瑰特写                           a medium close  运镜：缓慢推近，
                                  up shot features a 轻微呼吸感晃动复
                                   young woman in                            古港风电影质感，
                                        the foreground,
                            暖调柔光，舞厅场                                          facing the viewer
                            景。穿白色改良旗                                                 directly. she wears
                                  a white sleeveless 袍的女子手持红玫
                                      dress with a high  瑰，背景是虚化的
                                               collar and an                            舞池人群与霓虹
                                         elaborate silver                            灯，画面带有复古
                                  and pink beaded
                            胶片颗粒感与柔焦                                        necklace. black
                                       gloves cover her  光晕，镜头缓慢推
                                      hands, one of   近，捕捉她眼神与
                                     which holds a red  玫瑰的细节，传递
                                       rose near her                            出暧昧又充满张力
                                     mouth. her dark
                            的氛围。
                                             hair is styled with
                                  a slight wave, and
                                  a pearl bracelet
                                     adorns her wrist.
                                      behind her to the
                                                          left, another
                             woman in a black
                                      dress with colorful
                                                    floral embroidery
                                        smiles faintly, her
                                             hair styled in a
                                  bun with a purple

========== 主合集 第 175 页 ==========

                                       accessory. further
                                    back on the left, a
                                                third woman in a
                                        black dress with a
                                          pearl necklace
                                          smiles. to the
                                                   right, the back of a
                             man in a white
                                           collared shirt and
                                                   light colored pants
                                                    is visible, with a
                                                  faint neon light
                                        decoration above
                                        him. other blurred
                                            figures are visible
                                                in the background.

男子持花                           a close up shot of  运镜：缓慢推近，
                                  a man holding a  轻微呼吸感晃动复
                                       red flower to his                            古港风电影质感，
                                      nose, smelling it,
                            暖调柔光，黄昏场
                                            his eyes looking
                            景。穿西装的男子                                               directly at the
                                    camera. he has   手持红玫瑰，背景
                                          short dark hair   是渐变的暮色天空
                                  and is wearing a                            与建筑剪影，画面
                                       dark uniform                            带有复古胶片颗粒
                                           jacket with light
                            感与柔焦光晕，镜                                        colored undershirt.
                                        the background is  头缓慢推近，捕捉
                                  a gradient of    他的眼神与玫瑰的
                                         purple to orange  细节，传递出浪漫
                                          with dark                            又略带伤感的氛
                                           silhouettes on the
                            围。
                                           sides.

镜前梳妆                           a medium shot   运镜：缓慢推近，
                                          features a woman 轻微呼吸感晃动王
                                                in a traditional                            家卫式民国电影质
                                        long sleeved
                            感，暖调柔光，古                                      dress looking at a
                            色古香的闺房场                                           small, ornate, oval
                                     handheld mirror in 景。穿黑色旗袍的
                                       her right hand, her 女子坐在梳妆台
                                                        left arm resting on                            前，手持雕花铜

========== 主合集 第 176 页 ==========

                                  a dark wooden   镜，桌上摆放着青
                                           table beside    花瓷瓶、香粉盒与
                                         various items. on                            化妆品，背景是雕
                                        the table, to her
                            花窗棂与红灯笼，                                                          left, are several
                            画面带有复古胶片                                         decorative
                                            objects: a blue   颗粒感与柔焦光
                                  and white vase   晕，镜头缓慢推
                                          with white flowers,                            近，捕捉她清冷的
                                    two ornate framed                            神态与房间的细
                                            mirrors, several
                            节，传递出古典又                                        small red and gold
                                          lidded containers,  疏离的氛围。
                                         various small
                                               bottles, a blue
                                      ceramic pot, and a
                                        stack of gold
                                           coins. the
                                    background
                                 shows dark
                                wooden walls with
                                       geometric
                                        patterned
                                     windows. warm
                                                   light streams from
                                  an unseen source
                                  on the right,
                                         casting a glow on
                                        the woman and
                                          parts of the table.

执扇特写                           a medium shot   运镜：缓慢推近，
                                          features a woman 轻微呼吸感晃动王
                                          with dark hair                            家卫式民国电影质
                                          pulled back,
                            感，暖调柔光，室                                      wearing a dark top
                            内特写场景。穿黑                                          with a mandarin
                                               collar and green  色旗袍的女子手持
                                        dangling earrings, 绘山水的团扇，直
                                         holding a white                            视镜头，背景是虚
                                        fan with a subtle                            化的挂画与灯笼，
                                     landscape design.
                            她的耳坠和发间的                                   she looks directly
                                             at the viewer with  紫花细节清晰，画
                                       red lipstick. the   面带有复古胶片颗

========== 主合集 第 177 页 ==========

                                    background is   粒感与柔焦光晕，
                                        dimly lit with    镜头缓慢推近，捕
                                          blurred patterned                            捉她精致的五官与
                                     screens to the
                            眼神，传递出清冷                                                right and framed
                            又神秘的氛围。                                       items on the left.

近景特写                           a medium close  运镜：缓慢推近，
                                  up of an east   轻微呼吸感晃动王
                                       asian woman with                            家卫式民国电影质
                                  a serene
                            感，暖调柔光，室
                                         expression,
                            内特写场景。穿黑                                         looking directly at
                                        the viewer. she   色旗袍的女子脸部
                                   has dark hair    特写，暖光打在她
                                          pulled back, with a                            的脸上，背景是虚
                                               hint of purple on                            化的红灯笼，她的
                                        the left side of her
                            耳坠与发间的紫花                                      head. her skin is
                                                        fair, and she    清晰可见，画面带
                                   wears red lipstick. 有复古胶片颗粒感
                                   she is adorned   与柔焦光晕，镜头
                                          with long, dangle                            缓慢推近，捕捉她
                                          earrings with
                            眼神的细微变化，
                                     green rectangular
                            传递出沉静又充满                                        jade pieces. her
                                                   attire is a dark,   故事感的氛围。
                                        high collared
                                      garment, possibly
                                  a cheongsam or
                                         qipao, with
                                         decorative toggles
                                  and knots visible
                                    around the
                                           neckline. the
                                    background is
                                        dimly lit and out of
                                          focus, showing a
                                        reddish
                                         rectangular object
                                  on the left, and a
                                          darker, indistinct
                                  shape on the right.

========== 主合集 第 178 页 ==========

霓虹光影双人                       a close up, eye   运镜：缓慢拉远，
                                                level, wide shot   轻微动态模糊赛博
                                     photo shows a                            港风电影质感，蓝
                             man and woman
                            粉霓虹光线，两个                                                in a tunnel with
                            少年依偎在一起，                                  neon blue and
                                         pink lighting. the  闭眼倚靠，背景是
                             man is on the   模糊的霓虹光斑与
                                                   right, looking                            车流轨迹，画面带
                                   down. his skin is                            复古胶片颗粒与动
                                                     light, his hair is
                            态拖影效果，镜头                                       dark brown. his
                                  mouth is closed.  缓慢拉远，捕捉光
                                        the woman is on  影流动与人物轮
                                        the left, looking   廓，传递出迷幻又
                               down and resting                            暧昧的氛围。
                                       her head on the
                                    man's shoulder.
                                       her skin is fair, her
                                             hair is dark brown
                                  and covers her
                                      forehead and
                                       eyes. her mouth is
                                          closed. she wears
                                  a dark top. the
                                    background of the
                                         tunnel is out of
                                          focus. the tunnel's
                                          walls show light
                                         streaks of white,
                                           blue, and red.

绿调室内抽烟                       a close up, low
                                         angle, wide                            运镜：缓慢推近，
                                          fisheye shot of a
                            轻微呼吸式晃动王                                     person with dark
                                             hair and a light   家卫式复古港风电
                                       complexion,    影质感，冷调绿色
                                          possibly a male,  荧光灯，少年脸上
                                         looking down and                            带着红痕，嘴里叼
                                   smoking a
                            着香烟，眼神低
                                            cigarette with
                            垂，背景是虚化的                                           stains visible on
                                                their cheek. they  室内场景，画面带
                                       are wearing a dark

========== 主合集 第 179 页 ==========

                                        blue and black   复古颗粒感与朦胧
                                            striped jacket over 水雾效果，光线随
                                  a black shirt with                            呼吸轻微晃动，传
                                        white lettering. the
                            递出颓丧又疏离的                                    background is a
                            氛围。                                             blurry green and
                                              teal room, with
                                    what appears to
                                  be another person
                                                in a dark red top
                                                visible in the top
                                                   right. a white,
                                           long, rectangular
                                          object is in the
                                    midground and
                                       another dark
                                          object is in the
                                        foreground, out of
                                          focus. the overall
                                               lighting is dim and
                                     green tinted,
                                         casting a
                                 somewhat eerie
                                     atmosphere.

车内依偎                           a still from a    运镜：缓慢横移，
                                      movie, featuring a 轻微动态模糊王家
                             woman in the                            卫式复古港风电影
                                       foreground looking
                            质感，冷调绿色霓                                      towards the upper
                            虹雨夜，车内少年                                                right with wide
                                    eyes and slightly  抽烟，身旁的少女
                                        parted lips,     靠在他肩头闭眼休
                                           illuminated by a                            憩，背景是雨夜模
                                       greenish blue                            糊的车流与路面，
                                                     light. her dark hair
                            画面带复古颗粒感                                     frames her face. in
                                        the background,  与动态拖影效果，
                                    two men are    镜头缓慢横移，捕
                                                visible in a dimly  捉车内的暧昧与孤
                                                                           lit, green                            独感。
                                          restaurant or
                                         kitchen setting.
                                  one man wears an
                                    orange jacket and

========== 主合集 第 180 页 ==========

                                                   light colored
                                         pants, facing away
                                      from the camera.
                                        the other man is
                                       mostly obscured.
                                        white tables with
                                wooden frames
                                       are in the
                                    midground and
                                        foreground.

灯下相拥                           a close up, vibrant 运镜：缓慢推近，
                                                portrait of a young 轻微呼吸式晃动复
                             man and woman                            古港风电影质感，
                                    embraced, bathed
                            红绿荧光灯管光                                                in intense red and
                            线，两个少年在霓                                     green neon
                                                 lighting. the man,  虹灯下相拥，一个
                                          with shoulder    笑得灿烂，一个温
                                         length brown hair                            柔倚靠，画面带复
                                  and blonde                            古颗粒感与柔焦光
                                              highlights, smiles
                            晕，光线在人物脸                                         widely at the
                                    camera, while the  上形成粉绿渐变，
                             woman rests her  传递出温暖又治愈
                                  head on his    的氛围。
                                         shoulder, looking
                                             to the left. she
                                   wears a white
                                                    shirt, and he
                                   wears a yellow
                                                    shirt. a bright
                                        white fluorescent
                                                   light fixture is
                                                visible at the top,
                                          contrasting with
                                        the dark
                                      background. the
                                               lighting creates a
                                       dramatic and
                                     atmosphere.

绿调室内抽烟                       a medium shot   运镜：缓慢推近，
                                            within a green lit  轻微呼吸式晃动王
                                         tunnel captures

========== 主合集 第 181 页 ==========

                                    two individuals. on 家卫式复古港风电
                                        the right, a man  影质感，冷调绿色
                                          with dark hair                            荧光灯，少年脸上
                                 smokes a
                            带着红痕，嘴里叼                                              cigarette, with his
                            着香烟，眼神低                                        face in profile. on
                                        the left, a woman  垂，背景是虚化的
                                          with dark hair   室内场景，画面带
                                           rests her head on                            复古颗粒感与朦胧
                                            his back, looking                            水雾效果，光线随
                                   downwards. the
                            呼吸轻微晃动，传                                            tunnel's green
                                               lighting illuminates 递出颓丧又疏离的
                                        the scene, road   氛围。
                                     markings and faint
                                                lights of other
                                          vehicles in the
                                      background. the
                             man wears a dark
                                                    shirt, and the
                             woman has dark
                                          with hints of
                                         purple or dark
                                          colors visible on
                                       her shoulder. the
                                             overall
                                    atmosphere is
                                       dark and subdued,
                                    dominated by the
                                     green hue.

餐厅特写                           a close up,     运镜：缓慢推近，
                                          cinematic, slightly  轻微呼吸式晃动复
                                      low angle shot                            古港风电影质感，
                                       captures a young
                            暖调室内柔光，少                             woman with dark
                            女手持金属杯凑近                                             hair partially
                                        covering her face, 镜头，戴着粉钻戒
                                       her eyes looking  指，红唇鲜明，背
                               down and to the                            景是虚化的餐厅场
                                                          left. she holds a                            景与黑白格地砖，
                                        small spoon to her
                            画面带复古颗粒感                                       lower lip with her
                                                right hand,     与柔焦光晕，镜头
                                      wearing a large,  缓慢推近，捕捉她

========== 主合集 第 182 页 ==========

                                        ornate ring with a  的眼神与细节，传
                                      prominent pink   递出魅惑又疏离的
                                         jewel on her ring                            氛围。
                                               finger. her lips are
                                        painted red, and a
                                       leopard print
                                          pattern is visible
                                  on her . in the
                                      background, a
                                     person in a white
                                                  shirt and dark
                                          trousers stands
                                          with their back to
                                        the viewer, and
                                       another person in
                                  a floral or
                                        patterned top is
                                        seated, partially
                                      obscured. the
                                             setting appears to
                                  be an indoor
                                   space with green
                                          walls and a
                                     checkered floor
                                          with white and
                                       dark tiles. another
                                             blurry figure is
                                                visible further in
                                        the background. a
                                        round, light
                                        colored table is in
                                        the foreground.

格纹床抽烟少女                     a close up,     运镜：缓慢推近，
                                          cinematic, slightly  轻微呼吸式晃动复
                                      low angle shot                            古港风胶片电影质
                                       captures a young
                            感，暖调室内柔                             woman with dark
                            光，少女身着亮面                                             hair partially
                                        covering her face, 黑色漆皮裙、白丝
                                       her eyes looking  长袜，趴在红绿色
                               down and to the                            格纹床单上，手夹
                                                          left. she holds a                            香烟侧头望向镜
                                        small spoon to her
                            头，背景是浅色墙                                       lower lip with her

========== 主合集 第 183 页 ==========

                                                right hand,     纸与揉皱的黄色纸
                                      wearing a large,  团，画面带复古颗
                                        ornate ring with a                            粒感与柔焦光晕，
                                      prominent pink
                            光线随呼吸轻微晃                                         jewel on her ring
                            动，传递出慵懒颓                                               finger. her lips are
                                        painted red, and a 废的氛围。
                                       leopard print
                                          pattern is visible
                                  on her . in the
                                      background, a
                                     person in a white
                                                  shirt and dark
                                          trousers stands
                                          with their back to
                                        the viewer, and
                                       another person in
                                  a floral or
                                        patterned top is
                                        seated, partially
                                      obscured. the
                                             setting appears to
                                  be an indoor
                                   space with green
                                          walls and a
                                     checkered floor
                                          with white and
                                       dark tiles. another
                                             blurry figure is
                                                visible further in
                                        the background. a
                                        round, light
                                        colored table is in
                                        the foreground.



 复古英伦风影像风格提示词


         图片       图片提示词    视频提示词

玫瑰果篮静物                       a close up, soft   运镜：缓慢轻微前

========== 主合集 第 184 页 ==========

                                       focus image    移复古朦胧油画质
                                          features a woven  感，户外草地静
                                      basket with visible                            物，藤编果篮里放
                                     green leaves and
                            一颗橙黄色鲜果，                                  a small orange
                            旁侧盛放一簇柔粉                                                          fruit, set against a
                                          blurred      玫瑰，前景花瓣轻
                                    background of   微虚化，暖调柔
                                     green foliage. to                            光，玫瑰花瓣在微
                                        the right, a cluster                            风轻轻颤动。
                                             of vibrant pink
                                      roses with green
                                       leaves is
                                        prominently
                                          displayed. the
                                             overall color
                                            palette is warm,
                                    dominated by
                                   shades of green,
                                            pink, and orange,
                                          with a soft,
                                       dreamlike quality
                                  due to the out of
                                       focus rendering.

花海草帽少女                       a close up, eye   运镜：缓慢推近复
                                              level shot of a   古油画电影质感，
                             woman looking left                            暖调午后花园，少
                                             of frame, facing
                            女头戴缀满粉玫瑰                                                  profile. she has
                            的草编宽檐帽，身                                                      fair skin, light
                                   brown hair, full red 处橙粉野花丛中，
                                                     lips, and a high   虚化花海做前景，
                                    cheekbone. she is                            暖光漫过肌肤，唇
                                      wearing a straw                            色温润，胶片颗粒
                                         hat with three light
                            质感，微风拂动碎                                         pink roses on the
                                         side of it, two are  发，眼神慵懒温
                                  on top and one is  柔。
                                  on the side near
                                       her ear. she also
                                    appears to be
                                      wearing a light
                                         pink blouse. the
                                    background is a

========== 主合集 第 185 页 ==========

                                              soft focus of
                                         yellow and light
                                         pink flowers.

湖畔长椅贵妇                       a full shot of a   运镜：缓慢横移深
                             woman in a deep  秋复古油画质感，
                                       red dress, seated                            雾蒙蒙的湖畔，酒
                                       outdoors next to a
                            红色礼服贵妇坐在                                   body of water. her
                            木质长椅，身旁放                                        face is in profile,
                                         looking towards  复古皮质手提包，
                                        the left side of the  身后芦苇与枯黄草
                                        frame. her dark                            木，湖面泛着朦胧
                                             hair is styled                            水光，秋日微风拂
                                          elaborately on top
                            动裙摆与芦苇。                                             of her head. she is
                                      wearing gloves
                                  and has a light
                                   brown bag beside
                                            her. the
                                    background
                                          consists of tall,
                                  dense green and
                                   brown foliage and
                                         reeds, with a calm
                                   body of water to
                                       her left. the overall
                                               lighting is dim,
                                       suggesting either
                                    dusk or an
                                        overcast day, with
                                  a subtle glow in
                                        the upper left.

窗边暮色剪影                       a full shot of a   运镜：固定慢变焦
                             woman in a deep  英伦复古胶片质
                                       red dress, seated                            感，暖黄黄昏雾感
                                       outdoors next to a
                            光影，屋内男子背                                   body of water. her
                            对镜头，透过复古                                        face is in profile,
                                         looking towards  木格玻璃窗眺望落
                                        the left side of the  日原野，窗外枯
                                        frame. her dark                            树、湖泊与落日被
                                             hair is styled                            薄雾晕染，整体低
                                          elaborately on top

========== 主合集 第 186 页 ==========

                                             of her head. she is 饱和暖棕色调，窗
                                      wearing gloves   边空气带着薄雾流
                                  and has a light                            动。
                                   brown bag beside
                                            her. the
                                    background
                                          consists of tall,
                                  dense green and
                                   brown foliage and
                                         reeds, with a calm
                                   body of water to
                                       her left. the overall
                                               lighting is dim,
                                       suggesting either
                                    dusk or an
                                        overcast day, with
                                  a subtle glow in
                                        the upper left.

车内贵妇                      A close-up eye-  运镜：缓慢微推维
                                              level vintage    多利亚复古暗调胶
                                                  realistic portrait of                            片质感，老式马车
                                  a Caucasian
                            车厢内，贵妇头戴
                             woman around 30
                            饰花礼帽、黑色蕾                                                in profile view,
                                    eyes gently closed 丝半遮面，酒红色
                                          with a serene and  复古礼服，窗边白
                                                 slightly aloof                            色蕾丝帘随车厢微
                                         expression. She                            风轻飘，柔和侧光
                                   wears a deep
                            勾勒面部轮廓，画                                    burgundy velvet
                                         vintage hat with  面温润做旧颗粒。
                                     matching pleated
                                              fabric trim, and a
                                        black polka-dot
                               mesh veil covering
                                               half her face with
                                                visible diamond
                                             grid pattern. Gold
                                     drop earrings with
                                                intricate vintage
                                                    floral details. Deep
                                    burgundy velvet
                                       high-neck top with
                                            delicate black lace

========== 主合集 第 187 页 ==========

                                             trim at the collar.
                            On the left side, a
                                         vintage train
                                          carriage window
                                          with cream-
                                        colored lace
                                           curtains featuring
                                        scalloped edges,
                                  a beige knitted
                                          spherical window
                                      handle attached.
                                    Dark moody
                                                 interior with dimly
                                                visible seat backs
                                                in the background.
                                           Victorian era
                                     atmosphere, warm
                                       dark yellow muted
                                         tones, cinematic
                                                 lighting, rich
                                            textures,
                                             photorealistic
                                           painting style

林间抬眸少女                       a young woman  运镜：缓慢小幅推
                                          with light skin and  进，轻微呼吸晃动
                                        long brown hair,                            欧式复古胶片电影
                                      wearing a
                            质感，暖调林间柔                                        patterned bonnet,
                            光，身穿碎花包头                                  a white scarf, and
                                  a light colored   布裙的金发少女仰
                                       buttoned shirt,   头望向树梢，阳光
                                        looks upwards.                            穿过绿叶在脸颊洒
                                       her face is in                            落斑驳光斑，发丝
                                                  profile, with her
                            被林间微风轻动，                                  mouth slightly
                                  open and a soft   画面带复古胶片颗
                                         expression. the   粒、柔焦光晕，氛
                                    background is a  围温柔治愈，林间
                                  bokeh blur of                            树叶微微晃动。
                                     green foliage and
                                     dappled light,
                                       suggesting an
                                       outdoor setting
                                          with trees and

========== 主合集 第 188 页 ==========

                                             plants. the lighting
                                                    is natural and
                                               bright, highlighting
                                       her face. the
                                       composition
                                      focuses on the
                                  woman's upper
                                   body and head. --
                                          ar 23:15

轻抚小马                            eye level shot of a 运镜：缓慢小幅推
                                   young woman with 近，轻微呼吸式镜
                                                   light brown hair                            头晃动欧式复古田
                                      wearing a white
                            园胶片电影质感，                                     bonnet and a light
                            暖调林间自然光，                                        blue and white
                                     checkered shirt,  头戴白色布艺包头
                                         leaning against a  帽、身着浅格纹乡
                                   brown and white                            村布衣的农家少
                                     dappled cow. her                            女，侧脸轻贴棕白
                                                right hand is on
                            花斑小马的脸颊，                                        the cow's fur, and
                                       her left hand is   手轻轻抚过马身铁
                                    draped over her  链缰绳，眼神温柔
                                                right arm. her   落寞，阳光穿过绿
                                   gaze is directed                            植在毛发与肌肤洒
                                 downward and
                            落细碎光斑，背景
                                                 slightly to her
                            虚化翠绿树丛，画                                                   right. the cow's
                                  head and neck are 面带复古胶片颗粒
                                                visible to the right  与柔焦光晕，微风
                                             of the woman,   轻轻吹动少女细碎
                                          with a metal chain                            卷发与马鬃，整体
                                    around its neck. a
                            氛围静谧忧伤，充                                          blurred green
                                    background    满古典乡村故事
                                     suggests foliage.  感。

                                  a close up portrait
                                             of a young woman
                                          with light skin and
                                       dark hair, pulled
                                       back, with wisps
                                             of hair framing her
                                        face and catching

========== 主合集 第 189 页 ==========

the light on the left
side. she has light
blue eyes and
light pink lips, and
a serious
expression. she is
wearing a light
colored garment
and two dangling
reddish purple
earrings, one
visible on each
ear. the
background is
softly blurred
green foliage with
patches of yellow
and bright
highlights,
suggesting an
outdoor setting in
natural light.

a full shot of a
woman standing
outdoors, looking
directly at the
viewer with a
neutral
expression. she
has light brown
hair styled up and
wears a dark
purple long sleeve
dress with a white
high collar and an
off white shawl
draped over her
forearms. her
arms are crossed.
the background
features blurred
green foliage and
branches with
small green

========== 主合集 第 190 页 ==========

                                       leaves and red
                                         tinged apples in
                                        the upper left.
                                         yellow flowers are
                                                visible in the lower
                                                        left portion of the
                                      background. the
                                               lighting suggests
                                           backlighting from
                                        the upper right,
                                             highlighting her
                                             hair and
                                         shoulders. the
                                             overall scene has
                                  a natural,
                                 somewhat muted
                                           color palette.



 《岁月神偷》影像风格提示词


         图片       图片提示词    视频提示词

庭院孩童                           a full shot of a   运镜：缓慢拉远，
                                   young child with a  轻微呼吸镜头90
                                        pale complexion,                            年代复古胶片质
                                      wearing a
                            感，暖黄午后自然
                                         transparent
                            光，老式居民院墙                                          fishbowl as a
                                      helmet with white  面光影斑驳，短发
                                    rounded ear like  小男孩头戴透明玻
                                           protrusions, a                            璃圆头盔，身穿白
                                        white tank top,                            色背心深色短裤，
                                  and dark blue
                            双臂张开原地缓                                            shorts. the child
                                      stands with arms  步，身旁老树枝叶
                                          outstretched,    繁茂，树影在墙面
                                      mimicking flight.  缓缓晃动，暖调做
                                        the background                            旧胶片颗粒，童年
                                          features sunlit
                            治愈温柔氛围。
                                             walls, casting

========== 主合集 第 191 页 ==========

                                                distinct shadows
                                             of tree branches
                                  and leaves. a
                                          large tree trunk is
                                                visible to the right,
                                          with green foliage.
                                        the lighting is
                                             bright and natural,
                                          creating a warm,
                                                 slightly faded
                                          aesthetic

鱼缸人像倒影                       a full shot of a   运镜：缓慢微推，
                                   young child with a 轻微呼吸晃动复古
                                        pale complexion,                            怀旧胶片电影质
                                      wearing a
                            感，做旧青绿色调                                         transparent
                            色，透明大水缸内                                          fishbowl as a
                                      helmet with white  满群橙红色小金鱼
                                    rounded ear like  自在游动，细碎水
                                           protrusions, a                            泡漂浮水中，男子
                                        white tank top,                            人脸在水缸外虚化
                                  and dark blue
                            倒影在水体里，右                                            shorts. the child
                                      stands with arms  侧露出黑色金属水
                                          outstretched,    管，水面微微晃
                                      mimicking flight.  动，金鱼慢悠悠穿
                                        the background                            梭游动，胶片颗粒
                                          features sunlit
                            质感，朦胧怀旧氛
                                             walls, casting
                            围感。                                                distinct shadows
                                             of tree branches
                                  and leaves. a
                                          large tree trunk is
                                                visible to the right,
                                          with green foliage.
                                        the lighting is
                                             bright and natural,
                                          creating a warm,
                                                 slightly faded
                                            aesthetic.

水中三角梅与金鱼                   a close up, soft   运镜：缓慢横向平
                                          focus, eye level   移复古柔光胶片质
                                        shot of a

========== 主合集 第 192 页 ==========

                                        translucent     感，清水缸里浸泡
                                  aquarium with   着鲜红色三角梅植
                                numerous small                           株，翠绿枝叶舒
                                             fish swimming
                           展，成群橙金金鱼                                   behind bright red
                           绕着花丛穿梭游                                and pink
                                       bougainvillea    动，水体通透带着
                                         flowers. the water  细碎水光，光线柔
                                 has a green tint.                           和漫过花瓣与鱼
                           鳞，金鱼缓缓摆尾
                           游动，朦胧温润的
                           文艺氛围感。

《蓝色大门》影像风格提示词


        图片       图片提示词    视频提示词

                                a medium shot
                                       features two
                                young east asian
                                           individuals, a
                           woman and a
                                man, smiling and
                                        cycling side by
                                      side in a motion
                                       blurred green
                                    outdoor
                                    environment. the
                           woman on the left
                                 wears a white
                                        collared shirt with
                                a dark strap
                                    across her
                                      shoulder, her hair
                                       short and dark.
                                      the man on the
                                             right wears a light
                                     blue collared shirt
                                    over a white
                                         undershirt. both
                                    are actively
                                engaged in

========== 主合集 第 193 页 ==========

cycling, their faces
expressing joy.
the background is
a soft focus
expanse of green
foliage, indicating
speed and
movement. --ar
16:7

a close up, eye
level shot of a
woman with short,
dark brown hair
and fair skin
smiling and
looking slightly to
the right of the
viewer. she is
wearing a white
collared shirt with
a light pink
undershirt. her
teeth are visible
as she smiles
broadly, and her
eyes are dark
brown. the
background is
blurred with bokeh
from light brown
and green trees,
with bright light
flares on the right
and bottom left.
the overall lighting
is warm. --ar 7:3

a close up, motion
blurred outdoor
shot of a young
man with dark,
spiky hair, wearing
a white short
sleeved collared

========== 主合集 第 194 页 ==========

shirt and black
suspenders,
smiling and
looking right with
his mouth open,
as if in mid
conversation,
while moving from
left to right. the
background is a
mix of green and
blue, horizontally
streaked due to
motion blur, with
some indistinct
shapes
suggesting trees
or foliage. the
lighting is bright,
illuminating his
face and shirt. the
composition
focuses on the
upper body and
face of the man,
capturing his
dynamic
movement and
expression. the
image has a
slightly warm tone.
--ar 7:3

an underwater
shot captures a
person with dark
hair submerged in
blue water,
looking directly at
the viewer while
holding a yellow
and blue
waterproof
camera.
numerous small

========== 主合集 第 195 页 ==========

bubbles are
dispersed
throughout the
water, and the
tiled bottom and
side of a
swimming pool
are visible in the
background and
foreground,
respectively. the
person's face is
partially obscured
by the camera,
and their hands
are wrapped
around the device.
--ar 7:3

a close up, eye
level, horizontally
oriented indoor
shot shows a
young woman
resting on a white
pillow, looking to
the right. her dark
hair is splayed
around her face.
she has light skin,
a slightly pink
nose, and pink
cheeks. her right
eye is visible, with
a dark iris and
dark eyelashes.
she wears a dark
red or burgundy
sweater. the
background
consists of a dark
teal wall
transitioning to a
light brown wall. --
ar 7:3

========== 主合集 第 196 页 ==========



#################### 第四部分 【15 种影视视觉风格 AI 提示词模板】 ####################


========== 视觉风格 第 1 页 ==========

     15 种影视视觉风格提示词模板




以下为15 套预设风格的完整参数，全部采用「中文标注+ 英文术语」格式，
可直接嵌入AI 生图/生视频的提示词中使用。



1. 电影质感（Cinematic Film）

摄影机Camera：Panavision Sphero 65 and Hasselblad Lenses

胶片制式Film Stock：Vision3 500T 5219

滤镜Filter：ND0.6, Diffusion Filter 1/4

焦距Focal Length：65mm

光圈Aperture：f/2.0

提示词后缀Prompt Suffix：shot on Panavision Sphero 65 and Hasselblad Lenses, Vision3

500T 5219, ND0.6, Diffusion Filter 1/4, cinematic film grain, shallow depth of field



2. 经典动漫（Anime Classic）

摄影机Camera：Virtual Camera

胶片制式Film Stock：Digital

滤镜Filter：Soft Glow

焦距Focal Length：50mm

光圈Aperture：f/2.8

提示词后缀Prompt Suffix：anime style, cel shading, vibrant colors, soft glow, Studio

Ghibli inspired, hand-drawn aesthetic

========== 视觉风格 第 2 页 ==========

3. 赛博朋克（Cyberpunk Neon）

摄影机Camera：RED Monstro 8K VV

胶片制式Film Stock：Digital S-Log3

滤镜Filter：Pro Mist 1/4, Cyan Gel

焦距Focal Length：35mm

光圈Aperture：f/1.4

提示词后缀Prompt Suffix：shot on RED Monstro 8K VV, cyberpunk neon lighting, Pro

Mist 1/4 filter, high contrast, teal and orange color grading, rain-soaked reflections



4. 邵氏武侠老片（Shaw Brothers Wuxia）

摄影机Camera：Arriflex 35 BL

胶片制式Film Stock：Kodak Eastmancolor 5247

滤镜Filter：Warm 85, 4-point Star Filter

焦距Focal Length：35mm

光圈Aperture：f/2.8

提示词后缀Prompt Suffix：Shaw Brothers wuxia film style, saturated bold colors, hard

studio lighting, rapid zoom cuts, 1970s Hong Kong cinema, dramatic stage lighting,

grainy technicolor look



5. 韩剧氛围（Korean Drama）

摄影机Camera：Sony VENICE 2

胶片制式Film Stock：Digital X-OCN

========== 视觉风格 第 3 页 ==========

滤镜Filter：Soft FX 1/2, Warm 81EF

焦距Focal Length：85mm

光圈Aperture：f/1.8

提示词后缀Prompt Suffix：shot on Sony VENICE 2, Korean drama aesthetic, warm soft

lighting, shallow depth of field, golden hour glow, dreamy bokeh, pastel color palette



6. 暗黑悬疑（Dark Thriller）

摄影机Camera：ARRI ALEXA 65

胶片制式Film Stock：Kodak Vision3 500T 5219

滤镜Filter：ND1.2, Black Pro Mist 1/8

焦距Focal Length：27mm

光圈Aperture：f/2.0

提示词后缀Prompt Suffix：shot on ARRI ALEXA 65, Kodak Vision3 500T, dark thriller

atmosphere, high contrast chiaroscuro lighting, desaturated cold tones, noir shadows,

tension



7. 港风复古（Vintage Hong Kong）

摄影机Camera：Kodak Vision3 500T

镜头Lens：Cooke Anamorphic

胶片制式Film Stock：Kodak Vision3 500T 5219

滤镜Filter：Warm 85, Pro Mist 1/4

焦距Focal Length：50mm

========== 视觉风格 第 4 页 ==========

光圈Aperture：f/2.0

提示词后缀Prompt Suffix：shot on Kodak Vision3 500T, Cooke Anamorphic lens, vintage

Hong Kong cinema style, warm tungsten lighting, film grain, anamorphic lens flare,

nostalgic atmosphere



8. 武侠大片（Wuxia Epic）

摄影机Camera：Panavision Millennium DXL2

胶片制式Film Stock：Kodak Vision3 250D 5207

滤镜Filter：ND0.9, Glimmerglass 1/4

焦距Focal Length：75mm

光圈Aperture：f/2.0

提示词后缀Prompt Suffix：shot on Panavision Millennium DXL2, Kodak Vision3 250D,

wuxia martial arts epic, sweeping landscapes, dramatic overhead crane shots, flowing

fabrics, fog and mist



9. 甜蜜恋爱（Soft Romance）

摄影机Camera：Canon C500 Mark II

胶片制式Film Stock：Canon Cinema RAW Light

滤镜Filter：Soft FX 2, Warm 812

焦距Focal Length：100mm

光圈Aperture：f/1.4

提示词后缀Prompt Suffix：shot on Canon C500 Mark II, romantic soft focus, warm pastel

========== 视觉风格 第 5 页 ==========

tones, dreamy lens flare, cherry blossom petals, gentle backlight, intimate shallow depth

of field



10. 纪实写实（Documentary Real）

摄影机Camera：Sony FX6

胶片制式Film Stock：S-Cinetone

滤镜Filter：UV only

焦距Focal Length：24mm

光圈Aperture：f/4.0

提示词后缀Prompt Suffix：shot on Sony FX6, documentary style, handheld camera,

natural lighting, S-Cinetone color science, realistic skin tones, deep depth of field, raw and

authentic



11. Netflix 剧集质感（Netflix Drama）

摄影机Camera：ARRI ALEXA 35

胶片制式Film Stock：ARRI LogC4

滤镜Filter：ND0.9, Black Satin 1/8

焦距Focal Length：50mm

光圈Aperture：f/2.2

提示词后缀Prompt Suffix：Netflix original drama look, cinematic color grading, natural

skin tones, wide dynamic range, subtle film grain, realistic lighting, modern episodic

aesthetic

========== 视觉风格 第 6 页 ==========

12. 日系治愈胶片（Japanese Film Grain）

摄影机Camera：Panasonic S1H Cinema

胶片制式Film Stock：Fujifilm Pro 400H

滤镜Filter：Soft Focus 1/4, Skylight 1A

焦距Focal Length：35mm

光圈Aperture：f/2.8

提示词后缀Prompt Suffix：Japanese film aesthetic, Fujifilm Pro 400H color science, soft

highlights, low  contrast, muted  green and  cyan  tones,  gentle  film  grain, warm

overexposure edges



13. 变形宽银幕史诗（Anamorphic Epic）

摄影机Camera：Panavision System 65

镜头Lens：Panavision C Series Anamorphic

胶片制式Film Stock：Kodak Vision3 200T 5213

滤镜Filter：ND1.2, Warm 85 Conversion

焦距Focal Length：75mm

光圈Aperture：f/2.8

提示词后缀Prompt Suffix：anamorphic widescreen, horizontal lens flare streaks, oval

bokeh, extreme wide aspect ratio, cinematic scope, heavy film grain, epic blockbuster

scale

========== 视觉风格 第 7 页 ==========

14. 超8 毫米复古（Super 8 Film）

摄影机Camera：Canon Super 8 814 Auto Zoom

胶片制式Film Stock：Kodak Vision3 50D 7203

滤镜Filter：UV Filter, 85C Color Conversion

焦距Focal Length：18mm

光圈Aperture：f/2.8

提示词后缀Prompt Suffix：Super 8mm film aesthetic, prominent grain, slight light leaks,

edge vignetting, shaky handheld cam, vintage home movie texture, warm faded color cast



15. VHS 录像带质感（VHS Retro）

摄影机Camera：Sony Hi8 Handycam CCD-TRV

录制格式Recording Format：VHS Tape S-VHS

滤镜Filter：None

焦距Focal Length：Auto Zoom, 20-80mm

光圈Aperture：f/4.0

提示词后缀Prompt Suffix：VHS tape aesthetic, scan lines, chromatic aberration, color

bleeding,  tape  noise, magnetic dropout  artifacts, 90s  retro camcorder  look,  soft

oversharpened edges

#################### 第五部分 【15 位电影导演调色风格 AI 提示词模板】 ####################


========== 导演调色 第 1 页 ==========

    15 位电影导演调色风格提示词模板




以下为15 套预设风格的完整参数，全部采用「中文标注+ 英文术语」格式，
可直接嵌入AI 生图/生视频的提示词中使用。



1. 罗杰・迪金斯（Roger Deakins）

代表作：《银翼杀手2049》《1917》《老无所依》

核心风格：剪影美学+ 氛围单色，坚持「色彩由光线决定」，极少依赖重度后期调色

视觉特征：善用雾气、烟尘制造体积光；大胆使用单色系（纯橙、冷峻青）；靠细腻的明度

层次让单色不显单调；黑位下沉，画面剪影感极强

调色启示：用反差与pivot 精细控制明暗，不要试图用后期弥补糟糕的前期布光




摄影机Camera：ARRI ALEXA 65

胶片制式Film Stock：Kodak Vision3 500T 5219

滤镜Filter：ND1.2, Black Pro Mist 1/8

焦距Focal Length：40mm

光圈Aperture：f/2.2

提示词后缀  Prompt Suffix ：Roger Deakins cinematography, silhouette aesthetic,

atmospheric monochrome, volumetric fog and smoke, subtle tonal gradations, deep solid

blacks, precise contrast control, natural lighting, fine film grain

========== 导演调色 第 2 页 ==========

2. 王家卫& 杜可风（Wong Kar-wai / Christopher Doyle）

代表作：《重庆森林》《花样年华》《堕落天使》

核心风格：印象派霓虹+ 抽帧拖影的「肮脏浪漫」

视觉特征：低速快门制造时间粘稠感；荧光绿与窗外冷蓝自然混色，不校正偏色；高饱和红

色带有危险气质；象征城市的疏离、湿热与迷乱

调色启示：绿色通道混入少量蓝色，不把所有绿色校正为标准绿；允许高光适度过曝




摄影机Camera：Arriflex 535B

胶片制式Film Stock：Kodak Vision3 500T 5219

滤镜Filter：Pro Mist 1/2, Fluorescent Green Gel

焦距Focal Length：35mm

光圈Aperture：f/1.8

提示词后缀  Prompt  Suffix ：Wong Kar-wai  film  aesthetic,  Christopher Doyle

cinematography, impressionist neon lighting, fluorescent green tint, step-printing motion

blur, humid steamy atmosphere, neon bokeh, overexposed highlights, grainy 35mm film,

dreamlike romantic melancholy



3.大卫・芬奇（David Fincher）

代表作：《七宗罪》《社交网络》《心灵猎人》《消失的爱人》

核心风格：病态黄绿+ 黑暗清晰度（Dark Clarity），用色彩引发生理焦虑

视觉特征：画面无纯白高光，高光统一染成淡黄或淡青；暗部细节丰富但不死黑；低光比下

保留完整暗部层次；冷黄偏色暗示社会病态与道德沦丧

========== 导演调色 第 3 页 ==========

调色启示：严格控制高光滚降，避免刺眼；在阴影中加入极微量青色；不要把暗部完全压死，

保留灰度层次




摄影机Camera：RED Epic-W Helium 8K

胶片制式Film Stock：Digital RED IPP2

滤镜Filter：Black Pro Mist 1/4, Sodium Vapor Gel

焦距Focal Length：50mm

光圈Aperture：f/2.0

提示词后缀Prompt Suffix：David Fincher color grade, sickly yellow-green sodium vapor

tint, dark clarity, rich shadow detail, no pure white highlights, desaturated midtones, cool

cyan shadows, clinical unease, fine grain, muted contrast



4. 韦斯・安德森（Wes Anderson）

代表作：《布达佩斯大饭店》《小行星城》《月升王国》

核心风格：糖果色盘+ 平面柔光的绘本美学，色彩直接承担叙事功能

视觉特征：低饱和马卡龙色系（粉、淡黄、薄荷绿）；低反差、无纯黑，暗部统一提亮染色；

无阴影平面柔光，画面平整如玩具屋；极致对称构图，色彩高度统一

调色启示：用色彩扭曲工具将杂色统一收敛到指定色板；饱和度精准控制，拒绝杂乱色彩；

暗部不要死黑，统一染上主色调




摄影机Camera：Panavision Millennium DXL2

胶片制式Film Stock：Kodak Vision3 200T 5213

========== 导演调色 第 4 页 ==========

滤镜Filter：Soft FX 1, Warm 81EF

焦距Focal Length：40mm

光圈Aperture：f/2.8

提示词后缀  Prompt Suffix ：Wes Anderson aesthetic, pastel macaron color palette,

symmetrical composition, flat soft lighting, storybook whimsy, low contrast, no deep

blacks, muted pink mint and butter yellow, toy house diorama feel



5. 昆汀・塔伦蒂诺& 罗伯特・理查德森（Tarantino / Robert Richardson）

代表作：《杀死比尔》《好莱坞往事》《被解救的姜戈》

核心风格：顶光光晕+ 高饱和原色的B 级片暴力美学

视觉特征：极强顶光在人物头发形成一圈光晕，高光严重溢出；极致鲜艳的血红、明黄原色；

肤色呈古铜油亮质感；复古粗糙的胶片颗粒感，充满剥削电影质感

调色启示：主动允许高光“炸开”，这是风格而非错误；强化红色与黄色的饱和度，保留粗

粝颗粒




摄影机Camera：Panavision System 65

胶片制式Film Stock：Kodak Vision3 500T 5219

滤镜Filter：Warm 85, Black Pro Mist 1/8

焦距Focal Length：50mm

光圈Aperture：f/2.0

提示词后缀Prompt Suffix：Quentin Tarantino style, Robert Richardson cinematography,

top light halo bloom, blown out highlights, saturated primary red and yellow, bronze oily

========== 导演调色 第 5 页 ==========

skin tones, exploitation film grit, heavy film grain, bold violent color contrast



6. 丹尼斯・维伦纽瓦& 格雷格・弗雷泽（Villeneuve / Greig Fraser）

代表作：《沙丘》《新蝙蝠侠》《降临》

核心风格：单色纹理+ 胶片破坏感，靠质感而非色彩表达宏大尺度

视觉特征：减少颜色数量，靠明度层次与质感取胜；通过胶片转录破坏数字画面的洁净感；

单色系深度表达宏大尺度（如沙丘的香料土黄）；画面厚重，触觉感强

调色启示：必须叠加胶片颗粒；做「少色多阶」的单色深化；降低整体饱和度，强化纹理细

节




摄影机Camera：ARRI ALEXA LF

胶片制式Film Stock：Kodak Vision3 250D 5207

滤镜Filter：ND1.8, Classic Soft 1/4

焦距Focal Length：65mm

光圈Aperture：f/2.8

提示词后缀Prompt Suffix：Denis Villeneuve aesthetic, Greig Fraser cinematography,

monochromatic texture, tactile grit, monumental scale, desaturated earth tones, film-out

texture, layered luminance, minimal color palette, heavy film grain



7. 克里斯托弗・诺兰& 霍伊特・范・霍特玛（Nolan / Hoyte van Hoytema）

代表作：《奥本海默》《星际穿越》《敦刻尔克》

核心风格：IMAX 真实主义+ 光化学色彩，拒绝数字重度调色

========== 导演调色 第 6 页 ==========

视觉特征：偏爱深蓝、冷灰与自然肤色，极少用鲜艳红绿；坚持胶片拍摄与光化学配色；黑

白/ 彩色对立构建叙事结构；色彩厚重扎实，富有物理质感

调色启示：尊重肤色自然度；保持黑位纯净，不刻意提亮暗部；用胶片颗粒强化物理真实感




摄影机Camera：IMAX MSM 9802 65mm

胶片制式Film Stock：Kodak Vision3 50D 5203 / Vision3 500T 5219

滤镜Filter：ND2.1, UV Only

焦距Focal Length：80mm

光圈Aperture：f/4.0

提示词后缀  Prompt Suffix ：Christopher Nolan IMAX aesthetic, Hoyte van Hoytema

cinematography, photochemical color grading, grounded realism, deep blues and cool

grays, natural skin tones, solid pure blacks, heavy 65mm film grain, physical tactile

quality



8. 达里奥・阿基多（Dario Argento）

代表作：《阴风阵阵》（1977）《夜深血红》

核心风格：RGB 色片打光+ 铅黄电影噩梦感，用极端色彩制造恐怖童话

视觉特征：用红、绿、蓝色片直接打光，非自然舞台剧布光；红色是绝对主角，象征魔法与

血腥；色彩极度饱和，完全脱离现实；充满迷幻、超现实的恐怖氛围

调色启示：整体旋转色轮制造极端偏色，模拟色片打光效果；保留高饱和原色，不要校正偏

色

========== 导演调色 第 7 页 ==========

摄影机Camera：Technicolor 3-Strip Camera

胶片制式Film Stock：Eastmancolor 5247

滤镜Filter：Red / Green / Blue Color Gels

焦距Focal Length：28mm

光圈Aperture：f/2.0

提示词后缀  Prompt Suffix ：Dario Argento giallo style, RGB gel lighting, technicolor

nightmare, saturated red green blue stage lights, surreal theatrical lighting, dreamlike

horror fairy tale, extreme color contrast, vivid primary hues



9. 艾曼努尔・卢贝兹基（Emmanuel Lubezki / Chivo）

代表作：《荒野猎人》《鸟人》《生命之树》

核心风格：自然广角+ 魔幻时刻自然光，一镜到底的沉浸式真实

视觉特征：全自然光拍摄，大量超广角长镜头；强化自然冷暖对比（雪地冷蓝+ 火光暖橙）；

画面通透锐利，动态范围极大；画面有呼吸感，真实感极强

调色启示：优先保护动态范围；分区曝光确保从高光到暗部都保留细节；不做重度染色，尊

重自然光本色




摄影机Camera：ARRI ALEXA 65

胶片制式Film Stock：Kodak Vision3 500T 5219

滤镜Filter：ND0.6, Circular Polarizer

焦距Focal Length：24mm Wide Angle

光圈Aperture：f/2.2

========== 导演调色 第 8 页 ==========

提示词后缀Prompt Suffix：Emmanuel Lubezki Chivo style, natural golden hour light, wide

angle long take, ultra high dynamic range, immersive realism, warm fire glow against cool

snow/forest, deep depth of field, natural available light



10. 维托里奥・斯托拉罗（Vittorio Storaro）

代表作：《现代启示录》《末代皇帝》

核心风格：光影书写+ 色彩象征主义，色彩如同音符承担叙事

视觉特征：完整的色彩符号系统：红= 鲜血/ 诞生/ 能量，蓝= 理智/ 冷酷/ 死亡，

橙= 家庭/ 温暖；色彩随剧情阶段同步变化；光影戏剧化，如同用笔书写画面

调色启示：调色前先制定「色彩剧本」，随剧情推进改变画面主色调；用强对比光影强化戏

剧感




摄影机Camera：Panavision Panaflex Gold II

胶片制式Film Stock：Kodak Vision3 200T 5213

滤镜Filter：Color Gradient Filters, ND0.9

焦距Focal Length：35mm

光圈Aperture：f/2.0

提示词后缀Prompt Suffix：Vittorio Storaro cinematography, writing with light, symbolic

color  coding,  dramatic  colored  lighting,  color  narrative  progression,  cinematic

chiaroscuro, bold red blue orange symbolism, painterly light and shadow

========== 导演调色 第 9 页 ==========

11. 张艺谋（Zhang Yimou）

代表作：《大红灯笼高高挂》《英雄》《红高粱》

核心风格：极致单色符号美学，用单一主色承载叙事情绪，高饱和强视觉冲击，东方写意光

影

视觉特征：固定主色铺满画面（红/ 金/ 黑白），明暗极端对比，大面积色块构图；灯笼、

绸缎、竹林等东方符号；高光浓烈通透，暗部干净不发灰；兼具油画厚重与水墨留白

调色启示：锁定单一主色拉高饱和度，其余色彩大幅降灰；明暗拉开强反差，高光不溢出，

暗部保留微弱层次




摄影机Camera：ARRI ALEXA 65

胶片制式Film Stock：Kodak Vision3 250D

滤镜Filter：Warm 85，Soft 1/4

焦距Focal Length：50mm

光圈Aperture：f/2.0

提示词后缀Prompt Suffix：Zhang Yimou cinematography, dominant saturated single

color  palette, oriental symbolic aesthetics, dramatic high contrast, Chinese  classical

architecture, ink wash composition, thick oil painting texture, vivid lantern red or imperial

gold tone, sharp clean shadows, epic grand framing



12. 李安（Ang Lee）

代表作：《卧虎藏龙》《断背山》《少年派》

核心风格：东西方柔和色彩融合，温润低反差，自然光诗意氛围感

========== 导演调色 第 10 页 ==========

视觉特征：低对比柔和光影，绿色/ 暖棕为主调；东方山水朦胧雾感、西部旷野暖金；肤

色通透温润，无生硬明暗；冷暖缓慢过渡，无强烈色彩冲突

调色启示：降低全局对比度，高光柔滚，阴影提亮加浅绿/ 暖棕；避免极端色，色彩过渡

平缓自然




摄影机Camera：Sony VENICE 2

胶片制式Film Stock：ARRI LogC

滤镜Filter：Soft FX 1/2，Skylight 1A

焦距Focal Length：80mm

光圈Aperture：f/1.8

提示词后缀Prompt Suffix：Ang Lee aesthetic, east-west blended soft color grading, gentle

low contrast, misty natural volumetric  light, muted emerald and warm ochre tones,

creamy natural skin, dreamy haze, poetic tranquil atmosphere, wide natural landscape

framing



13. 是枝裕和（Hirokazu Kore-eda）

代表作：《小偷家族》《海街日记》

核心风格：日系低饱和日常纪实，柔和暖灰，生活化平淡治愈

视觉特征：低饱和度、低反差，阳光暖米底色；绿植浅青、木调暖棕；无硬阴影，柔光漫射；

画面充满烟火细碎质感，无戏剧化浓烈色彩

调色启示：全画面降饱和，阴影加入浅米色，高光轻微暖化，杜绝高对比滤镜

========== 导演调色 第 11 页 ==========

摄影机Camera：Panasonic S1H

胶片制式Film Stock：Fujifilm Pro 400H

滤镜Filter：UV Only，Soft Glow 1/4

焦距Focal Length：35mm

光圈Aperture：f/2.8

提示词后缀Prompt Suffix：Hirokazu Kore-eda domestic documentary style, desaturated

warm beige base, soft diffused natural daylight, muted mint green and wood brown tones,

no harsh shadows, gentle grain, quiet healing daily atmosphere, shallow soft bokeh



14. 北野武（Takeshi Kitano / Kitano Blue）

代表作：《奏鸣曲》《花火》

核心风格：标志性北野蓝，冷调疏离，暴力与温柔色彩对冲

视觉特征：全片笼罩钴青冷蓝，阴天/ 海面冷色基底；暴力镜头冷灰，温情段落微弱暖橙

点缀；固定长镜头，低饱和，画面空旷留白

调色启示：阴影、中间调统一推入钴蓝色，仅高光少量暖中和，大幅降低整体饱和度




摄影机Camera：Arriflex 35

胶片制式Film Stock：Fujifilm Eterna

滤镜Filter：Cyan Color Compensate Filter

焦距Focal Length：40mm

光圈Aperture：f/2.2

提示词后缀Prompt Suffix：Takeshi Kitano Kitano Blue cinematography, pervasive cool

========== 导演调色 第 12 页 ==========

cobalt cyan tint, desaturated cold palette, empty minimalist framing, subtle warm orange

highlight contrast, overcast seaside atmosphere, static long take, quiet violent melancholy



15. 盖・里奇（Guy Ritchie）

代表作《两杆大烟枪》《绅士们》

核心风格：复古暖棕英伦胶片，高颗粒，明暗细碎对比

视觉特征：90 年代胶片质感，暖棕土黄基底；局部硬光影分割，暗部细碎颗粒；低饱和复

古配色，街头复古软装，人物高对比轮廓

调色启示：全局加暖黄底色，黑位轻微抬高，增加粗胶片颗粒，局部加深明暗反差




摄影机Camera：Panavision C Series

胶片制式Film Stock：Kodak Vision3 500T

滤镜Filter：Warm 81EF，Black Pro Mist 1/8

焦距Focal Length：32mm

光圈Aperture：f/2.0

提示词后缀Prompt Suffix：Guy Ritchie British gangster film, vintage warm sepia brown

palette, heavy coarse film grain, fragmented hard chiaroscuro, 90s London retro texture,

desaturated earth tones, sharp character silhouette, gritty street atmosphere