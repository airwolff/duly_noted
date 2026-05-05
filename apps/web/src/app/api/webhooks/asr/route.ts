import { NextResponse, type NextRequest } from 'next/server';
import { loadEnv } from '../../../../../env.js';

export async function POST(request: NextRequest) {
  const env = loadEnv();
  const provided = request.headers.get('x-webhook-secret');
  if (!provided || provided !== env.ASR_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return NextResponse.json(
    { error: 'not_implemented', message: 'ASR webhook handler arrives in Slice 3.' },
    { status: 501 },
  );
}
