import type { Database } from '@duly-noted/db';

type MarkerType = Database['public']['Tables']['segments']['Row']['marker_type'];

// Votes and public comment are what a reader skims for, so they get the
// strongest colors; procedure recedes.
const MARKER_STYLE: Record<MarkerType, { label: string; className: string }> = {
  VOTE: { label: 'Vote', className: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  PUBLIC_COMMENT: {
    label: 'Public comment',
    className: 'bg-amber-100 text-amber-900 ring-amber-200',
  },
  AGENDA_ITEM: { label: 'Agenda item', className: 'bg-sky-100 text-sky-900 ring-sky-200' },
  DISCUSSION: { label: 'Discussion', className: 'bg-violet-100 text-violet-900 ring-violet-200' },
  PROCEDURE: { label: 'Procedure', className: 'bg-stone-100 text-stone-600 ring-stone-200' },
};

export function MarkerBadge({ markerType }: { markerType: MarkerType }) {
  const style = MARKER_STYLE[markerType];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${style.className}`}
    >
      {style.label}
    </span>
  );
}
