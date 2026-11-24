package model

import (
	"encoding/json"
	"errors"
)

// ImagePricing uses the owning model's currency; order snapshots use microcredits.
type ImagePricing struct {
	InputPriceMicrocredits int64            `json:"inputPriceMicrocredits"`
	FreeInputImages        int64            `json:"freeInputImages"`
	OutputTiers            []ImagePriceTier `json:"outputTiers"`
}

// Missing prices must not silently become explicit free prices on write paths.
func (p *ImagePricing) UnmarshalJSON(raw []byte) error {
	type pricing ImagePricing
	var required struct {
		Input *int64 `json:"inputPriceMicrocredits"`
		Free  *int64 `json:"freeInputImages"`
		Tiers []struct {
			Max   *int64 `json:"maxPixels"`
			Price *int64 `json:"unitPriceMicrocredits"`
		} `json:"outputTiers"`
	}
	if err := json.Unmarshal(raw, &required); err != nil {
		return err
	}
	if required.Input == nil || required.Free == nil || len(required.Tiers) == 0 {
		return errors.New("图片输入价、免费张数和输出档位必须明确填写")
	}
	for _, tier := range required.Tiers {
		if tier.Max == nil || tier.Price == nil {
			return errors.New("图片输出像素上限和价格必须明确填写")
		}
	}
	return json.Unmarshal(raw, (*pricing)(p))
}

type ImagePriceTier struct {
	// MaxPixels is inclusive. Zero means an unlimited final tier.
	MaxPixels             int64 `json:"maxPixels"`
	UnitPriceMicrocredits int64 `json:"unitPriceMicrocredits"`
}

type ImageOutputUsage struct {
	Index  int   `json:"index"`
	Width  int64 `json:"width"`
	Height int64 `json:"height"`
}

type ImageBillingUsage struct {
	InputImages int64              `json:"inputImages"`
	Outputs     []ImageOutputUsage `json:"outputs"`
	Source      string             `json:"source"`
}
