/**
 * Compose the canonical AssemblyAI webhook URL for the deployed Supabase
 * project. Always derived from `SUPABASE_URL`; there is no override env var.
 */
export function composeWebhookUrl(supabaseUrl: string): string {
  const trimmed = supabaseUrl.replace(/\/+$/, '');
  return `${trimmed}/functions/v1/asr-webhook`;
}
