// Hand-extended Database type covering the Slice 2 schema. This is a
// deliberate placeholder until the Supabase project is linked locally and
// `supabase gen types typescript --linked > packages/db/src/types.ts` is wired
// into the build. When that lands, this file is regenerated wholesale.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type MeetingStatus =
  | 'discovered'
  | 'pending'
  | 'extracting'
  | 'transcribing'
  | 'segmenting'
  | 'chaptering'
  | 'summarizing'
  | 'summarizing_inflight'
  | 'embedding'
  | 'embedding_inflight'
  | 'review'
  | 'published'
  | 'failed';

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
      publications: {
        Row: {
          id: string;
          slug: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      towns: {
        Row: {
          id: string;
          publication_id: string;
          slug: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          publication_id: string;
          slug: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          publication_id?: string;
          slug?: string;
          name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      boards: {
        Row: {
          id: string;
          town_id: string;
          slug: string;
          name: string;
          created_at: string;
          youtube_channel_id: string | null;
          title_pattern: string | null;
          min_duration_seconds: number;
          uploads_playlist_id: string | null;
          ingest_since_days: number;
        };
        Insert: {
          id?: string;
          town_id: string;
          slug: string;
          name: string;
          created_at?: string;
          youtube_channel_id?: string | null;
          title_pattern?: string | null;
          min_duration_seconds?: number;
          ingest_since_days?: number;
        };
        Update: {
          id?: string;
          town_id?: string;
          slug?: string;
          name?: string;
          created_at?: string;
          youtube_channel_id?: string | null;
          title_pattern?: string | null;
          min_duration_seconds?: number;
          ingest_since_days?: number;
        };
        Relationships: [];
      };
      meetings: {
        Row: {
          id: string;
          board_id: string;
          status: MeetingStatus;
          youtube_id: string;
          meeting_date: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
          transcript_url: string | null;
          audio_url: string | null;
          asr_transcript_id: string | null;
          duration_seconds: number | null;
          title: string | null;
          failed_at: string | null;
          summary: string | null;
          summary_generated_at: string | null;
        };
        Insert: {
          id?: string;
          board_id: string;
          status?: MeetingStatus;
          youtube_id: string;
          meeting_date?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
          transcript_url?: string | null;
          audio_url?: string | null;
          asr_transcript_id?: string | null;
          duration_seconds?: number | null;
          title?: string | null;
          failed_at?: string | null;
          summary?: string | null;
          summary_generated_at?: string | null;
        };
        Update: {
          id?: string;
          board_id?: string;
          status?: MeetingStatus;
          youtube_id?: string;
          meeting_date?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
          transcript_url?: string | null;
          audio_url?: string | null;
          asr_transcript_id?: string | null;
          duration_seconds?: number | null;
          title?: string | null;
          failed_at?: string | null;
          summary?: string | null;
          summary_generated_at?: string | null;
        };
        Relationships: [];
      };
      memberships: {
        Row: {
          id: string;
          user_id: string;
          publication_id: string;
          role: 'reader' | 'editor' | 'admin';
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          publication_id: string;
          role: 'reader' | 'editor' | 'admin';
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          publication_id?: string;
          role?: 'reader' | 'editor' | 'admin';
          created_at?: string;
        };
        Relationships: [];
      };
      segments: {
        Row: {
          id: string;
          meeting_id: string;
          sequence_order: number;
          marker_type: 'AGENDA_ITEM' | 'PUBLIC_COMMENT' | 'DISCUSSION' | 'VOTE' | 'PROCEDURE';
          title: string;
          description: string;
          start_time_seconds: number;
          end_time_seconds: number;
          transcript_excerpt: string;
          created_at: string;
          updated_at: string;
          embedding: string | null;
          search_tsv: string | null;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          sequence_order: number;
          marker_type: 'AGENDA_ITEM' | 'PUBLIC_COMMENT' | 'DISCUSSION' | 'VOTE' | 'PROCEDURE';
          title: string;
          description: string;
          start_time_seconds: number;
          end_time_seconds: number;
          transcript_excerpt: string;
          created_at?: string;
          updated_at?: string;
          embedding?: string | null;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          sequence_order?: number;
          marker_type?: 'AGENDA_ITEM' | 'PUBLIC_COMMENT' | 'DISCUSSION' | 'VOTE' | 'PROCEDURE';
          title?: string;
          description?: string;
          start_time_seconds?: number;
          end_time_seconds?: number;
          transcript_excerpt?: string;
          created_at?: string;
          updated_at?: string;
          embedding?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      claim_pending_meeting: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          board_id: string;
          youtube_id: string;
          title: string | null;
          duration_seconds: number | null;
        }[];
      };
      auto_promote_for_board: {
        Args: { p_board_id: string };
        Returns: number;
      };
      claim_segmenting_meeting: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          transcript_url: string | null;
          duration_seconds: number | null;
        }[];
      };
      complete_segmentation: {
        Args: { p_meeting_id: string; p_segments: Json };
        Returns: void;
      };
      claim_summarizing_meeting: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          board_id: string;
          title: string | null;
          meeting_date: string | null;
          youtube_id: string;
        }[];
      };
      complete_summarization: {
        Args: { p_meeting_id: string; p_summary: string };
        Returns: void;
      };
      claim_embedding_meeting: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          segments: Json;
        }[];
      };
      complete_embedding: {
        Args: { p_meeting_id: string; p_segment_embeddings: Json };
        Returns: void;
      };
      abandon_embedding_meeting: {
        Args: { p_meeting_id: string; p_error_text: string };
        Returns: void;
      };
      search_segments: {
        Args: {
          query_text: string;
          query_embedding: string;
          match_count: number;
          full_text_weight?: number;
          semantic_weight?: number;
          rrf_k?: number;
        };
        Returns: {
          segment_id: string;
          meeting_id: string;
          publication_slug: string;
          publication_name: string;
          town_slug: string;
          town_name: string;
          board_slug: string;
          board_name: string;
          meeting_title: string | null;
          meeting_date: string | null;
          segment_title: string;
          segment_description: string;
          marker_type: 'AGENDA_ITEM' | 'PUBLIC_COMMENT' | 'DISCUSSION' | 'VOTE' | 'PROCEDURE';
          transcript_excerpt: string;
          start_time_seconds: number;
          rrf_score: number;
        }[];
      };
    };
    Enums: {
      meeting_status: MeetingStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
