/**
 * Split a stored summary into display paragraphs.
 *
 * Summaries are plain prose with blank lines between paragraphs (the model is
 * told to write 2–3 of them). Rendering the whole string in one `<p>` with
 * `whitespace-pre-wrap` produced an unbroken wall of text, so the reader splits
 * on blank lines and renders one `<p>` per paragraph.
 *
 * Tolerant on input: summaries written before the prompt asked for paragraphs
 * are a single block and come back as one element. Windows line endings, runs
 * of blank lines, and trailing whitespace are all normalized away rather than
 * producing empty paragraphs.
 */
export function splitParagraphs(summary: string): string[] {
  return summary
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
