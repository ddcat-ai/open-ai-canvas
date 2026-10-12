package app

import "strings"

const cloudAgentMediaModelListHint = "优先使用本回合已有 model_list 结果；只有 mode、referenceNodeIds 或模型选择发生变化时才重新查询；没有匹配项时向用户说明，不重复读取同一目录"

// 模型能力校验（model_capability_validate.go）拒绝的生成参数属于「模型填错了参数」，
// 不是模型、权限或预算问题。此前它们和其它准入失败一样被包成不可重试的
// media_admission_failed：工具结果只有一句「工具执行失败」，整轮直接终止，
// 模型既不知道错在哪个参数，也没有机会改正；用户要求重试时它只能原样再错一次。
//
// 这里把这类错误改报为字段级参数错误：结果里带着具体原因和取值来源，
// 走已有的 fix_arguments 纠正通道（次数仍受 cloudAgentToolAttemptLimit 限制），
// 没有任何任务被提交，也不会产生费用。
var cloudAgentMediaCapabilityArgumentHints = []struct {
	marker string
	field  string
	hint   string
}{
	{"图片尺寸不在当前模型支持范围内", "size", "size 必须取 model_list 返回的该模型 options.image.size.values 中的一个值（通常是像素尺寸，例如 1536x2752），不要写 9:16 这样的比例"},
	{"图片尺寸宽高必须是 16 的倍数", "size", "size 必须使用宽x高，并且宽高都必须是 16 的倍数"},
	{"图片尺寸最长边不能超过", "size", "size 的最长边不能超过当前模型允许的上限"},
	{"图片宽高比不能超过", "size", "size 的宽高比必须落在当前模型允许的范围内"},
	{"图片总像素需在", "size", "size 的总像素必须落在当前模型允许的范围内"},
	{"当前分辨率不支持所选图片宽高比", "size", "所选 quality 档位下没有这个宽高比；按 model_list 返回的该模型 options.image.size.presets 选一组匹配的比例与分辨率"},
	{"图片质量不在当前模型支持范围内", "quality", "quality 必须取 model_list 返回的该模型 options.image.quality.values 中的一个值，或省略"},
	{"当前图片模型最多支持", "logicalModelId", cloudAgentMediaModelListHint},
	{"参考图片文件超过当前模型大小限制", "logicalModelId", cloudAgentMediaModelListHint},
	{"当前图片模型不支持蒙版编辑", "logicalModelId", cloudAgentMediaModelListHint},
	{"视频时长不在当前模型支持范围内", "durationSeconds", "durationSeconds 必须落在 model_list 返回的该模型 options.video.duration 给出的范围或固定值内"},
	{"画面比例不在当前模型支持范围内", "size", "视频的 size 必须取 model_list 返回的该模型 options.video.ratios 中的一个比例"},
	{"输出分辨率不在当前模型支持范围内", "quality", "视频的 quality 必须取 model_list 返回的该模型 options.video.resolutions 中的一个值，大小写保持一致"},
	{"参考素材数量超过当前模型限制", "logicalModelId", cloudAgentMediaModelListHint},
	{"当前视频模型至少需要", "logicalModelId", cloudAgentMediaModelListHint},
	{"参考视频文件超过当前模型大小限制", "logicalModelId", cloudAgentMediaModelListHint},
	{"参考音频文件超过当前模型大小限制", "logicalModelId", cloudAgentMediaModelListHint},
	{"参考视频时长超过当前模型限制", "logicalModelId", cloudAgentMediaModelListHint},
	{"参考音频时长超过当前模型限制", "logicalModelId", cloudAgentMediaModelListHint},
	{"火山方舟全模态参考不支持纯音频或文本+音频", "logicalModelId", cloudAgentMediaModelListHint},
	{"当前视频模型不支持该生成模式", "logicalModelId", cloudAgentMediaModelListHint},
}

// cloudAgentMediaCapabilityArgumentError 识别能力校验错误并转成可纠正的参数错误；
// 其它错误返回 nil，由调用方按原口径处理。
func cloudAgentMediaCapabilityArgumentError(err error) error {
	if err == nil {
		return nil
	}
	message := err.Error()
	for _, item := range cloudAgentMediaCapabilityArgumentHints {
		if strings.Contains(message, item.marker) {
			return cloudAgentFieldError(item.field, "unsupported_value", item.marker+"；"+item.hint+"。未提交生成任务，改正后可直接重新调用")
		}
	}
	return nil
}
