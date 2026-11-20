import { expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { EcommerceExportItem } from "../src/pages/ecommerce/export";

test("ZIP download submits its native request synchronously and preserves selection order", async () => {
    const dom = new Window({ url: "http://localhost/ecommerce" });
    const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { value: dom.document, configurable: true });
    const { startEcommerceDownload } = await import("../src/pages/ecommerce/export");
    let requested: string[] = [];
    const submit = spyOn(dom.HTMLFormElement.prototype, "submit").mockImplementation(function (this: HTMLFormElement) {
        expect(this.method).toBe("post");
        expect(this.action).toContain("/api/ecommerce/download");
        requested = Array.from(this.querySelectorAll("input")).map((field) => field.value);
    });
    try {
        const items = Array.from({ length: 9 }, (_, i) => ({ resourceId: `image-${i}`, assetId: `asset-${i}`, index: i, image: {} })) as EcommerceExportItem[];
        expect(startEcommerceDownload(items)).toBe(true);
        expect(submit).toHaveBeenCalledTimes(1);
        expect(requested).toEqual(items.map((item) => item.resourceId!));
        expect(dom.document.querySelector("form")).toBeNull();
    } finally {
        submit.mockRestore();
        if (previous) Object.defineProperty(globalThis, "document", previous);
        else Reflect.deleteProperty(globalThis, "document");
    }
});
