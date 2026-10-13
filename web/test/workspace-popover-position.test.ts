import { expect, test } from "bun:test";
import { workspacePopoverPosition } from "../src/components/ui/workspace-popover";

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });

test("account menu stays inside the right edge", () => {
    const position = workspacePopoverPosition(rect(960, 10, 36, 36), rect(0, 0, 320, 400), { width: 1000, height: 800 }, "bottomRight");
    expect(position).toEqual({ left: 672, top: 52 });
});

test("composer menu flips above a trigger near the bottom", () => {
    const position = workspacePopoverPosition(rect(450, 690, 120, 36), rect(0, 0, 288, 450), { width: 1000, height: 800 });
    expect(position).toEqual({ left: 366, top: 234 });
});

test("large menu is clamped to a narrow viewport", () => {
    const position = workspacePopoverPosition(rect(10, 30, 40, 36), rect(0, 0, 300, 700), { width: 320, height: 600 }, "bottomLeft");
    expect(position).toEqual({ left: 10, top: 8 });
});
