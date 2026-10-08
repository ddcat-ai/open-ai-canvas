import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function joinClassNames(parts: ClassValue[]): string {
    const resolved = twMerge(clsx(parts));
    return resolved.length > 0 ? resolved : "";
}

export function cn(...values: ClassValue[]): string {
    return joinClassNames(values);
}
