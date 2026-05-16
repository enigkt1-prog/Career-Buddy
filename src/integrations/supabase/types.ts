export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      _migrations: {
        Row: {
          applied_at: string | null
          filename: string
        }
        Insert: {
          applied_at?: string | null
          filename: string
        }
        Update: {
          applied_at?: string | null
          filename?: string
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          id: string
          user_id: string | null
          event_name: string
          payload: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          event_name: string
          payload?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          event_name?: string
          payload?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      applications: {
        Row: {
          applied_date: string | null
          client_id: string | null
          company: string
          created_at: string | null
          fit_score: number | null
          id: string
          job_url: string | null
          last_event_date: string | null
          next_action: string | null
          notes: string | null
          notes_text: string | null
          role: string | null
          status: string | null
          url: string | null
          user_id: string | null
        }
        Insert: {
          applied_date?: string | null
          client_id?: string | null
          company: string
          created_at?: string | null
          fit_score?: number | null
          id?: string
          job_url?: string | null
          last_event_date?: string | null
          next_action?: string | null
          notes?: string | null
          notes_text?: string | null
          role?: string | null
          status?: string | null
          url?: string | null
          user_id?: string | null
        }
        Update: {
          applied_date?: string | null
          client_id?: string | null
          company?: string
          created_at?: string | null
          fit_score?: number | null
          id?: string
          job_url?: string | null
          last_event_date?: string | null
          next_action?: string | null
          notes?: string | null
          notes_text?: string | null
          role?: string | null
          status?: string | null
          url?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          application_id: string | null
          email_body: string | null
          email_subject: string | null
          event_type: string
          id: string
          parsed_action: string | null
          parsed_at: string | null
        }
        Insert: {
          application_id?: string | null
          email_body?: string | null
          email_subject?: string | null
          event_type: string
          id?: string
          parsed_action?: string | null
          parsed_at?: string | null
        }
        Update: {
          application_id?: string | null
          email_body?: string | null
          email_subject?: string | null
          event_type?: string
          id?: string
          parsed_action?: string | null
          parsed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      job_dismissals: {
        Row: {
          dismissed_at: string | null
          url: string
        }
        Insert: {
          dismissed_at?: string | null
          url: string
        }
        Update: {
          dismissed_at?: string | null
          url?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          ats_source: string
          city: string | null
          company_domain: string
          company_name: string
          country: string | null
          description: string | null
          employment_type: string | null
          first_seen_at: string | null
          id: string
          is_active: boolean | null
          is_international: boolean | null
          is_remote: boolean | null
          languages_required: string[] | null
          last_seen_at: string | null
          level: Database["public"]["Enums"]["job_level"] | null
          location: string | null
          location_normalized: string | null
          posted_date: string | null
          raw_payload: Json | null
          requirements: string | null
          role_category: string | null
          role_title: string
          salary_currency: string | null
          salary_max: number | null
          salary_min: number | null
          url: string
          visa_sponsorship: boolean | null
          years_max: number | null
          years_min: number | null
        }
        Insert: {
          ats_source: string
          city?: string | null
          company_domain: string
          company_name: string
          country?: string | null
          description?: string | null
          employment_type?: string | null
          first_seen_at?: string | null
          id?: string
          is_active?: boolean | null
          is_international?: boolean | null
          is_remote?: boolean | null
          languages_required?: string[] | null
          last_seen_at?: string | null
          level?: Database["public"]["Enums"]["job_level"] | null
          location?: string | null
          location_normalized?: string | null
          posted_date?: string | null
          raw_payload?: Json | null
          requirements?: string | null
          role_category?: string | null
          role_title: string
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          url: string
          visa_sponsorship?: boolean | null
          years_max?: number | null
          years_min?: number | null
        }
        Update: {
          ats_source?: string
          city?: string | null
          company_domain?: string
          company_name?: string
          country?: string | null
          description?: string | null
          employment_type?: string | null
          first_seen_at?: string | null
          id?: string
          is_active?: boolean | null
          is_international?: boolean | null
          is_remote?: boolean | null
          languages_required?: string[] | null
          last_seen_at?: string | null
          level?: Database["public"]["Enums"]["job_level"] | null
          location?: string | null
          location_normalized?: string | null
          posted_date?: string | null
          raw_payload?: Json | null
          requirements?: string | null
          role_category?: string | null
          role_title?: string
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          url?: string
          visa_sponsorship?: boolean | null
          years_max?: number | null
          years_min?: number | null
        }
        Relationships: []
      }
      user_context_notes: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          note_text: string
          source: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          note_text: string
          source?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          note_text?: string
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_feed_state: {
        Row: {
          user_id: string
          last_feed_view_at: string | null
          updated_at: string
        }
        Insert: {
          user_id: string
          last_feed_view_at?: string | null
          updated_at?: string
        }
        Update: {
          user_id?: string
          last_feed_view_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_profile: {
        Row: {
          created_at: string
          cv_filename: string | null
          cv_fit_score: number | null
          cv_summary: string | null
          education: Json
          headline: string | null
          id: string
          location_preferences: string[]
          name: string | null
          skills: Json
          summary: string | null
          target_geo: string | null
          target_role: string | null
          target_role_categories: string[]
          updated_at: string
          user_id: string | null
          work_history: Json
        }
        Insert: {
          created_at?: string
          cv_filename?: string | null
          cv_fit_score?: number | null
          cv_summary?: string | null
          education?: Json
          headline?: string | null
          id?: string
          location_preferences?: string[]
          name?: string | null
          skills?: Json
          summary?: string | null
          target_geo?: string | null
          target_role?: string | null
          target_role_categories?: string[]
          updated_at?: string
          user_id?: string | null
          work_history?: Json
        }
        Update: {
          created_at?: string
          cv_filename?: string | null
          cv_fit_score?: number | null
          cv_summary?: string | null
          education?: Json
          headline?: string | null
          id?: string
          location_preferences?: string[]
          name?: string | null
          skills?: Json
          summary?: string | null
          target_geo?: string | null
          target_role?: string | null
          target_role_categories?: string[]
          updated_at?: string
          user_id?: string | null
          work_history?: Json
        }
        Relationships: []
      }
      user_radar_snapshots: {
        Row: {
          id: string
          user_id: string | null
          captured_at: string
          source_cv_filename: string | null
          axes: Json
          strengths: Json
          weaknesses: Json
          gaps: Json
        }
        Insert: {
          id?: string
          user_id?: string | null
          captured_at?: string
          source_cv_filename?: string | null
          axes: Json
          strengths: Json
          weaknesses: Json
          gaps: Json
        }
        Update: {
          id?: string
          user_id?: string | null
          captured_at?: string
          source_cv_filename?: string | null
          axes?: Json
          strengths?: Json
          weaknesses?: Json
          gaps?: Json
        }
        Relationships: []
      }
      users: {
        Row: {
          background: string | null
          created_at: string | null
          cv_text: string | null
          email: string | null
          id: string
          name: string | null
          profile_json: Json | null
          target_geo: string | null
          target_role: string | null
        }
        Insert: {
          background?: string | null
          created_at?: string | null
          cv_text?: string | null
          email?: string | null
          id?: string
          name?: string | null
          profile_json?: Json | null
          target_geo?: string | null
          target_role?: string | null
        }
        Update: {
          background?: string | null
          created_at?: string | null
          cv_text?: string | null
          email?: string | null
          id?: string
          name?: string | null
          profile_json?: Json | null
          target_geo?: string | null
          target_role?: string | null
        }
        Relationships: []
      }
      vc_jobs: {
        Row: {
          company: string
          description: string | null
          id: string
          location: string | null
          posted_date: string | null
          requirements: string | null
          role: string
          scraped_at: string | null
          url: string | null
        }
        Insert: {
          company: string
          description?: string | null
          id?: string
          location?: string | null
          posted_date?: string | null
          requirements?: string | null
          role: string
          scraped_at?: string | null
          url?: string | null
        }
        Update: {
          company?: string
          description?: string | null
          id?: string
          location?: string | null
          posted_date?: string | null
          requirements?: string | null
          role?: string
          scraped_at?: string | null
          url?: string | null
        }
        Relationships: []
      }
      vcs: {
        Row: {
          aum_bucket: string | null
          careers_url: string | null
          created_at: string | null
          domain: string
          geography: string | null
          id: string
          name: string
          notes: string | null
          portfolio_companies_url: string | null
          sector_tags: string[] | null
          sources: string[] | null
          stage_focus: string | null
          tier: number | null
          updated_at: string | null
        }
        Insert: {
          aum_bucket?: string | null
          careers_url?: string | null
          created_at?: string | null
          domain: string
          geography?: string | null
          id?: string
          name: string
          notes?: string | null
          portfolio_companies_url?: string | null
          sector_tags?: string[] | null
          sources?: string[] | null
          stage_focus?: string | null
          tier?: number | null
          updated_at?: string | null
        }
        Update: {
          aum_bucket?: string | null
          careers_url?: string | null
          created_at?: string | null
          domain?: string
          geography?: string | null
          id?: string
          name?: string
          notes?: string | null
          portfolio_companies_url?: string | null
          sector_tags?: string[] | null
          sources?: string[] | null
          stage_focus?: string | null
          tier?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      company_news: {
        Row: {
          id: string
          company_name: string
          headline: string
          title_hash: string
          url: string
          summary: string | null
          source: string | null
          published_at: string
          fetched_at: string
          archived_at: string | null
        }
        Insert: {
          id?: string
          company_name: string
          headline: string
          title_hash: string
          url: string
          summary?: string | null
          source?: string | null
          published_at: string
          fetched_at?: string
          archived_at?: string | null
        }
        Update: {
          id?: string
          company_name?: string
          headline?: string
          title_hash?: string
          url?: string
          summary?: string | null
          source?: string | null
          published_at?: string
          fetched_at?: string
          archived_at?: string | null
        }
        Relationships: []
      }
      user_target_companies: {
        Row: {
          user_id: string
          company_name: string
          added_at: string
        }
        Insert: {
          user_id: string
          company_name: string
          added_at?: string
        }
        Update: {
          user_id?: string
          company_name?: string
          added_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      job_level:
        | "intern"
        | "junior"
        | "mid"
        | "senior"
        | "lead"
        | "principal"
        | "executive"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      job_level: [
        "intern",
        "junior",
        "mid",
        "senior",
        "lead",
        "principal",
        "executive",
      ],
    },
  },
} as const
