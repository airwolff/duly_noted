import { readFile } from 'node:fs/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@duly-noted/db';

const BUCKET = 'meeting-artifacts';
const SIGNED_URL_TTL_SECONDS = 3600;

function audioStoragePath(meetingId: string): string {
  return `meetings/${meetingId}/audio.opus`;
}

/**
 * Upload the local opus file to the meeting-artifacts bucket and return its
 * Storage object path. `upsert: true` keeps the operation idempotent if the
 * worker re-claims a meeting after a crash mid-upload.
 */
export async function uploadAudio(
  supabase: SupabaseClient<Database>,
  meetingId: string,
  filePath: string,
): Promise<string> {
  const buffer = await readFile(filePath);
  const storagePath = audioStoragePath(meetingId);
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: 'audio/ogg',
    upsert: true,
  });
  if (error) {
    throw new Error(`storage upload failed for ${storagePath}: ${error.message}`);
  }
  return storagePath;
}

export async function signAudioUrl(
  supabase: SupabaseClient<Database>,
  storagePath: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);
  if (error || !data) {
    throw new Error(
      `signed url creation failed for ${storagePath}: ${error?.message ?? 'no data'}`,
    );
  }
  return data.signedUrl;
}
