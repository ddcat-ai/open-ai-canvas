export function suggestedVideoModelResolution(name: string) {
    const matches = [...name.matchAll(/(^|[\s_()\-])(480p|540p|720p|768p|960p|1080p|1440p|2160p|2k|4k)(?=$|[\s_()\-])/gi)];
    if (matches.length !== 1) return undefined;
    const match = matches[0];
    return match[2];
}
