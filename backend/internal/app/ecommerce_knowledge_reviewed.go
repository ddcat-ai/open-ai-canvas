package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"

	"yingce/backend/internal/model"
)

// These are reviewed excerpts, not executable skills or verified platform policy.
// Both the pinned source commit and exact document hash must match before approval.
type commerceReviewedExcerpt struct {
	Digest, Title, Guidance string
}

var commerceReviewedExcerpts = map[string]commerceReviewedExcerpt{
	"shadcn-design-tokens/apps/v4/content/docs/(root)/theming.mdx": {
		"403a71fea629dd9d5eebdf3656baab6b8550972adfb4fc5ed0847d13b3dc73f0",
		"商品图 UI 组件的语义色与层级规则",
		"把视觉组件按商品、背景、信息面板、文字和强调元素分成独立语义层，再为选定风格定义主色、辅助色、边框、圆角、文字对比与阴影。磨砂玻璃卡采用克制透明度、可见细边、柔和背景模糊和足够文字对比；科技产品可用细线与深色参数卡，清新生活可用浅色柔边卡，杂志风可用网格与低装饰信息块，潮流风可用偏轴标签。组件只承载已确认的参数与可见细节，不能把装饰图标误读成产品功能。每一张根据阅读任务改变信息卡的数量与位置，整套共享语义色和字体层级，避免把同一张 UI 模板贴到全部画面。仅提炼开源主题变量方法，不复制上游界面代码或示例品牌。",
	},
	"image-style-craft/skills/image-generation/references/prompt-crafting.md": {
		"4a5b585814010ed7954f9ee6596e22973d52640e485ff31e51c1ee665f19cc34",
		"商品类别驱动的摄影风格与提示词结构",
		"先根据当前商品类别、可见外观和投放用途选定摄影语言，再组合场景、镜头、构图、主辅色、布光、情绪与版式。棚拍适合轮廓和白底保真；自然窗光适合家居与日常使用；编辑式构图适合穿搭和品牌叙事；低调侧光或霓虹节奏适合数码产品，但不得遮蔽商品细节。每个方向都写出可执行的画面动作和与之匹配的短文案语气，四个方向应在镜头、节奏与信息目的上有明显差异。仅迁移风格方法，不照搬示例品牌、人物、商品事实或未经证实的功效。",
	},
	"creative-photo-prompts/prompts/product-photography.md": {
		"c02cc17a5a17cba6405dfd61e491a5ddbd075c66b0445c43c3aa0c75d3ed44d9",
		"商品摄影的光线、机位与系列视觉变化",
		"以商品图为外观依据，先确定每张的商业目的，再选择棚拍、自然窗光、侧逆光、微距或真实使用场景。通过镜头远近、主体位置、负空间、前后层次和背景材质制造变化，系列共享色板与光线逻辑。白底图必须保持纯白，不把环境、装饰或未确认材质带入。只有产品图确实可见的结构才能做局部特写；模特使用应保持商品接触关系和比例真实。摄影提示词写清主体、场景、构图、光线、色彩与禁止项，不复制示例商品或品牌。",
	},
	"creative-photo-prompts/prompts/poster-design.md": {
		"078f356f93fe3fe42b5712a1652e3afc9157fa6b66da61d8dfeaabe0723989d6",
		"营销海报视觉层级与多风格版式",
		"先按目标平台和比例建立标题、商品、辅助信息三级阅读顺序。海报可采用编辑式大字、现代网格、拼贴、几何色块、电影式光影或柔和生活方式；每种风格须同步调整标题语气、留白、装饰密度与镜头，而不是只换背景颜色。保留商品安全区，手机端标题清晰，装饰不得误认成商品功能。价格、折扣、时间、销量和承诺只在用户提供时出现。",
	},
	"visual-copywriting/SKILL.md": {
		"ae3a5c05c07b0ef5e7581dcf79d99040d36ee2fc33f9109b11f1d2d0c49b48d0",
		"电商视觉文案的场景、利益与证据层级",
		"先区分商品可见特征、用户明确确认的规格与未知信息。每张确定一个读者问题或使用情境，以短标题传达感受或可见差异，副文案解释场景关系，证据位只放已确认事实。套图轮换情境开场、局部观察、使用动作与信息收束，避免每张复述同一口号。根据风格调整文字节奏：潮流短促、治愈温和、科技精确、编辑式有观察感。不得把示例里的功效、参数、价格或平台规则当成当前商品事实。",
	},
	"visual-copywriting/references/platform-playbooks.md": {
		"da06b6fd55b80941dd519e2950e1d2c3fe1c0d5d484d7fb8d3ed577be564bed3",
		"平台场景下的文案密度与首屏识别",
		"为移动端信息流优先安排可瞬间辨认的商品与一句清晰标题；商品详情页逐屏展开，同一主题下切换镜头和信息密度；独立站可使用更多留白与品牌故事。平台名称只影响创作形式，不自动赋予尺寸、审核、禁词或合规规则；具体要求仍应依据用户提供的官方资料。中文文案避免空泛形容词堆砌，英文文案优先自然表达，不做逐字硬译。",
	},
	"reference-image-analysis/README.md": {
		"50c75aebdc169de001df03e6544906eac05efd8851dec9eb8e03f60819161b8b",
		"参考图分层拆解与原创迁移",
		"将参考图拆成商品主体、镜头、空间、光线、色板、版式、字体气质和文案语气，逐项描述可观察的设计语言。长图按段落顺序识别节奏与信息层级，再映射到当前商品的真实资料。参考图中其他品牌的 Logo、商品、人物肖像、具体文案和未确认卖点不迁移；当商品图与风格图冲突时，以商品图决定外观，以参考图指导氛围。",
	},
	"copywriting-methods/SKILL.md": {
		"c56659e7e2979bcdbfaff8db521217940794d12406954e510be4e517be5addd9",
		"差异化标题与可信商业叙事",
		"围绕受众、具体场景、可观察变化和行动意图构思多条标题，再选与图片风格相符的一条。可用问题、对比、微叙事、动作或感官观察建立变化，但对比和效果必须有证据；不虚构用户评价、排名、限时优惠或绝对化结论。图文要互补：画面展示商品，文字补足使用情境或已证实信息；连续图片的标题在语义和句式上都应变化。",
	},
	"buluslan-image2-ecommerce/SKILL.md": {
		"a6f565019be50d57b62cbc2b5a4021ab297ecee4907ad22fa015cd778f02f6e0",
		"套图风格锁定与图像提示词五要素",
		"套图先固定视觉方向、色板、冷暖、字体、背景、光线、布局、图标和产品呈现。各张只改变画面目的、动作、局部构图与短文案，避免每张变成不同品牌。图像策划分别描述场景、商品主体、重要细节、用途和约束。参考图逐张标注角色并保留 Logo、颜色、形状和纹理。文案复杂或直接生字失败时可用干净底图再排文字。仅采用这些视觉方法，不采用来源的指定模型、第三方接口、费用或未核实平台阈值。",
	},
	"motiful-product-shots/skills/product-shots-ad-creative/references/composition-patterns.md": {
		"7d8c0ab6e8287fc55a2b0a1aaa46a3934836cce7dd0c6f16a305cf91c9dbbf82",
		"按素材与信息目的选择商品构图",
		"构图需结合行业、画面用途与已有素材。商品主视觉突出单一清晰主体；生活方式以商品与真实环境的关系叙事；人物与产品构图让二者位置有主次；俯拍适合真实多件商品陈列；多图叙事每张有一个独立焦点。促销、评论、对比或前后效果构图只有在用户提供真实依据时可用，不能为了套模板制造数据、评价或效果。此条提炼构图方法，不将原文平台建议作为官方规则。",
	},
	"motiful-product-shots/skills/product-shots-ad-creative/references/workflow-and-self-check.md": {
		"2066cb900da6cb7500cc5209f8849e520f3cd1c57c9d8d38c2e2818acf1b1c66",
		"商品视觉工作流与交付检查维度",
		"策划依次明确用途与平台、商品行业与品牌约束、可用素材、构图与色彩，再检查成品。已有品牌色、字体与 Logo 应优先于行业默认。交付检查包括实际尺寸、内容安全边距、单一主要焦点、手机可读性、品牌一致性和已确认文案是否保留。可程序测量的尺寸与需要视觉判断的焦点、保真、可读性应分别报告；检查建议本身不证明图片通过。原文的广告统计、平台阈值与自动无限重生要求不纳入本条。",
	},
	"xianyu-image-skills/skills/selling-point-infographic/SKILL.md": {
		"75635b58334c9433e31d3c288a3ab9ef7d1fad6056b4311944bbfe4db85f263f",
		"真实卖点信息图与移动端排版",
		"先锁定产品形状、比例、颜色、Logo、印字、接口、部件和包含的配件；未知尺寸、材质、容量或认证留空。每张信息图围绕一个经过确认的卖点，用短标题与不超过三项的说明建立阅读顺序。可选商品与右侧信息行、细节引线或真实规格的数字主视觉，不能把示例中的数字当作商品事实。字体、对比、留白服务于手机阅读；错字应单图修复或改用后期排字。文案只使用用户提供的证据，外部接口和模型建议不纳入知识。",
	},
	"xianyu-image-skills/skills/multi-angle-set/SKILL.md": {
		"8988794d73e6ffa62972bfe661d5167518ff37f50dde4287c72f75788583dbad",
		"多角度商品摄影的一致性与真实边界",
		"同一商品多视角共享背景、布光、色温和外观锁定；各图改变有证据支持的机位，如正面、四分之三视角、可见侧面与局部微距。使用用户提供的真实角度资料，不能仅由正面图推测背面、内部结构或隐藏接口。Logo 与印字保持在原有表面，不能为让镜头看见而移动。多图共用相同比例与中性颜色还原，并逐张核对轮廓、颜色和细节。仅提炼摄影方法，不导入来源的生成脚本、付费渠道或默认供应商。",
	},
}

func commerceApplyReviewedExcerpt(entry *model.EcommerceKnowledgeEntry, source commerceSourceSpec, path string, data []byte) bool {
	excerpt, ok := commerceReviewedExcerpts[source.ID+"/"+path]
	digest := sha256.Sum256(data)
	if !ok || hex.EncodeToString(digest[:]) != excerpt.Digest {
		return false
	}
	reviewed := commerceEntry(source, path, excerpt.Title, entry.KnowledgeType, entry.Category, "", excerpt.Guidance)
	content, _ := json.Marshal(map[string]string{"guidance": excerpt.Guidance, "upstreamSha256": excerpt.Digest, "reviewScope": "visual_guidance_only; excludes scripts, providers, unverified platform policy and commercial claims"})
	reviewed.ContentJSON = string(content)
	reviewed.ReviewStatus = "approved"
	reviewed.TrustLevel = "reviewed_community"
	now := time.Now().UTC()
	reviewed.VerifiedAt = &now
	*entry = reviewed
	return true
}
