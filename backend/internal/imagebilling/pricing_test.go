package imagebilling

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func officialPricing() *model.ImagePricing {
	return &model.ImagePricing{InputPriceMicrocredits: 50_000, OutputTiers: []model.ImagePriceTier{{MaxPixels: 2_610_000, UnitPriceMicrocredits: 130_000}, {MaxPixels: 4_630_000, UnitPriceMicrocredits: 230_000}}}
}

func TestImageBillingPixelBoundaryAndMixedOutputs(t *testing.T) {
	for _, tc := range []struct {
		name                string
		width, height, want int64
	}{
		{"below", 1740, 1499, 180_000}, {"inclusive", 1740, 1500, 180_000}, {"above", 1740, 1501, 280_000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			amount, err := Amount(officialPricing(), &model.ImageBillingUsage{InputImages: 1, Outputs: []model.ImageOutputUsage{{Width: tc.width, Height: tc.height}}}, 10_000)
			if err != nil || amount != tc.want {
				t.Fatalf("amount=%d err=%v want=%d", amount, err, tc.want)
			}
		})
	}
	usage := &model.ImageBillingUsage{InputImages: 1, Outputs: []model.ImageOutputUsage{{Index: 0, Width: 2048, Height: 2048}, {Index: 1, Width: 2048, Height: 2048}, {Index: 2, Width: 1024, Height: 1024}, {Index: 3, Width: 1024, Height: 1024}, {Index: 4, Width: 1024, Height: 1024}}}
	amount, err := Amount(officialPricing(), usage, 10_000)
	if err != nil || amount != 900_000 {
		t.Fatalf("mixed amount=%d err=%v", amount, err)
	}
	hold, err := Reserve(officialPricing(), 1, 10, 10_000)
	if err != nil || hold != 2_350_000 {
		t.Fatalf("hold=%d err=%v", hold, err)
	}
}

func TestImageBillingRejectsMissingDimensionsAndOverlappingRules(t *testing.T) {
	if _, err := Amount(officialPricing(), &model.ImageBillingUsage{Outputs: []model.ImageOutputUsage{{}}}, 10_000); err == nil {
		t.Fatal("missing dimensions accepted")
	}
	if _, err := Amount(officialPricing(), &model.ImageBillingUsage{Outputs: []model.ImageOutputUsage{{Width: 4096, Height: 4096}}}, 10_000); err == nil {
		t.Fatal("out-of-range pixels accepted")
	}
	p := officialPricing()
	p.OutputTiers[1].MaxPixels = p.OutputTiers[0].MaxPixels
	if Validate(p) == nil {
		t.Fatal("duplicate pixel boundary accepted")
	}
	if _, err := Reserve(officialPricing(), -1, 1, 10_000); err == nil {
		t.Fatal("negative count accepted")
	}
}

func TestImageBillingFlatPriceFreeInputsAndSingleRounding(t *testing.T) {
	p := &model.ImagePricing{InputPriceMicrocredits: 1, FreeInputImages: 1, OutputTiers: []model.ImagePriceTier{{UnitPriceMicrocredits: 1}}}
	amount, err := Amount(p, &model.ImageBillingUsage{InputImages: 2, Outputs: []model.ImageOutputUsage{{Index: 0}, {Index: 1}}}, 3333)
	if err != nil || amount != 1 {
		t.Fatalf("round once amount=%d err=%v", amount, err)
	}
	original := officialPricing()
	converted, err := MapPrices(original, func(v int64) (int64, error) { return v * 2, nil })
	if err != nil || converted.InputPriceMicrocredits != 100_000 || converted.OutputTiers[0].UnitPriceMicrocredits != 260_000 || original.OutputTiers[0].UnitPriceMicrocredits != 130_000 {
		t.Fatalf("conversion=%#v err=%v", converted, err)
	}
}

func TestImageBillingMissingPriceIsNotFree(t *testing.T) {
	var pricing model.ImagePricing
	if err := json.Unmarshal([]byte(`{"freeInputImages":0,"outputTiers":[{"maxPixels":0,"unitPriceMicrocredits":0}]}`), &pricing); err == nil {
		t.Fatal("omitted input price became free")
	}
	if err := json.Unmarshal([]byte(`{"inputPriceMicrocredits":0,"freeInputImages":0,"outputTiers":[{"maxPixels":0,"unitPriceMicrocredits":0}]}`), &pricing); err != nil {
		t.Fatal(err)
	}
	amount, err := Amount(&pricing, &model.ImageBillingUsage{Outputs: []model.ImageOutputUsage{{}}}, 10_000)
	if err != nil || amount != 0 {
		t.Fatalf("explicit free=%d err=%v", amount, err)
	}
}
