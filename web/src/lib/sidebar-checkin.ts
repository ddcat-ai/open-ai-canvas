export function shouldShowSidebarCheckin(input: {
    creditsEnabled?: boolean;
    checkinBonusMicrocredits?: number | null;
    checkedInToday?: boolean;
}) {
    return Boolean(input.creditsEnabled && (input.checkinBonusMicrocredits || 0) > 0 && !input.checkedInToday);
}

export function sidebarCheckinTitle(brandName: string) {
    const name = brandName.trim() || "影策";
    return `${name}加油站`;
}
