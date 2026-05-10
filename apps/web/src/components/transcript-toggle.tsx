'use client';
// client: interactive disclosure for transcript_excerpt

import { useState } from 'react';

export function TranscriptToggle({ excerpt }: { excerpt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm text-slate-600 underline-offset-2 hover:underline"
      >
        {open ? 'Hide transcript excerpt' : 'Show transcript excerpt'}
      </button>
      {open && (
        <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm">{excerpt}</pre>
      )}
    </div>
  );
}
