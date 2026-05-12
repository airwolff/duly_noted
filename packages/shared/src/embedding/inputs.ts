export interface EmbeddingInputFields {
  title: string;
  description: string;
  transcript_excerpt: string;
}

export function buildEmbeddingInput(fields: EmbeddingInputFields): string {
  const parts = [fields.title.trim(), fields.description.trim(), fields.transcript_excerpt.trim()];
  const joined = parts.join(' ').trim();
  if (joined === '') {
    throw new Error('buildEmbeddingInput: cannot build an empty input');
  }
  return joined;
}
