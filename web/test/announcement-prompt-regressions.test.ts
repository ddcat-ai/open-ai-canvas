import { expect, test } from "bun:test";

test("announcement prompts preserve lazy loading and dismiss even when read synchronization fails", async () => {
    const source = await Bun.file(new URL("../src/components/layout/system-announcement-center.tsx", import.meta.url)).text();
    expect(source).toContain('lazy(() => import("@/components/ui/aceternity/announcement-timeline-modal")');
    expect(source).toContain("{open ? (");
    expect(source).toContain("<Suspense fallback={null}>");
    expect(source).toContain("automaticPrompt={automaticPrompt}");
    expect(source).toContain('onClose={() => dismissAutomaticPrompt("once")}');
    expect(source).toContain('onDismissToday={() => dismissAutomaticPrompt("today")}');
    expect(source).toContain("setDismissedFingerprint(fingerprint)");
    expect(source).toContain("fingerprint === dismissedFingerprint");
    expect(source).toContain("`${ANNOUNCEMENT_DISMISS_TODAY_PREFIX}.${userId}`");
});
