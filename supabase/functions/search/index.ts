// Supabase Edge Function: user-facing hybrid search.
// Runs at: ${SUPABASE_URL}/functions/v1/search
//
// JWT verification is performed at the gateway (default Edge Function
// behavior — distinct from asr-webhook which sets verify_jwt = false in
// supabase/config.toml). The caller's JWT is forwarded to the
// supabase-js client below so PostgREST runs search_segments as the
// caller's role; Slice 5's membership-aware RLS gates the result set
// without policy duplication.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY. Set via
// `supabase secrets set` per the Dashlane manual-sync workflow
// (CLAUDE.md §6).

// @deno-types="npm:zod@3.23.8"
import { z } from 'https://esm.sh/zod@3.23.8';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';

const DEFAULT_MATCH_COUNT = 20;
const MAX_MATCH_COUNT = 50;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`search: required env var ${name} is missing`);
  }
  return value;
}

const env = {
  SUPABASE_URL: requireEnv('SUPABASE_URL'),
  SUPABASE_ANON_KEY: requireEnv('SUPABASE_ANON_KEY'),
  OPENAI_API_KEY: requireEnv('OPENAI_API_KEY'),
};

const requestSchema = z.object({
  query: z.string().min(1).max(500),
  match_count: z.number().int().positive().max(MAX_MATCH_COUNT).optional(),
});

const openaiEmbeddingResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            embedding: z.array(z.number()).length(EMBEDDING_DIMENSIONS),
          })
          .passthrough(),
      )
      .length(1),
  })
  .passthrough();

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  // Gateway-level JWT verification has already run. We still need the
  // header to forward downstream so PostgREST sees the caller's role.
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  let payload: z.infer<typeof requestSchema>;
  try {
    payload = requestSchema.parse(await request.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`search: bad request: ${message}`);
    return jsonResponse({ error: 'bad_request' }, 400);
  }

  // Generate query embedding via OpenAI. Single retry-less attempt: the
  // user is sitting on the search page; failure surfaces as a 502 and the
  // page renders an error state.
  const oaiResponse = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: payload.query,
    }),
  });
  if (!oaiResponse.ok) {
    const text = await oaiResponse.text().catch(() => '');
    console.error(`search: openai embed failed: ${oaiResponse.status} ${text}`);
    return jsonResponse({ error: 'embedding_failed' }, 502);
  }

  let embedding: number[];
  try {
    const json: unknown = await oaiResponse.json();
    const parsed = openaiEmbeddingResponseSchema.parse(json);
    embedding = parsed.data[0]!.embedding;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`search: openai response invalid: ${message}`);
    return jsonResponse({ error: 'embedding_invalid' }, 502);
  }

  // Forward the caller's JWT so search_segments runs as authenticated.
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Pass the embedding as a pgvector text literal so PostgREST's typed-
  // parameter encoding does not need to know about vector.
  const queryEmbedding = `[${embedding.join(',')}]`;

  const { data, error } = await supabase.rpc('search_segments', {
    query_text: payload.query,
    query_embedding: queryEmbedding,
    match_count: payload.match_count ?? DEFAULT_MATCH_COUNT,
  });
  if (error) {
    console.error(`search: rpc failed: ${error.message}`);
    return jsonResponse({ error: 'search_failed' }, 500);
  }

  return jsonResponse({ results: data ?? [] }, 200);
});
