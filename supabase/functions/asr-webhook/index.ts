// Supabase Edge Function: AssemblyAI webhook receiver.
// Runs at: ${SUPABASE_URL}/functions/v1/asr-webhook
//
// Verifies the X-DulyNoted-Webhook header against ASR_WEBHOOK_SECRET (no
// payload logging on rejection), looks up the meeting by asr_transcript_id,
// idempotently advances state. On AssemblyAI 'completed', fetches the
// transcript JSON, writes it to Storage, and conditionally updates the
// meeting row to 'segmenting'.
//
// TODO: dedupe with packages/shared/src/asr.ts when a second Edge Function
// lands. For Slice 2 (one Edge Function), inlining the schemas is the
// cheaper choice than introducing an import_map.

// @deno-types="npm:zod@3.23.8"
import { z } from 'https://esm.sh/zod@3.23.8';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';

const HEADER_NAME = 'X-DulyNoted-Webhook';
const STORAGE_BUCKET = 'meeting-artifacts';

const env = {
  SUPABASE_URL: requireEnv('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  ASR_VENDOR_API_KEY: requireEnv('ASR_VENDOR_API_KEY'),
  ASR_WEBHOOK_SECRET: requireEnv('ASR_WEBHOOK_SECRET'),
};

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`asr-webhook: required env var ${name} is missing`);
  }
  return value;
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const webhookPayloadSchema = z
  .object({
    transcript_id: z.string(),
    status: z.string(),
    error: z.string().optional(),
  })
  .passthrough();

const transcriptSchema = z
  .object({
    id: z.string(),
    status: z.string(),
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

  const provided = request.headers.get(HEADER_NAME);
  if (!provided || provided !== env.ASR_WEBHOOK_SECRET) {
    // Do not log the body on a rejected request. This is a hard rule —
    // an attacker probing the endpoint should not see anything echoed.
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  let payload: z.infer<typeof webhookPayloadSchema>;
  try {
    const body = await request.json();
    payload = webhookPayloadSchema.parse(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`asr-webhook: payload parse failed: ${message}`);
    return jsonResponse({ error: 'bad_request' }, 400);
  }

  const { transcript_id, status: assemblyStatus, error: payloadError } = payload;

  const { data: row, error: lookupErr } = await supabase
    .from('meetings')
    .select('id, status')
    .eq('asr_transcript_id', transcript_id)
    .maybeSingle();
  if (lookupErr) {
    console.error(`asr-webhook: meeting lookup failed: ${lookupErr.message}`);
    return jsonResponse({ error: 'lookup_failed' }, 500);
  }
  if (!row) {
    console.warn(`asr-webhook: no meeting for transcript_id=${transcript_id}`);
    return jsonResponse({ ok: true, note: 'no_meeting' }, 200);
  }
  if (row.status !== 'transcribing') {
    console.log(
      `asr-webhook: meeting ${row.id} already at status=${row.status}; idempotent return`,
    );
    return jsonResponse({ ok: true, note: 'already_processed' }, 200);
  }

  if (assemblyStatus !== 'completed') {
    const lastError = payloadError ?? `assemblyai status: ${assemblyStatus}`;
    const { error: failErr } = await supabase
      .from('meetings')
      .update({
        status: 'failed',
        last_error: lastError.slice(0, 4000),
        failed_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'transcribing');
    if (failErr) {
      console.error(`asr-webhook: fail update failed for ${row.id}: ${failErr.message}`);
      return jsonResponse({ error: 'update_failed' }, 500);
    }
    return jsonResponse({ ok: true, note: 'marked_failed' }, 200);
  }

  // Fetch the full transcript JSON from AssemblyAI.
  const transcriptResponse = await fetch(
    `https://api.assemblyai.com/v2/transcript/${transcript_id}`,
    {
      headers: { Authorization: `Bearer ${env.ASR_VENDOR_API_KEY}` },
    },
  );
  if (!transcriptResponse.ok) {
    const text = await transcriptResponse.text().catch(() => '');
    console.error(`asr-webhook: assemblyai fetch failed: ${transcriptResponse.status} ${text}`);
    return jsonResponse({ error: 'vendor_fetch_failed' }, 502);
  }
  const transcriptJson: unknown = await transcriptResponse.json();
  // Validate just enough to branch on; we still write the full payload.
  transcriptSchema.parse(transcriptJson);

  const storagePath = `meetings/${row.id}/transcript.json`;
  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, new Blob([JSON.stringify(transcriptJson)], { type: 'application/json' }), {
      contentType: 'application/json',
      upsert: true,
    });
  if (uploadErr) {
    console.error(`asr-webhook: storage upload failed: ${uploadErr.message}`);
    return jsonResponse({ error: 'storage_upload_failed' }, 500);
  }

  // Conditional UPDATE preserves idempotency under duplicate webhook delivery.
  const { data: updated, error: updateErr } = await supabase
    .from('meetings')
    .update({
      transcript_url: storagePath,
      status: 'segmenting',
    })
    .eq('id', row.id)
    .eq('status', 'transcribing')
    .select('id');
  if (updateErr) {
    console.error(`asr-webhook: state update failed: ${updateErr.message}`);
    return jsonResponse({ error: 'update_failed' }, 500);
  }
  if (!updated || updated.length === 0) {
    console.log(`asr-webhook: meeting ${row.id} no-op update (likely raced)`);
  }

  return jsonResponse({ ok: true }, 200);
});
