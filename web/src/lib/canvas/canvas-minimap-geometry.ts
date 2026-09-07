import type { ViewportTransform } from "@/types/canvas";

export type MinimapWorldRect = { x: number; y: number; w: number; h: number };
export type MinimapPixelRect = { x: number; y: number; w: number; h: number };

const MIN_WORLD_EXTENT = 1;
const MIN_PIXEL_EXTENT = 4;

function finite(value: number, fallback: number) {
    return Number.isFinite(value) ? value : fallback;
}

export function viewportWorldRect(viewport: ViewportTransform, viewportSize: { width: number; height: number }): MinimapWorldRect {
    const zoom = Math.max(finite(viewport.k, 1), 0.0001);
    const width = Math.max(finite(viewportSize.width, 1), MIN_WORLD_EXTENT);
    const height = Math.max(finite(viewportSize.height, 1), MIN_WORLD_EXTENT);
    return {
        x: -finite(viewport.x, 0) / zoom,
        y: -finite(viewport.y, 0) / zoom,
        w: Math.max(width / zoom, MIN_WORLD_EXTENT),
        h: Math.max(height / zoom, MIN_WORLD_EXTENT),
    };
}

/**
 * Mirrors xyflow MiniMap's viewBox calculation. The viewBox is based on the
 * union of visible nodes and the current viewport, then receives the same
 * five viewScale units of breathing room as MiniMap's offsetScale default.
 */
export function calculateMinimapWorldBounds(nodeBounds: MinimapWorldRect | null, viewportBounds: MinimapWorldRect, offsetScale = 5, mapSize = { width: 240, height: 160 }): MinimapWorldRect {
    const viewX = finite(viewportBounds.x, 0);
    const viewY = finite(viewportBounds.y, 0);
    const viewW = Math.max(finite(viewportBounds.w, MIN_WORLD_EXTENT), MIN_WORLD_EXTENT);
    const viewH = Math.max(finite(viewportBounds.h, MIN_WORLD_EXTENT), MIN_WORLD_EXTENT);
    const nodeX = nodeBounds ? finite(nodeBounds.x, viewX) : viewX;
    const nodeY = nodeBounds ? finite(nodeBounds.y, viewY) : viewY;
    const nodeW = nodeBounds ? Math.max(finite(nodeBounds.w, MIN_WORLD_EXTENT), MIN_WORLD_EXTENT) : viewW;
    const nodeH = nodeBounds ? Math.max(finite(nodeBounds.h, MIN_WORLD_EXTENT), MIN_WORLD_EXTENT) : viewH;
    const minX = Math.min(nodeX, viewX);
    const minY = Math.min(nodeY, viewY);
    const maxX = Math.max(nodeX + nodeW, viewX + viewW);
    const maxY = Math.max(nodeY + nodeH, viewY + viewH);
    const boundingWidth = Math.max(maxX - minX, MIN_WORLD_EXTENT);
    const boundingHeight = Math.max(maxY - minY, MIN_WORLD_EXTENT);
    const mapWidth = Math.max(finite(mapSize.width, 240), MIN_PIXEL_EXTENT);
    const mapHeight = Math.max(finite(mapSize.height, 160), MIN_PIXEL_EXTENT);
    const viewScale = Math.max(boundingWidth / mapWidth, boundingHeight / mapHeight);
    const viewWidth = viewScale * mapWidth;
    const viewHeight = viewScale * mapHeight;
    const padding = Math.max(finite(offsetScale, 5), 0) * viewScale;
    return {
        x: minX - (viewWidth - boundingWidth) / 2 - padding,
        y: minY - (viewHeight - boundingHeight) / 2 - padding,
        w: Math.max(viewWidth + padding * 2, MIN_WORLD_EXTENT),
        h: Math.max(viewHeight + padding * 2, MIN_WORLD_EXTENT),
    };
}

export function minimapViewportRect(viewportBounds: MinimapWorldRect, worldBounds: MinimapWorldRect, mapSize: { width: number; height: number }): MinimapPixelRect {
    const mapWidth = Math.max(finite(mapSize.width, 1), MIN_PIXEL_EXTENT);
    const mapHeight = Math.max(finite(mapSize.height, 1), MIN_PIXEL_EXTENT);
    const boundsX = finite(worldBounds.x, 0);
    const boundsY = finite(worldBounds.y, 0);
    const boundsW = Math.max(finite(worldBounds.w, MIN_WORLD_EXTENT), MIN_WORLD_EXTENT);
    const boundsH = Math.max(finite(worldBounds.h, MIN_WORLD_EXTENT), MIN_WORLD_EXTENT);
    const scale = Math.min(mapWidth / boundsW, mapHeight / boundsH);
    const contentWidth = boundsW * scale;
    const contentHeight = boundsH * scale;
    const offsetX = (mapWidth - contentWidth) / 2;
    const offsetY = (mapHeight - contentHeight) / 2;
    const viewX = finite(viewportBounds.x, boundsX);
    const viewY = finite(viewportBounds.y, boundsY);
    const viewW = Math.max(finite(viewportBounds.w, MIN_WORLD_EXTENT), MIN_WORLD_EXTENT);
    const viewH = Math.max(finite(viewportBounds.h, MIN_WORLD_EXTENT), MIN_WORLD_EXTENT);
    const left = (viewX - boundsX) * scale + offsetX;
    const top = (viewY - boundsY) * scale + offsetY;
    const right = (viewX + viewW - boundsX) * scale + offsetX;
    const bottom = (viewY + viewH - boundsY) * scale + offsetY;
    const contentRight = offsetX + contentWidth;
    const contentBottom = offsetY + contentHeight;
    const width = Math.max(Math.min(right - left, contentWidth), MIN_PIXEL_EXTENT);
    const height = Math.max(Math.min(bottom - top, contentHeight), MIN_PIXEL_EXTENT);
    return {
        x: Math.min(Math.max(left, offsetX), Math.max(offsetX, contentRight - width)),
        y: Math.min(Math.max(top, offsetY), Math.max(offsetY, contentBottom - height)),
        w: width,
        h: height,
    };
}

export function minimapScaleForWorldBounds(worldBounds: MinimapWorldRect, mapSize: { width: number; height: number }) {
    const width = Math.max(finite(worldBounds.w, MIN_WORLD_EXTENT), MIN_WORLD_EXTENT);
    const height = Math.max(finite(worldBounds.h, MIN_WORLD_EXTENT), MIN_WORLD_EXTENT);
    return Math.min(Math.max(finite(mapSize.width, MIN_PIXEL_EXTENT), MIN_PIXEL_EXTENT) / width, Math.max(finite(mapSize.height, MIN_PIXEL_EXTENT), MIN_PIXEL_EXTENT) / height);
}
