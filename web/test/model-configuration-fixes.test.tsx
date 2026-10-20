import { describe, expect, test } from "bun:test";
import { FormStore } from "@rc-component/form/lib/hooks/useForm";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageSizePresetsEditor } from "../src/components/image-size-presets-editor";
import { defaultImageCapabilityConfig } from "../src/lib/model-capabilities";
import { imageParametersForSpec, initializeImageRatioDefaults, projectImageParameters, resolveImageParameters, type ImageParameter } from "../src/lib/image-parameters";
import { initialChannelModelValues, replaceChannelModelFormValues } from "../src/pages/admin/components/channel-model-editor-form";

describe("generic model configuration fixes", () => {
    test("replacing a draft clears nested fields and undefined capability configuration in the real form store", () => {
        const form = new FormStore(() => {}).getForm();
        const draft = initialChannelModelValues(null, []);
        form.setFieldsValue({ ...draft, capabilityConfig: { version: 1, image: defaultImageCapabilityConfig() } });
        replaceChannelModelFormValues(form, { ...draft, capabilityConfig: { version: 1 } });
        expect(form.getFieldValue("capabilityConfig")).toEqual({ version: 1 });
        replaceChannelModelFormValues(form, { ...draft, capabilityConfig: undefined });
        expect(form.getFieldValue("capabilityConfig")).toBeUndefined();
    });

    test("free pixels initialize usable presets and default output choices", () => {
        const fields: ImageParameter[] = [{ name: "size", label: "尺寸", type: "string", encoding: "pixels" }];
        const image = projectImageParameters({ ...defaultImageCapabilityConfig(), size: { ...defaultImageCapabilityConfig().size, presets: [] } }, fields);
        const initialized = initializeImageRatioDefaults(image, fields);
        expect(initialized.size.presets?.map((p) => p.ratio)).toEqual(["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"]);
        const html = renderToStaticMarkup(<ImageSizePresetsEditor profile={initialized} onChange={() => {}} />);
        expect(html).toContain('aria-label="默认输出"');
        expect(html).toContain("1024x1024");
    });

    test("unbounded contracts clear enum restrictions and restore configured resolution choices", () => {
        const fields = imageParametersForSpec({ version: 1, capability: "image", imageParameters: [{ name: "size", label: "Size", type: "string", values: ["1:1"] }], options: { size: { values: ["*"] } } });
        expect(fields[0].values).toEqual([]);
        const image = defaultImageCapabilityConfig();
        image.parameters = [];
        image.resolution = { supported: true, values: ["small", "large"], default: "large" };
        expect(resolveImageParameters(image, [{ name: "imageResolution", label: "分辨率", type: "string" }], "model").resolution).toEqual(image.resolution);
    });
});
