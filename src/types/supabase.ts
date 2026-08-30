/**
 * @file types/supabase.ts
 * @description TypeScript types auto-generated from the Supabase schema.
 *
 * In a real project these are generated via:
 *   npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/supabase.ts
 *
 * This file is manually crafted to match the schema in 001_initial_schema.sql.
 * Regenerate after any schema changes.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// =============================================================================
// Database root type (passed to createClient<Database>)
// =============================================================================

export interface Database {
  public: {
    Tables: {
      noledge_decks: {
        Row: DeckRow;
        Insert: DeckInsert;
        Update: DeckUpdate;
      };
      noledge_questions: {
        Row: QuestionRow;
        Insert: QuestionInsert;
        Update: QuestionUpdate;
      };
      noledge_srs_progress: {
        Row: SRSProgressRow;
        Insert: SRSProgressInsert;
        Update: SRSProgressUpdate;
      };
      noledge_study_sessions: {
        Row: StudySessionRow;
        Insert: StudySessionInsert;
        Update: StudySessionUpdate;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      question_type: 'tf' | 'mcq' | 'multi' | 'typing' | 'voice' | 'image-select' | 'match' | 'fill' | 'order' | 'code';
      difficulty_level: 'easy' | 'medium' | 'hard';
      source_kind: 'github' | 'obsidian' | 'manual' | 'import';
    };
  };
}

// =============================================================================
// noledge_decks
// =============================================================================

export interface DeckRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  tags: string[] | null;
  card_count: number | null;
  source_kind: Database['public']['Enums']['source_kind'] | null;
  source_config: Json | null;
  created_at: string;
  updated_at: string;
}

export type DeckInsert = Omit<DeckRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type DeckUpdate = Partial<DeckInsert>;

// =============================================================================
// noledge_questions
// =============================================================================

export interface QuestionRow {
  id: string;
  user_id: string;
  deck_id: string;
  type: Database['public']['Enums']['question_type'];
  content: string;
  answer: Json;
  options: Json | null;
  explanation: string | null;
  difficulty: Database['public']['Enums']['difficulty_level'] | null;
  tags: string[] | null;
  source_file: string | null;
  created_at: string;
  updated_at: string;
}

export type QuestionInsert = Omit<QuestionRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type QuestionUpdate = Partial<QuestionInsert>;

// =============================================================================
// noledge_srs_progress
// =============================================================================

export interface SRSProgressRow {
  id: string;
  user_id: string;
  question_id: string;
  deck_id: string;
  ease_factor: number;
  interval: number;
  repetitions: number;
  next_review_at: string;
  last_reviewed_at: string | null;
  correct_count: number;
  wrong_count: number;
  updated_at: string;
}

export type SRSProgressInsert = Omit<SRSProgressRow, 'id'> & {
  id?: string;
};

export type SRSProgressUpdate = Partial<SRSProgressInsert>;

// =============================================================================
// noledge_study_sessions
// =============================================================================

export interface StudySessionRow {
  id: string;
  user_id: string;
  deck_id: string;
  started_at: string;
  ended_at: string | null;
  cards_studied: number;
  correct_count: number;
  wrong_count: number;
  accuracy: number | null;
  duration_ms: number | null;
  created_at: string;
}

export type StudySessionInsert = Omit<StudySessionRow, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type StudySessionUpdate = Partial<StudySessionInsert>;
