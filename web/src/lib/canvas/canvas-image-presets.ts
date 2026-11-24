type ImagePreset = {
    id: number;
    key: string;
    text: string;
    icon: string;
    section: "sectionStoryboard" | "sectionCoverage" | "sectionProjection" | "sectionSheets";
    ratio: "original" | "16:9" | "3:2";
    hasPlaceholder?: boolean;
};

export const CANVAS_IMAGE_PRESETS: readonly ImagePreset[] = [
    { id: 1000090, key: "short_storyboard", text: "storyboard", icon: "Clapperboard", section: "sectionStoryboard", ratio: "16:9", hasPlaceholder: true },
    { id: 1000091, key: "blocking_storyboard", text: "blockingStoryboard", icon: "Route", section: "sectionStoryboard", ratio: "16:9", hasPlaceholder: true },
    { id: 80, key: "story_pitch_four_grid", text: "storyPitch", icon: "Grid2x2", section: "sectionStoryboard", ratio: "original" },
    { id: 83, key: "storyboard_25_grid", text: "storyboard25", icon: "Film", section: "sectionStoryboard", ratio: "original" },
    { id: 79, key: "multi_camera_nine_grid", text: "multiCamera", icon: "Grid3x3", section: "sectionCoverage", ratio: "original" },
    { id: 84, key: "cinematic_light_correction", text: "cinematicLight", icon: "Contrast", section: "sectionCoverage", ratio: "original" },
    { id: 87, key: "image_projection_before_5s", text: "projectionBefore", icon: "Rewind", section: "sectionProjection", ratio: "original" },
    { id: 86, key: "image_projection_after_3s", text: "projectionAfter", icon: "FastForward", section: "sectionProjection", ratio: "original" },
    { id: 1000089, key: "character_four_view", text: "characterFourView", icon: "ContactRound", section: "sectionSheets", ratio: "16:9" },
    { id: 85, key: "character_three_view_generation", text: "characterThreeView", icon: "PersonStanding", section: "sectionSheets", ratio: "16:9" },
    { id: 81, key: "character_face_three_view", text: "characterFace", icon: "ScanFace", section: "sectionSheets", ratio: "3:2" },
    { id: 82, key: "product_three_view", text: "productThreeView", icon: "Package", section: "sectionSheets", ratio: "3:2" },
];
