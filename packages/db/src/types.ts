// TODO: regenerate from the live schema once Supabase project is linked:
//   supabase gen types typescript --linked > packages/db/src/types.ts
//
// Until then this is a deliberately minimal placeholder. Only
// `_scaffold_health` is described — every other table goes through the
// generated types after Slice 2.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      _scaffold_health: {
        Row: {
          id: string;
          message: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          message: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          message?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
