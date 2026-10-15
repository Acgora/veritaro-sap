// AUTO-GENERATED from Supabase project zqibpgbbchypqqyopxoh. Do not edit by hand.
// Regenerate: npx supabase gen types typescript --project-id zqibpgbbchypqqyopxoh > src/types/database.types.ts
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          actor_type: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
          organisation_id: string
        }
        Insert: {
          action: string
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          organisation_id: string
        }
        Update: {
          action?: string
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          organisation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          id: string
          organisation_id: string
          type: string
          display_name: string
          legal_name: string | null
          registration_number: string | null
          vat_number: string | null
          email: string | null
          phone: string | null
          website: string | null
          payment_terms_days: number
          preferred_channel: string | null
          notes: string | null
          status: string
          source: string
          email_normalized: string | null
          phone_normalized: string | null
          vat_normalized: string | null
          archived_at: string | null
          archived_by: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          type?: string
          display_name: string
          legal_name?: string | null
          registration_number?: string | null
          vat_number?: string | null
          email?: string | null
          phone?: string | null
          website?: string | null
          payment_terms_days?: number
          preferred_channel?: string | null
          notes?: string | null
          status?: string
          source?: string
          archived_at?: string | null
          archived_by?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          type?: string
          display_name?: string
          legal_name?: string | null
          registration_number?: string | null
          vat_number?: string | null
          email?: string | null
          phone?: string | null
          website?: string | null
          payment_terms_days?: number
          preferred_channel?: string | null
          notes?: string | null
          status?: string
          source?: string
          archived_at?: string | null
          archived_by?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "customers_organisation_id_fkey"; columns: ["organisation_id"]; isOneToOne: false; referencedRelation: "organisations"; referencedColumns: ["id"] },
          { foreignKeyName: "customers_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      customer_contacts: {
        Row: {
          id: string
          organisation_id: string
          customer_id: string
          first_name: string
          last_name: string | null
          role: string | null
          email: string | null
          phone: string | null
          whatsapp_opt_in: boolean
          is_primary: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          customer_id: string
          first_name: string
          last_name?: string | null
          role?: string | null
          email?: string | null
          phone?: string | null
          whatsapp_opt_in?: boolean
          is_primary?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          first_name?: string
          last_name?: string | null
          role?: string | null
          email?: string | null
          phone?: string | null
          whatsapp_opt_in?: boolean
          is_primary?: boolean
        }
        Relationships: [
          { foreignKeyName: "customer_contacts_customer_fk"; columns: ["customer_id", "organisation_id"]; isOneToOne: false; referencedRelation: "customers"; referencedColumns: ["id", "organisation_id"] },
        ]
      }
      customer_addresses: {
        Row: {
          id: string
          organisation_id: string
          customer_id: string
          kind: string
          label: string | null
          line1: string
          line2: string | null
          suburb: string | null
          city: string | null
          province: string | null
          postal_code: string | null
          country: string
          notes: string | null
          is_default_billing: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          customer_id: string
          kind?: string
          label?: string | null
          line1: string
          line2?: string | null
          suburb?: string | null
          city?: string | null
          province?: string | null
          postal_code?: string | null
          country?: string
          notes?: string | null
          is_default_billing?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          kind?: string
          label?: string | null
          line1?: string
          line2?: string | null
          suburb?: string | null
          city?: string | null
          province?: string | null
          postal_code?: string | null
          country?: string
          notes?: string | null
          is_default_billing?: boolean
        }
        Relationships: [
          { foreignKeyName: "customer_addresses_customer_fk"; columns: ["customer_id", "organisation_id"]; isOneToOne: false; referencedRelation: "customers"; referencedColumns: ["id", "organisation_id"] },
        ]
      }
      ai_conversations: {
        Row: { id: string; organisation_id: string; user_id: string; title: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organisation_id: string; user_id: string; title?: string | null; created_at?: string; updated_at?: string }
        Update: { title?: string | null; updated_at?: string }
        Relationships: []
      }
      ai_messages: {
        Row: { id: string; organisation_id: string; user_id: string; conversation_id: string; role: string; content: string; created_at: string }
        Insert: { id?: string; organisation_id: string; user_id: string; conversation_id: string; role: string; content: string; created_at?: string }
        Update: { content?: string }
        Relationships: []
      }
      ai_actions: {
        Row: {
          id: string; organisation_id: string; user_id: string; conversation_id: string; tool_name: string
          action_class: string; input: Json; summary: string | null; status: string; result: Json | null
          created_at: string; decided_at: string | null
        }
        Insert: {
          id?: string; organisation_id: string; user_id: string; conversation_id: string; tool_name: string
          action_class: string; input?: Json; summary?: string | null; status: string; result?: Json | null
          created_at?: string; decided_at?: string | null
        }
        Update: { status?: string; result?: Json | null; decided_at?: string | null }
        Relationships: []
      }
      ai_model_routes: {
        Row: { tier: string; provider: string | null; model: string | null; enabled: boolean; max_output_tokens: number; timeout_ms: number; reasoning_effort: string | null; updated_at: string }
        Insert: { tier: string; provider?: string | null; model?: string | null; enabled?: boolean; max_output_tokens?: number; timeout_ms?: number; reasoning_effort?: string | null; updated_at?: string }
        Update: { provider?: string | null; model?: string | null; enabled?: boolean; max_output_tokens?: number; timeout_ms?: number; reasoning_effort?: string | null; updated_at?: string }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          message: string | null
          organisation_id: string
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message?: string | null
          organisation_id: string
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message?: string | null
          organisation_id?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_members: {
        Row: {
          created_at: string
          id: string
          organisation_id: string
          role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organisation_id: string
          role: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organisation_id?: string
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_members_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_members_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "organisation_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_settings: {
        Row: {
          created_at: string
          organisation_id: string
          settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          organisation_id: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          organisation_id?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_settings_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: true
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations: {
        Row: {
          country: string
          created_at: string
          created_by: string | null
          currency: string
          email: string | null
          financial_year_end_month: number
          id: string
          legal_name: string | null
          logo_url: string | null
          name: string
          phone: string | null
          registration_number: string | null
          tax_number: string | null
          timezone: string
          updated_at: string
          vat_number: string | null
          website: string | null
        }
        Insert: {
          country?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          email?: string | null
          financial_year_end_month?: number
          id?: string
          legal_name?: string | null
          logo_url?: string | null
          name: string
          phone?: string | null
          registration_number?: string | null
          tax_number?: string | null
          timezone?: string
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Update: {
          country?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          email?: string | null
          financial_year_end_month?: number
          id?: string
          legal_name?: string | null
          logo_url?: string | null
          name?: string
          phone?: string | null
          registration_number?: string | null
          tax_number?: string | null
          timezone?: string
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organisations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: { description: string; key: string }
        Insert: { description: string; key: string }
        Update: { description?: string; key?: string }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          first_name: string | null
          id: string
          last_name: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: { permission: string; role: string }
        Insert: { permission: string; role: string }
        Update: { permission?: string; role?: string }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_fkey"
            columns: ["permission"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "role_permissions_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
        ]
      }
      roles: {
        Row: { description: string | null; is_system: boolean; key: string; label: string; rank: number }
        Insert: { description?: string | null; is_system?: boolean; key: string; label: string; rank: number }
        Update: { description?: string | null; is_system?: boolean; key?: string; label?: string; rank?: number }
        Relationships: []
      }
      tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          id: string
          organisation_id: string
          priority: string
          related_entity_id: string | null
          related_entity_type: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          organisation_id: string
          priority?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          organisation_id?: string
          priority?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      create_customer: {
        Args: { p_organisation_id: string; p_customer: Json; p_contact?: Json; p_address?: Json }
        Returns: string
      }
      find_customer_duplicates: {
        Args: { p_organisation_id: string; p_name?: string; p_email?: string; p_phone?: string; p_vat?: string; p_exclude_id?: string }
        Returns: { id: string; display_name: string; status: string; reason: string; score: number }[]
      }
      ai_usage_summary: { Args: { p_organisation_id: string }; Returns: Json }
      ai_begin_request: {
        Args: {
          p_organisation_id: string; p_user_id: string; p_provider: string; p_model: string
          p_category: string; p_est_input_tokens: number; p_max_output_tokens: number
        }
        Returns: Json
      }
      ai_record_usage: {
        Args: {
          p_request_id: string; p_provider: string; p_model: string; p_tier: string; p_tool_name: string | null
          p_input_tokens: number; p_output_tokens: number; p_latency_ms: number; p_outcome: string
          p_cached_input_tokens?: number; p_reasoning_tokens?: number
        }
        Returns: number
      }
      ai_finish_request: { Args: { p_request_id: string; p_status: string }; Returns: Json }
      create_organisation: {
        Args: {
          p_country?: string
          p_currency?: string
          p_legal_name?: string
          p_name: string
          p_registration_number?: string
          p_tax_number?: string
          p_timezone?: string
          p_vat_number?: string
        }
        Returns: string
      }
      get_my_permissions: { Args: { p_organisation_id: string }; Returns: string[] }
      mark_notifications_read: { Args: { p_ids?: string[]; p_organisation_id: string }; Returns: number }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

type PublicSchema = Database["public"]
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
