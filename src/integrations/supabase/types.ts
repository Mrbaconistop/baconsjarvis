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
      cash_balances: {
        Row: {
          amount_cents: number
          note: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents?: number
          note?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          note?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          created_at: string
          id: string
          parts: Json
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          parts: Json
          role: string
          thread_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          parts?: Json
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      connected_accounts: {
        Row: {
          connected_at: string
          handle: string | null
          id: string
          platform: Database["public"]["Enums"]["social_platform"]
          profile_pic_url: string | null
          status: string
          user_id: string
        }
        Insert: {
          connected_at?: string
          handle?: string | null
          id?: string
          platform: Database["public"]["Enums"]["social_platform"]
          profile_pic_url?: string | null
          status?: string
          user_id: string
        }
        Update: {
          connected_at?: string
          handle?: string | null
          id?: string
          platform?: Database["public"]["Enums"]["social_platform"]
          profile_pic_url?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      custom_tabs: {
        Row: {
          content_html: string
          created_at: string
          description: string | null
          icon: string
          id: string
          label: string
          slug: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          content_html?: string
          created_at?: string
          description?: string | null
          icon?: string
          id?: string
          label: string
          slug: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          content_html?: string
          created_at?: string
          description?: string | null
          icon?: string
          id?: string
          label?: string
          slug?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_checkins: {
        Row: {
          created_at: string
          day: string
          energy: number | null
          height_in: number | null
          id: string
          mood: string | null
          notes: string | null
          sleep_hours: number | null
          user_id: string
          weight_lbs: number | null
        }
        Insert: {
          created_at?: string
          day?: string
          energy?: number | null
          height_in?: number | null
          id?: string
          mood?: string | null
          notes?: string | null
          sleep_hours?: number | null
          user_id: string
          weight_lbs?: number | null
        }
        Update: {
          created_at?: string
          day?: string
          energy?: number | null
          height_in?: number | null
          id?: string
          mood?: string | null
          notes?: string | null
          sleep_hours?: number | null
          user_id?: string
          weight_lbs?: number | null
        }
        Relationships: []
      }
      discord_webhooks: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          include_calendar: boolean
          include_checkin: boolean
          include_email: boolean
          include_reminders: boolean
          include_spending: boolean
          last_sent_at: string | null
          name: string
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          include_calendar?: boolean
          include_checkin?: boolean
          include_email?: boolean
          include_reminders?: boolean
          include_spending?: boolean
          last_sent_at?: string | null
          name?: string
          url: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          include_calendar?: boolean
          include_checkin?: boolean
          include_email?: boolean
          include_reminders?: boolean
          include_spending?: boolean
          last_sent_at?: string | null
          name?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      engagement_stats: {
        Row: {
          engagements: number
          hour_of_day: number
          id: string
          impressions: number
          platform: Database["public"]["Enums"]["social_platform"]
          posts: number
          stat_date: string
          user_id: string
        }
        Insert: {
          engagements?: number
          hour_of_day?: number
          id?: string
          impressions?: number
          platform: Database["public"]["Enums"]["social_platform"]
          posts?: number
          stat_date: string
          user_id: string
        }
        Update: {
          engagements?: number
          hour_of_day?: number
          id?: string
          impressions?: number
          platform?: Database["public"]["Enums"]["social_platform"]
          posts?: number
          stat_date?: string
          user_id?: string
        }
        Relationships: []
      }
      learning_sessions: {
        Row: {
          content: string | null
          created_at: string | null
          id: string
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          id?: string
          title?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string | null
          id?: string
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      map_places: {
        Row: {
          address: string | null
          category: string | null
          color: string | null
          created_at: string
          id: string
          label: string
          lat: number
          lng: number
          notes: string | null
          place_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          category?: string | null
          color?: string | null
          created_at?: string
          id?: string
          label: string
          lat: number
          lng: number
          notes?: string | null
          place_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          category?: string | null
          color?: string | null
          created_at?: string
          id?: string
          label?: string
          lat?: number
          lng?: number
          notes?: string | null
          place_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      message_memory: {
        Row: {
          created_at: string | null
          embedding: string | null
          id: string
          message: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          embedding?: string | null
          id?: string
          message: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          embedding?: string | null
          id?: string
          message?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          action_payload: Json
          created_at: string
          id: string
          message: string
          priority: Database["public"]["Enums"]["priority_level"]
          read_status: boolean
          source_id: string | null
          source_table: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          action_payload?: Json
          created_at?: string
          id?: string
          message: string
          priority?: Database["public"]["Enums"]["priority_level"]
          read_status?: boolean
          source_id?: string | null
          source_table?: string | null
          title: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          action_payload?: Json
          created_at?: string
          id?: string
          message?: string
          priority?: Database["public"]["Enums"]["priority_level"]
          read_status?: boolean
          source_id?: string | null
          source_table?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address_as: string
          avatar_url: string | null
          created_at: string
          email: string | null
          id: string
          name: string | null
          preferred_briefing_time: string
          timezone: string
          updated_at: string
          vault_pin_hash: string | null
        }
        Insert: {
          address_as?: string
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id: string
          name?: string | null
          preferred_briefing_time?: string
          timezone?: string
          updated_at?: string
          vault_pin_hash?: string | null
        }
        Update: {
          address_as?: string
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
          preferred_briefing_time?: string
          timezone?: string
          updated_at?: string
          vault_pin_hash?: string | null
        }
        Relationships: []
      }
      reminders: {
        Row: {
          created_at: string
          datetime: string
          description: string | null
          id: string
          is_completed: boolean
          order: number | null
          priority: Database["public"]["Enums"]["priority_level"]
          recurrence: string | null
          source_ref: string | null
          source_type: string | null
          status: string | null
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          datetime: string
          description?: string | null
          id?: string
          is_completed?: boolean
          order?: number | null
          priority?: Database["public"]["Enums"]["priority_level"]
          recurrence?: string | null
          source_ref?: string | null
          source_type?: string | null
          status?: string | null
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          datetime?: string
          description?: string | null
          id?: string
          is_completed?: boolean
          order?: number | null
          priority?: Database["public"]["Enums"]["priority_level"]
          recurrence?: string | null
          source_ref?: string | null
          source_type?: string | null
          status?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      social_feeds: {
        Row: {
          author_avatar: string | null
          author_handle: string | null
          author_name: string
          content: string
          external_id: string | null
          id: string
          is_actionable: boolean
          is_handled: boolean
          parent_post_id: string | null
          platform: Database["public"]["Enums"]["social_platform"]
          priority: Database["public"]["Enums"]["priority_level"]
          received_at: string
          sentiment_label: Database["public"]["Enums"]["sentiment_label"] | null
          sentiment_score: number | null
          url: string | null
          user_id: string
        }
        Insert: {
          author_avatar?: string | null
          author_handle?: string | null
          author_name: string
          content: string
          external_id?: string | null
          id?: string
          is_actionable?: boolean
          is_handled?: boolean
          parent_post_id?: string | null
          platform: Database["public"]["Enums"]["social_platform"]
          priority?: Database["public"]["Enums"]["priority_level"]
          received_at?: string
          sentiment_label?:
            | Database["public"]["Enums"]["sentiment_label"]
            | null
          sentiment_score?: number | null
          url?: string | null
          user_id: string
        }
        Update: {
          author_avatar?: string | null
          author_handle?: string | null
          author_name?: string
          content?: string
          external_id?: string | null
          id?: string
          is_actionable?: boolean
          is_handled?: boolean
          parent_post_id?: string | null
          platform?: Database["public"]["Enums"]["social_platform"]
          priority?: Database["public"]["Enums"]["priority_level"]
          received_at?: string
          sentiment_label?:
            | Database["public"]["Enums"]["sentiment_label"]
            | null
          sentiment_score?: number | null
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      stock_holdings: {
        Row: {
          avg_cost_cents: number | null
          created_at: string
          id: string
          last_price_at: string | null
          last_price_cents: number | null
          note: string | null
          shares: number
          ticker: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_cost_cents?: number | null
          created_at?: string
          id?: string
          last_price_at?: string | null
          last_price_cents?: number | null
          note?: string | null
          shares?: number
          ticker: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_cost_cents?: number | null
          created_at?: string
          id?: string
          last_price_at?: string | null
          last_price_cents?: number | null
          note?: string | null
          shares?: number
          ticker?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount_cents: number
          category: string
          created_at: string
          currency: string
          external_id: string | null
          id: string
          merchant: string | null
          note: string | null
          occurred_at: string
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          category?: string
          created_at?: string
          currency?: string
          external_id?: string | null
          id?: string
          merchant?: string | null
          note?: string | null
          occurred_at?: string
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          category?: string
          created_at?: string
          currency?: string
          external_id?: string | null
          id?: string
          merchant?: string | null
          note?: string | null
          occurred_at?: string
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_facts: {
        Row: {
          category: string
          created_at: string
          id: string
          key: string
          updated_at: string
          user_id: string
          value: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          user_id: string
          value: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vault_items: {
        Row: {
          created_at: string
          data: Json
          id: string
          kind: Database["public"]["Enums"]["vault_kind"]
          label: string
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          id?: string
          kind: Database["public"]["Enums"]["vault_kind"]
          label: string
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          kind?: Database["public"]["Enums"]["vault_kind"]
          label?: string
          tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      match_memory: {
        Args: { match_count?: number; query_embedding: string; user_id: string }
        Returns: {
          created_at: string
          id: string
          message: string
          role: string
          similarity: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "user"
      notification_type: "alert" | "update" | "warning" | "briefing"
      priority_level: "critical" | "high" | "normal" | "low"
      sentiment_label: "positive" | "neutral" | "negative"
      social_platform:
        | "twitter"
        | "linkedin"
        | "instagram"
        | "facebook"
        | "gmail"
        | "calendar"
      vault_kind: "credential" | "note" | "contact"
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
      app_role: ["admin", "user"],
      notification_type: ["alert", "update", "warning", "briefing"],
      priority_level: ["critical", "high", "normal", "low"],
      sentiment_label: ["positive", "neutral", "negative"],
      social_platform: [
        "twitter",
        "linkedin",
        "instagram",
        "facebook",
        "gmail",
        "calendar",
      ],
      vault_kind: ["credential", "note", "contact"],
    },
  },
} as const
