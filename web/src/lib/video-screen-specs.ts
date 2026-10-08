import type { VideoCapabilityConfig, VideoScreenSpecConfig } from "./model-capabilities";
import type { ModelProtocolWorkflow } from "./model-protocols";

export function cleanVideoScreenSpecValues(values: readonly string[]) {
    const seen = new Set<string>();
    return values
        .map((value) => value.trim())
        .filter((value) => {
            const key = value.toLowerCase();
            if (!value || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

export function workflowVideoScreenSpec(workflow: ModelProtocolWorkflow): VideoScreenSpecConfig {
    const resolution = workflow.parameters.find((field) => field.mapping === "resolution" || field.name === "resolution");
    return {
        ratios: [],
        defaultRatio: "",
        resolutions: cleanVideoScreenSpecValues(resolution?.values || []),
        defaultResolution: String(resolution ? workflow.defaults?.[resolution.name] || "" : "").trim(),
    };
}

export function resolveWorkflowVideoScreenSpec(profile: VideoCapabilityConfig, workflow?: ModelProtocolWorkflow): VideoCapabilityConfig {
    const fixed = workflow ? workflowVideoScreenSpec(workflow) : profile.fixedScreenSpec;
    if (!fixed) return profile;
    const previous = profile.fixedScreenSpec;
    const workflowChanged = workflow && previous && (previous.defaultResolution !== fixed.defaultResolution || previous.resolutions.length !== fixed.resolutions.length || previous.resolutions.some((value, index) => value !== fixed.resolutions[index]));
    const initializing = workflow && !profile.fixedScreenSpec;
    const available = new Map(fixed.resolutions.map((value) => [value.toLowerCase(), value]));
    const configured = cleanVideoScreenSpecValues(profile.resolutions).map((value) => available.get(value.toLowerCase()) || value);
    const initialValues = configured.filter((value) => available.has(value.toLowerCase()));
    const source = workflowChanged || (initializing && !initialValues.length) ? fixed : profile;
    const resolutions = source === fixed ? fixed.resolutions : initializing ? initialValues : configured;
    const defaultResolution = source.defaultResolution.trim();
    const selected: VideoScreenSpecConfig = {
        ratios: [],
        defaultRatio: "",
        resolutions,
        defaultResolution: resolutions.find((value) => value.toLowerCase() === defaultResolution.toLowerCase()) || (initializing ? resolutions[0] || "" : defaultResolution),
    };
    return {
        ...profile,
        ...selected,
        fixedScreenSpec: fixed,
    };
}

export function updateWorkflowVideoScreenSpec(profile: VideoCapabilityConfig, workflow: ModelProtocolWorkflow | undefined, patch: Partial<VideoScreenSpecConfig>): VideoCapabilityConfig {
    const resolved = resolveWorkflowVideoScreenSpec(profile, workflow);
    if (!resolved.fixedScreenSpec) return profile;
    return resolveWorkflowVideoScreenSpec(
        {
            ...resolved,
            ...patch,
        },
        workflow,
    );
}
