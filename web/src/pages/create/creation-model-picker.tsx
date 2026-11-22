import { ModelPicker } from "@/components/model-picker";
import type { ModelRequirements } from "@/lib/model-selection";
import type { AiConfig } from "@/stores/use-config-store";
import { modeLabels, type CreationMode } from "./creation-types";

interface CreationModelPickerProps {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    mode: CreationMode;
    requirements?: ModelRequirements;
    fullWidth?: boolean;
    popoverClassName?: string;
    placeholder?: string;
}

export function CreationModelPicker({ config, value, onChange, mode, requirements, fullWidth, popoverClassName, placeholder }: CreationModelPickerProps) {
    return (
        <ModelPicker
            config={config}
            value={value}
            onChange={onChange}
            capability={mode}
            requirements={requirements}
            className="creation-model-picker"
            fullWidth={fullWidth}
            popoverClassName={popoverClassName}
            placeholder={placeholder ?? `选择${modeLabels[mode]}模型`}
            showSelectedPrice={false}
            showOptionPrices
            variant="creation"
        />
    );
}
