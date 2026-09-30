// 逻辑模型的产品规格覆盖校验：前台逻辑模型承诺的能力（输入、选项、取值范围）
// 必须被至少一条可用路由覆盖，否则保存时拒绝，避免用户选了一个实际无法执行的规格。

package app

import (
	"math"
)

// 前台模型只声明供应线路真实提供的总目录；组合是否可承接仍由匿名 capabilityProfiles 按 OR 语义判断。
func validateProductSpecWithinRoutes(product CapabilitySpec, routeSpecs []CapabilitySpec) error {
	for _, routeSpec := range routeSpecs {
		if normalizeCapability(routeSpec.Capability) != normalizeCapability(product.Capability) {
			return BadAuthRequest("供应线路能力类型与前台模型不一致")
		}
	}
	if len(product.Operations) == 0 {
		unrestricted := false
		for _, routeSpec := range routeSpecs {
			if len(routeSpec.Operations) == 0 {
				unrestricted = true
				break
			}
		}
		if !unrestricted {
			return BadAuthRequest("创作端生成方式必须从供应线路支持的选项中选择")
		}
	} else {
		for _, operation := range product.Operations {
			supported := false
			for _, routeSpec := range routeSpecs {
				if len(routeSpec.Operations) == 0 || containsCapabilityString(routeSpec.Operations, operation) {
					supported = true
					break
				}
			}
			if !supported {
				return BadAuthRequest("创作端生成方式不受任何供应线路支持：" + operation)
			}
		}
	}
	for name, constraint := range product.Inputs {
		if !inputConstraintCovered(constraint, name, routeSpecs) {
			return BadAuthRequest("创作端输入范围超出供应线路能力：" + name)
		}
	}
	for name, constraint := range product.Options {
		if !optionConstraintCovered(constraint, name, routeSpecs) {
			return BadAuthRequest("创作端参数超出供应线路能力：" + name)
		}
	}
	return nil
}

func inputConstraintCovered(candidate InputConstraint, name string, routeSpecs []CapabilitySpec) bool {
	next := candidate.Min
	for next <= candidate.Max {
		coveredUntil := next - 1
		for _, routeSpec := range routeSpecs {
			constraint, exists := routeSpec.Inputs[name]
			if !exists {
				constraint = InputConstraint{Min: 0, Max: 0}
			}
			if constraint.Min <= next && constraint.Max >= next && constraint.Max > coveredUntil {
				coveredUntil = constraint.Max
			}
		}
		if coveredUntil < next {
			return false
		}
		next = coveredUntil + 1
	}
	return true
}

func optionConstraintCovered(candidate OptionConstraint, name string, routeSpecs []CapabilitySpec) bool {
	routeConstraints := make([]OptionConstraint, 0, len(routeSpecs))
	for _, routeSpec := range routeSpecs {
		if constraint, exists := routeSpec.Options[name]; exists {
			routeConstraints = append(routeConstraints, constraint)
		}
	}
	if len(routeConstraints) == 0 {
		return false
	}
	for _, routeConstraint := range routeConstraints {
		if isWildcardOptionConstraint(routeConstraint) {
			return true
		}
	}
	if len(candidate.Values) > 0 {
		for _, value := range candidate.Values {
			if !optionValueSupported(name, value, routeConstraints) {
				return false
			}
		}
		return true
	}
	if candidate.Min == nil || candidate.Max == nil {
		return false
	}
	if math.Abs(*candidate.Max-*candidate.Min) < 1e-9 {
		return optionValueSupported(name, *candidate.Min, routeConstraints)
	}
	if candidate.Step == nil {
		return continuousOptionRangeCovered(*candidate.Min, *candidate.Max, routeConstraints)
	}
	step := *candidate.Step
	count := int(math.Floor((*candidate.Max-*candidate.Min)/step+1e-9)) + 1
	if count <= 10000 {
		for index := 0; index < count; index++ {
			value := *candidate.Min + float64(index)*step
			if !optionValueSupported(name, value, routeConstraints) {
				return false
			}
		}
		return true
	}
	// 超大离散范围不逐点展开；只有单条连续范围或步长完全兼容的线路才能作为可靠来源。
	for _, routeConstraint := range routeConstraints {
		if routeConstraint.Min == nil || routeConstraint.Max == nil || *routeConstraint.Min > *candidate.Min || *routeConstraint.Max < *candidate.Max {
			continue
		}
		if routeConstraint.Step == nil {
			return true
		}
		startSteps := (*candidate.Min - *routeConstraint.Min) / *routeConstraint.Step
		stepRatio := step / *routeConstraint.Step
		if math.Abs(startSteps-math.Round(startSteps)) < 1e-9 && math.Abs(stepRatio-math.Round(stepRatio)) < 1e-9 {
			return true
		}
	}
	return false
}

func optionValueSupported(name string, value any, constraints []OptionConstraint) bool {
	for _, constraint := range constraints {
		if isWildcardOptionConstraint(constraint) {
			return true
		}
		if matchOptionConstraint(name, constraint, value) {
			return true
		}
	}
	return false
}

func isWildcardOptionConstraint(constraint OptionConstraint) bool {
	for _, value := range constraint.Values {
		if normalizedScalar(value) == "*" {
			return true
		}
	}
	return false
}

func continuousOptionRangeCovered(minimum float64, maximum float64, constraints []OptionConstraint) bool {
	next := minimum
	for next <= maximum+1e-9 {
		coveredUntil := next
		advanced := false
		for _, constraint := range constraints {
			if constraint.Min == nil || constraint.Max == nil || constraint.Step != nil {
				continue
			}
			if *constraint.Min <= next+1e-9 && *constraint.Max >= next-1e-9 && *constraint.Max > coveredUntil {
				coveredUntil = *constraint.Max
				advanced = true
			}
		}
		if coveredUntil >= maximum-1e-9 {
			return true
		}
		if !advanced {
			return false
		}
		next = coveredUntil
	}
	return true
}

func anyValues(values []string) OptionConstraint {
	result := make([]any, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return OptionConstraint{Values: result}
}

func boolValues(supportsTrue bool) OptionConstraint {
	values := []any{false}
	if supportsTrue {
		values = append(values, true)
	}
	return OptionConstraint{Values: values}
}

func numericRange(minimum float64, maximum float64, step float64) OptionConstraint {
	return OptionConstraint{Min: &minimum, Max: &maximum, Step: &step}
}
