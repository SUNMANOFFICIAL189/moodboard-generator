import type { BoardItem, VibeCluster } from "./types";

export interface ClusterLayoutOptions {
  startX: number;
  startY: number;
  targetWidth?: number; // image cell width
  intraGap?: number;    // gap between images inside a cluster
  interGap?: number;    // gap between cluster columns
}

export interface ClusterPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Lays out a set of clusters as vertical columns on the canvas. Each cluster
// gets its own column made of a sqrt-N sub-grid (so a 9-image cluster becomes
// 3×3, a 16-image cluster becomes 4×4, etc.). Columns flow left-to-right with
// `interGap` between them.
export function clusterLayoutPositions(
  clusters: VibeCluster[],
  itemsById: Map<string, BoardItem>,
  opts: ClusterLayoutOptions,
): Record<string, ClusterPlacement> {
  const targetWidth = opts.targetWidth ?? 240;
  const intraGap = opts.intraGap ?? 10;
  const interGap = opts.interGap ?? 80;

  const positions: Record<string, ClusterPlacement> = {};
  let currentX = opts.startX;

  for (const cluster of clusters) {
    const clusterItems = cluster.itemIds
      .map(id => itemsById.get(id))
      .filter((x): x is BoardItem => !!x);

    if (clusterItems.length === 0) continue;

    const columns = Math.max(1, Math.ceil(Math.sqrt(clusterItems.length)));

    let col = 0;
    let y = opts.startY;
    let rowMaxHeight = 0;

    for (const item of clusterItems) {
      const aspect = item.image.width / item.image.height || 1;
      const w = targetWidth;
      const h = Math.max(40, Math.round(w / aspect));
      const x = currentX + col * (targetWidth + intraGap);
      positions[item.id] = { x, y, width: w, height: h };
      rowMaxHeight = Math.max(rowMaxHeight, h);
      col++;
      if (col >= columns) {
        col = 0;
        y += rowMaxHeight + intraGap;
        rowMaxHeight = 0;
      }
    }

    // Advance the column origin by the cluster's width + gap.
    currentX += columns * (targetWidth + intraGap) - intraGap + interGap;
  }

  return positions;
}
