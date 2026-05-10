export interface SortableSegment {
  id: string;
  sequence_order: number;
}

/**
 * Render-stable segment ordering. Primary key is `sequence_order`;
 * secondary key is `id` so duplicate-order anomalies render in a
 * deterministic position across loads.
 */
export function sortSegments<T extends SortableSegment>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.sequence_order !== b.sequence_order) return a.sequence_order - b.sequence_order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
