'use client';
// client: interactive disclosure for transcript_excerpt

import { useState } from 'react';

export function TranscriptToggle({ excerpt }: { excerpt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-sm text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline"
      >
        {open ? 'Hide transcript' : 'Read transcript'}
      </button>
      {open && (
        <blockquote className="mt-1 w-full basis-full whitespace-pre-wrap border-l-2 border-stone-300 pl-4 text-sm leading-relaxed text-stone-600">
          {excerpt}
        </blockquote>
      )}
    </>
  );
}
