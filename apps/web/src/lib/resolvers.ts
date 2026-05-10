import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@duly-noted/db';

type Client = SupabaseClient<Database>;

export interface PubRef {
  id: string;
  slug: string;
  name: string;
}
export interface TownRef {
  id: string;
  slug: string;
  name: string;
}
export interface BoardRef {
  id: string;
  slug: string;
  name: string;
}

export async function resolvePublication(c: Client, slug: string): Promise<PubRef | null> {
  const { data } = await c
    .from('publications')
    .select('id, slug, name')
    .eq('slug', slug)
    .maybeSingle();
  return data ?? null;
}

export async function resolveTown(c: Client, pub: PubRef, slug: string): Promise<TownRef | null> {
  const { data } = await c
    .from('towns')
    .select('id, slug, name')
    .eq('publication_id', pub.id)
    .eq('slug', slug)
    .maybeSingle();
  return data ?? null;
}

export async function resolveBoard(
  c: Client,
  town: TownRef,
  slug: string,
): Promise<BoardRef | null> {
  const { data } = await c
    .from('boards')
    .select('id, slug, name')
    .eq('town_id', town.id)
    .eq('slug', slug)
    .maybeSingle();
  return data ?? null;
}

export async function resolveBoardChain(
  c: Client,
  publicationSlug: string,
  townSlug: string,
  boardSlug: string,
): Promise<{ publication: PubRef; town: TownRef; board: BoardRef } | null> {
  const publication = await resolvePublication(c, publicationSlug);
  if (!publication) return null;
  const town = await resolveTown(c, publication, townSlug);
  if (!town) return null;
  const board = await resolveBoard(c, town, boardSlug);
  if (!board) return null;
  return { publication, town, board };
}
