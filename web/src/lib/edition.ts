// The Lite edition is selected at build time; regular web builds remain full.
export const CLIENT_EDITION: "full" | "lite" = import.meta.env.VITE_CLIENT_EDITION === "lite" ? "lite" : "full";
export const IS_LITE = CLIENT_EDITION === "lite";
