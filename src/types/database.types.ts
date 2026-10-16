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
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
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
      ai_actions: {
        Row: {
          action_class: string
          conversation_id: string
          created_at: string
          decided_at: string | null
          id: string
          input: Json
          organisation_id: string
          result: Json | null
          status: string
          summary: string | null
          tool_name: string
          user_id: string
        }
        Insert: {
          action_class: string
          conversation_id: string
          created_at?: string
          decided_at?: string | null
          id?: string
          input?: Json
          organisation_id: string
          result?: Json | null
          status: string
          summary?: string | null
          tool_name: string
          user_id: string
        }
        Update: {
          action_class?: string
          conversation_id?: string
          created_at?: string
          decided_at?: string | null
          id?: string
          input?: Json
          organisation_id?: string
          result?: Json | null
          status?: string
          summary?: string | null
          tool_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_actions_conversation_fk"
            columns: ["conversation_id", "organisation_id", "user_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id", "organisation_id", "user_id"]
          },
        ]
      }
      ai_conversations: {
        Row: {
          created_at: string
          id: string
          organisation_id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organisation_id: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organisation_id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          organisation_id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          organisation_id: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          organisation_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_fk"
            columns: ["conversation_id", "organisation_id", "user_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id", "organisation_id", "user_id"]
          },
        ]
      }
      ai_model_prices: {
        Row: {
          cached_input_usd_per_mtok: number | null
          effective_from: string
          effective_to: string | null
          id: string
          input_usd_per_mtok: number
          long_cached_input_usd_per_mtok: number | null
          long_context_threshold_tokens: number | null
          long_input_usd_per_mtok: number | null
          long_output_usd_per_mtok: number | null
          model: string
          output_usd_per_mtok: number
          provider: string
          source_note: string | null
        }
        Insert: {
          cached_input_usd_per_mtok?: number | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          input_usd_per_mtok: number
          long_cached_input_usd_per_mtok?: number | null
          long_context_threshold_tokens?: number | null
          long_input_usd_per_mtok?: number | null
          long_output_usd_per_mtok?: number | null
          model: string
          output_usd_per_mtok: number
          provider: string
          source_note?: string | null
        }
        Update: {
          cached_input_usd_per_mtok?: number | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          input_usd_per_mtok?: number
          long_cached_input_usd_per_mtok?: number | null
          long_context_threshold_tokens?: number | null
          long_input_usd_per_mtok?: number | null
          long_output_usd_per_mtok?: number | null
          model?: string
          output_usd_per_mtok?: number
          provider?: string
          source_note?: string | null
        }
        Relationships: []
      }
      ai_model_routes: {
        Row: {
          enabled: boolean
          max_output_tokens: number
          model: string | null
          provider: string | null
          reasoning_effort: string | null
          tier: string
          timeout_ms: number
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          max_output_tokens?: number
          model?: string | null
          provider?: string | null
          reasoning_effort?: string | null
          tier: string
          timeout_ms?: number
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          max_output_tokens?: number
          model?: string | null
          provider?: string | null
          reasoning_effort?: string | null
          tier?: string
          timeout_ms?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_org_limits: {
        Row: {
          ai_enabled: boolean
          hard_budget_usd: number | null
          monthly_request_limit: number | null
          organisation_id: string
          plan_key: string
          premium_allowed: boolean | null
          soft_budget_usd: number | null
          updated_at: string
          user_rate_limit: number | null
          user_rate_window_seconds: number | null
        }
        Insert: {
          ai_enabled?: boolean
          hard_budget_usd?: number | null
          monthly_request_limit?: number | null
          organisation_id: string
          plan_key?: string
          premium_allowed?: boolean | null
          soft_budget_usd?: number | null
          updated_at?: string
          user_rate_limit?: number | null
          user_rate_window_seconds?: number | null
        }
        Update: {
          ai_enabled?: boolean
          hard_budget_usd?: number | null
          monthly_request_limit?: number | null
          organisation_id?: string
          plan_key?: string
          premium_allowed?: boolean | null
          soft_budget_usd?: number | null
          updated_at?: string
          user_rate_limit?: number | null
          user_rate_window_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_org_limits_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: true
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_org_limits_plan_key_fkey"
            columns: ["plan_key"]
            isOneToOne: false
            referencedRelation: "ai_plans"
            referencedColumns: ["key"]
          },
        ]
      }
      ai_plans: {
        Row: {
          hard_budget_usd: number
          key: string
          label: string
          monthly_request_limit: number
          premium_allowed: boolean
          soft_budget_usd: number
          user_rate_limit: number
          user_rate_window_seconds: number
        }
        Insert: {
          hard_budget_usd: number
          key: string
          label: string
          monthly_request_limit: number
          premium_allowed?: boolean
          soft_budget_usd: number
          user_rate_limit: number
          user_rate_window_seconds: number
        }
        Update: {
          hard_budget_usd?: number
          key?: string
          label?: string
          monthly_request_limit?: number
          premium_allowed?: boolean
          soft_budget_usd?: number
          user_rate_limit?: number
          user_rate_window_seconds?: number
        }
        Relationships: []
      }
      ai_requests: {
        Row: {
          actual_cost_usd: number
          block_reason: string | null
          category: string
          completed_at: string | null
          created_at: string
          id: string
          organisation_id: string
          reserved_usd: number
          status: string
          user_id: string | null
        }
        Insert: {
          actual_cost_usd?: number
          block_reason?: string | null
          category: string
          completed_at?: string | null
          created_at?: string
          id?: string
          organisation_id: string
          reserved_usd?: number
          status: string
          user_id?: string | null
        }
        Update: {
          actual_cost_usd?: number
          block_reason?: string | null
          category?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          organisation_id?: string
          reserved_usd?: number
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_requests_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_events: {
        Row: {
          cached_input_tokens: number
          category: string
          cost_usd: number
          created_at: string
          id: string
          input_tokens: number
          latency_ms: number | null
          model: string
          organisation_id: string
          outcome: string
          output_tokens: number
          provider: string
          reasoning_tokens: number
          request_id: string
          tier: string
          tool_name: string | null
          user_id: string | null
        }
        Insert: {
          cached_input_tokens?: number
          category: string
          cost_usd: number
          created_at?: string
          id?: string
          input_tokens: number
          latency_ms?: number | null
          model: string
          organisation_id: string
          outcome: string
          output_tokens: number
          provider: string
          reasoning_tokens?: number
          request_id: string
          tier: string
          tool_name?: string | null
          user_id?: string | null
        }
        Update: {
          cached_input_tokens?: number
          category?: string
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          model?: string
          organisation_id?: string
          outcome?: string
          output_tokens?: number
          provider?: string
          reasoning_tokens?: number
          request_id?: string
          tier?: string
          tool_name?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_events_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "ai_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_monthly: {
        Row: {
          cost_usd: number
          hard_blocked_at: string | null
          month: string
          organisation_id: string
          request_count: number
          reserved_usd: number
          soft_flagged_at: string | null
          updated_at: string
        }
        Insert: {
          cost_usd?: number
          hard_blocked_at?: string | null
          month: string
          organisation_id: string
          request_count?: number
          reserved_usd?: number
          soft_flagged_at?: string | null
          updated_at?: string
        }
        Update: {
          cost_usd?: number
          hard_blocked_at?: string | null
          month?: string
          organisation_id?: string
          request_count?: number
          reserved_usd?: number
          soft_flagged_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_monthly_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          address: string | null
          contact_id: string | null
          conversation_id: string
          created_at: string
          display_name: string | null
          id: string
          kind: string
          organisation_id: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          contact_id?: string | null
          conversation_id: string
          created_at?: string
          display_name?: string | null
          id?: string
          kind: string
          organisation_id: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          contact_id?: string | null
          conversation_id?: string
          created_at?: string
          display_name?: string | null
          id?: string
          kind?: string
          organisation_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participants_conversation_fk"
            columns: ["conversation_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "organisation_id"]
          },
        ]
      }
      conversation_reads: {
        Row: {
          conversation_id: string
          last_read_at: string
          organisation_id: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_read_at?: string
          organisation_id: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          last_read_at?: string
          organisation_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reads_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          ai_summary: string | null
          ai_summary_at: string | null
          assigned_to: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          invoice_id: string | null
          job_id: string | null
          last_message_at: string | null
          last_message_preview: string | null
          lead_id: string | null
          needs_attention: boolean
          organisation_id: string
          primary_channel: string
          quote_id: string | null
          status: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          ai_summary?: string | null
          ai_summary_at?: string | null
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          invoice_id?: string | null
          job_id?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          lead_id?: string | null
          needs_attention?: boolean
          organisation_id: string
          primary_channel?: string
          quote_id?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          ai_summary?: string | null
          ai_summary_at?: string | null
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          invoice_id?: string | null
          job_id?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          lead_id?: string | null
          needs_attention?: boolean
          organisation_id?: string
          primary_channel?: string
          quote_id?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_customer_fk"
            columns: ["customer_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "conversations_lead_fk"
            columns: ["lead_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "conversations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_addresses: {
        Row: {
          city: string | null
          country: string
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          is_default_billing: boolean
          kind: string
          label: string | null
          line1: string
          line2: string | null
          notes: string | null
          organisation_id: string
          postal_code: string | null
          province: string | null
          suburb: string | null
          updated_at: string
        }
        Insert: {
          city?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          is_default_billing?: boolean
          kind?: string
          label?: string | null
          line1: string
          line2?: string | null
          notes?: string | null
          organisation_id: string
          postal_code?: string | null
          province?: string | null
          suburb?: string | null
          updated_at?: string
        }
        Update: {
          city?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          is_default_billing?: boolean
          kind?: string
          label?: string | null
          line1?: string
          line2?: string | null
          notes?: string | null
          organisation_id?: string
          postal_code?: string | null
          province?: string | null
          suburb?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_customer_fk"
            columns: ["customer_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "customer_addresses_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_contacts: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          email: string | null
          first_name: string
          id: string
          is_primary: boolean
          last_name: string | null
          organisation_id: string
          phone: string | null
          role: string | null
          updated_at: string
          whatsapp_opt_in: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          email?: string | null
          first_name: string
          id?: string
          is_primary?: boolean
          last_name?: string | null
          organisation_id: string
          phone?: string | null
          role?: string | null
          updated_at?: string
          whatsapp_opt_in?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          email?: string | null
          first_name?: string
          id?: string
          is_primary?: boolean
          last_name?: string | null
          organisation_id?: string
          phone?: string | null
          role?: string | null
          updated_at?: string
          whatsapp_opt_in?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "customer_contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_contacts_customer_fk"
            columns: ["customer_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "customer_contacts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          display_name: string
          email: string | null
          email_normalized: string | null
          id: string
          legal_name: string | null
          notes: string | null
          organisation_id: string
          payment_terms_days: number
          phone: string | null
          phone_normalized: string | null
          preferred_channel: string | null
          registration_number: string | null
          source: string
          status: string
          type: string
          updated_at: string
          vat_normalized: string | null
          vat_number: string | null
          website: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          display_name: string
          email?: string | null
          email_normalized?: string | null
          id?: string
          legal_name?: string | null
          notes?: string | null
          organisation_id: string
          payment_terms_days?: number
          phone?: string | null
          phone_normalized?: string | null
          preferred_channel?: string | null
          registration_number?: string | null
          source?: string
          status?: string
          type?: string
          updated_at?: string
          vat_normalized?: string | null
          vat_number?: string | null
          website?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          display_name?: string
          email?: string | null
          email_normalized?: string | null
          id?: string
          legal_name?: string | null
          notes?: string | null
          organisation_id?: string
          payment_terms_days?: number
          phone?: string | null
          phone_normalized?: string | null
          preferred_channel?: string | null
          registration_number?: string | null
          source?: string
          status?: string
          type?: string
          updated_at?: string
          vat_normalized?: string | null
          vat_number?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          doc_type: string
          next_value: number
          organisation_id: string
          pad: number
          prefix: string
          updated_at: string
        }
        Insert: {
          doc_type: string
          next_value?: number
          organisation_id: string
          pad?: number
          prefix: string
          updated_at?: string
        }
        Update: {
          doc_type?: string
          next_value?: number
          organisation_id?: string
          pad?: number
          prefix?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_sequences_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          byte_size: number | null
          created_at: string
          created_by: string | null
          entity_id: string
          entity_type: string
          file_name: string
          id: string
          kind: string
          organisation_id: string
          sha256: string | null
          storage_bucket: string
          storage_path: string
          version: number
        }
        Insert: {
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          entity_id: string
          entity_type: string
          file_name: string
          id?: string
          kind: string
          organisation_id: string
          sha256?: string | null
          storage_bucket?: string
          storage_path: string
          version?: number
        }
        Update: {
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          entity_id?: string
          entity_type?: string
          file_name?: string
          id?: string
          kind?: string
          organisation_id?: string
          sha256?: string | null
          storage_bucket?: string
          storage_path?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          created_at: string
          description: string
          discount_type: string | null
          discount_value: number | null
          id: string
          invoice_id: string
          line_discount: number
          line_subtotal: number
          line_tax: number
          line_total: number
          organisation_id: string
          quantity: number
          sort_order: number
          taxable: boolean
          unit: string | null
          unit_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          discount_type?: string | null
          discount_value?: number | null
          id?: string
          invoice_id: string
          line_discount?: number
          line_subtotal?: number
          line_tax?: number
          line_total?: number
          organisation_id: string
          quantity?: number
          sort_order?: number
          taxable?: boolean
          unit?: string | null
          unit_price?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          discount_type?: string | null
          discount_value?: number | null
          id?: string
          invoice_id?: string
          line_discount?: number
          line_subtotal?: number
          line_tax?: number
          line_total?: number
          organisation_id?: string
          quantity?: number
          sort_order?: number
          taxable?: boolean
          unit?: string | null
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_fk"
            columns: ["invoice_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "organisation_id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_due: number
          amount_paid: number
          archived_at: string | null
          contact_email_snapshot: string | null
          contact_id: string | null
          contact_name_snapshot: string | null
          contact_phone_snapshot: string | null
          created_at: string
          created_by: string | null
          currency: string
          customer_address_snapshot: string | null
          customer_id: string
          customer_name_snapshot: string | null
          customer_registration_snapshot: string | null
          customer_tax_snapshot: string | null
          discount_total: number
          due_date: string | null
          id: string
          invoice_number: string | null
          issue_date: string
          issued_at: string | null
          issued_by: string | null
          job_id: string | null
          notes: string | null
          organisation_id: string
          paid_at: string | null
          payment_details_snapshot: string | null
          prices_include_tax: boolean
          quote_id: string | null
          seller_address_snapshot: string | null
          seller_email_snapshot: string | null
          seller_legal_name_snapshot: string | null
          seller_name_snapshot: string | null
          seller_phone_snapshot: string | null
          seller_registration_snapshot: string | null
          seller_tax_snapshot: string | null
          site_address_id: string | null
          site_address_snapshot: string | null
          status: string
          subtotal: number
          tax_label_snapshot: string
          tax_rate_snapshot: number
          tax_total: number
          terms: string | null
          title: string | null
          total: number
          updated_at: string
          vat_registered_snapshot: boolean
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount_due?: number
          amount_paid?: number
          archived_at?: string | null
          contact_email_snapshot?: string | null
          contact_id?: string | null
          contact_name_snapshot?: string | null
          contact_phone_snapshot?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_address_snapshot?: string | null
          customer_id: string
          customer_name_snapshot?: string | null
          customer_registration_snapshot?: string | null
          customer_tax_snapshot?: string | null
          discount_total?: number
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          issue_date?: string
          issued_at?: string | null
          issued_by?: string | null
          job_id?: string | null
          notes?: string | null
          organisation_id: string
          paid_at?: string | null
          payment_details_snapshot?: string | null
          prices_include_tax?: boolean
          quote_id?: string | null
          seller_address_snapshot?: string | null
          seller_email_snapshot?: string | null
          seller_legal_name_snapshot?: string | null
          seller_name_snapshot?: string | null
          seller_phone_snapshot?: string | null
          seller_registration_snapshot?: string | null
          seller_tax_snapshot?: string | null
          site_address_id?: string | null
          site_address_snapshot?: string | null
          status?: string
          subtotal?: number
          tax_label_snapshot?: string
          tax_rate_snapshot?: number
          tax_total?: number
          terms?: string | null
          title?: string | null
          total?: number
          updated_at?: string
          vat_registered_snapshot?: boolean
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          archived_at?: string | null
          contact_email_snapshot?: string | null
          contact_id?: string | null
          contact_name_snapshot?: string | null
          contact_phone_snapshot?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_address_snapshot?: string | null
          customer_id?: string
          customer_name_snapshot?: string | null
          customer_registration_snapshot?: string | null
          customer_tax_snapshot?: string | null
          discount_total?: number
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          issue_date?: string
          issued_at?: string | null
          issued_by?: string | null
          job_id?: string | null
          notes?: string | null
          organisation_id?: string
          paid_at?: string | null
          payment_details_snapshot?: string | null
          prices_include_tax?: boolean
          quote_id?: string | null
          seller_address_snapshot?: string | null
          seller_email_snapshot?: string | null
          seller_legal_name_snapshot?: string | null
          seller_name_snapshot?: string | null
          seller_phone_snapshot?: string | null
          seller_registration_snapshot?: string | null
          seller_tax_snapshot?: string | null
          site_address_id?: string | null
          site_address_snapshot?: string | null
          status?: string
          subtotal?: number
          tax_label_snapshot?: string
          tax_rate_snapshot?: number
          tax_total?: number
          terms?: string | null
          title?: string | null
          total?: number
          updated_at?: string
          vat_registered_snapshot?: boolean
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_fk"
            columns: ["customer_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "invoices_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_fk"
            columns: ["job_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "invoices_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_quote_fk"
            columns: ["quote_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "invoices_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          job_id: string
          organisation_id: string
          role: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          job_id: string
          organisation_id: string
          role?: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          job_id?: string
          organisation_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignments_job_fk"
            columns: ["job_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "job_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          job_id: string
          organisation_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          job_id: string
          organisation_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          job_id?: string
          organisation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_notes_job_fk"
            columns: ["job_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "organisation_id"]
          },
        ]
      }
      job_photos: {
        Row: {
          byte_size: number | null
          caption: string | null
          category: string
          created_at: string
          height: number | null
          id: string
          job_id: string
          organisation_id: string
          storage_path: string
          taken_at: string | null
          uploaded_by: string | null
          width: number | null
        }
        Insert: {
          byte_size?: number | null
          caption?: string | null
          category?: string
          created_at?: string
          height?: number | null
          id?: string
          job_id: string
          organisation_id: string
          storage_path: string
          taken_at?: string | null
          uploaded_by?: string | null
          width?: number | null
        }
        Update: {
          byte_size?: number | null
          caption?: string | null
          category?: string
          created_at?: string
          height?: number | null
          id?: string
          job_id?: string
          organisation_id?: string
          storage_path?: string
          taken_at?: string | null
          uploaded_by?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "job_photos_job_fk"
            columns: ["job_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "job_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          archived_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          completed_by: string | null
          completion_notes: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          description: string | null
          id: string
          internal_notes: string | null
          job_number: string
          lead_id: string | null
          organisation_id: string
          priority: string
          quote_id: string | null
          scheduled_end: string | null
          scheduled_start: string | null
          site_address_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          actual_end?: string | null
          actual_start?: string | null
          archived_at?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          description?: string | null
          id?: string
          internal_notes?: string | null
          job_number: string
          lead_id?: string | null
          organisation_id: string
          priority?: string
          quote_id?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          site_address_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          actual_end?: string | null
          actual_start?: string | null
          archived_at?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          description?: string | null
          id?: string
          internal_notes?: string | null
          job_number?: string
          lead_id?: string | null
          organisation_id?: string
          priority?: string
          quote_id?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          site_address_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_customer_fk"
            columns: ["customer_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "jobs_lead_fk"
            columns: ["lead_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "jobs_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_quote_fk"
            columns: ["quote_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id", "organisation_id"]
          },
        ]
      }
      leads: {
        Row: {
          archived_at: string | null
          assigned_to: string | null
          company_name: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          email: string | null
          email_normalized: string | null
          estimated_value: number | null
          id: string
          last_activity_at: string
          lost_at: string | null
          lost_reason: string | null
          next_follow_up_at: string | null
          notes: string | null
          organisation_id: string
          person_name: string | null
          phone: string | null
          phone_normalized: string | null
          requested_date: string | null
          service_summary: string | null
          site_address_id: string | null
          site_address_text: string | null
          source: string
          status: string
          title: string
          updated_at: string
          won_at: string | null
        }
        Insert: {
          archived_at?: string | null
          assigned_to?: string | null
          company_name?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          email?: string | null
          email_normalized?: string | null
          estimated_value?: number | null
          id?: string
          last_activity_at?: string
          lost_at?: string | null
          lost_reason?: string | null
          next_follow_up_at?: string | null
          notes?: string | null
          organisation_id: string
          person_name?: string | null
          phone?: string | null
          phone_normalized?: string | null
          requested_date?: string | null
          service_summary?: string | null
          site_address_id?: string | null
          site_address_text?: string | null
          source?: string
          status?: string
          title: string
          updated_at?: string
          won_at?: string | null
        }
        Update: {
          archived_at?: string | null
          assigned_to?: string | null
          company_name?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          email?: string | null
          email_normalized?: string | null
          estimated_value?: number | null
          id?: string
          last_activity_at?: string
          lost_at?: string | null
          lost_reason?: string | null
          next_follow_up_at?: string | null
          notes?: string | null
          organisation_id?: string
          person_name?: string | null
          phone?: string | null
          phone_normalized?: string | null
          requested_date?: string | null
          service_summary?: string | null
          site_address_id?: string | null
          site_address_text?: string | null
          source?: string
          status?: string
          title?: string
          updated_at?: string
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_customer_fk"
            columns: ["customer_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "leads_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          author_user_id: string | null
          body: string
          channel: string
          conversation_id: string
          created_at: string
          direction: string
          external_id: string | null
          id: string
          is_ai_draft: boolean
          kind: string
          metadata: Json
          occurred_at: string
          organisation_id: string
          provider: string | null
          sender_address: string | null
          sender_name: string | null
          status: string
        }
        Insert: {
          author_user_id?: string | null
          body: string
          channel: string
          conversation_id: string
          created_at?: string
          direction: string
          external_id?: string | null
          id?: string
          is_ai_draft?: boolean
          kind?: string
          metadata?: Json
          occurred_at?: string
          organisation_id: string
          provider?: string | null
          sender_address?: string | null
          sender_name?: string | null
          status?: string
        }
        Update: {
          author_user_id?: string | null
          body?: string
          channel?: string
          conversation_id?: string
          created_at?: string
          direction?: string
          external_id?: string | null
          id?: string
          is_ai_draft?: boolean
          kind?: string
          metadata?: Json
          occurred_at?: string
          organisation_id?: string
          provider?: string | null
          sender_address?: string | null
          sender_name?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_fk"
            columns: ["conversation_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "organisation_id"]
          },
        ]
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
      organisation_financial_settings: {
        Row: {
          bank_account_holder: string | null
          bank_account_number: string | null
          bank_account_type: string | null
          bank_branch_code: string | null
          bank_name: string | null
          created_at: string
          default_invoice_terms: string | null
          default_quote_terms: string | null
          invoice_due_days: number
          invoice_due_soon_days: number
          lead_followup_days: number
          organisation_id: string
          prices_include_tax_default: boolean
          quote_followup_days: number
          quote_validity_days: number
          tax_label: string
          tax_rate: number
          updated_at: string
          vat_registered: boolean
        }
        Insert: {
          bank_account_holder?: string | null
          bank_account_number?: string | null
          bank_account_type?: string | null
          bank_branch_code?: string | null
          bank_name?: string | null
          created_at?: string
          default_invoice_terms?: string | null
          default_quote_terms?: string | null
          invoice_due_days?: number
          invoice_due_soon_days?: number
          lead_followup_days?: number
          organisation_id: string
          prices_include_tax_default?: boolean
          quote_followup_days?: number
          quote_validity_days?: number
          tax_label?: string
          tax_rate?: number
          updated_at?: string
          vat_registered?: boolean
        }
        Update: {
          bank_account_holder?: string | null
          bank_account_number?: string | null
          bank_account_type?: string | null
          bank_branch_code?: string | null
          bank_name?: string | null
          created_at?: string
          default_invoice_terms?: string | null
          default_quote_terms?: string | null
          invoice_due_days?: number
          invoice_due_soon_days?: number
          lead_followup_days?: number
          organisation_id?: string
          prices_include_tax_default?: boolean
          quote_followup_days?: number
          quote_validity_days?: number
          tax_label?: string
          tax_rate?: number
          updated_at?: string
          vat_registered?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "organisation_financial_settings_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: true
            referencedRelation: "organisations"
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
          address_line1: string | null
          address_line2: string | null
          city: string | null
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
          postal_code: string | null
          province: string | null
          registration_number: string | null
          suburb: string | null
          tax_number: string | null
          timezone: string
          updated_at: string
          vat_number: string | null
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
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
          postal_code?: string | null
          province?: string | null
          registration_number?: string | null
          suburb?: string | null
          tax_number?: string | null
          timezone?: string
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
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
          postal_code?: string | null
          province?: string | null
          registration_number?: string | null
          suburb?: string | null
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
      payments: {
        Row: {
          amount: number
          created_at: string
          customer_id: string
          id: string
          idempotency_key: string | null
          invoice_id: string
          notes: string | null
          organisation_id: string
          payment_date: string
          payment_method: string
          recorded_by: string | null
          reference: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          customer_id: string
          id?: string
          idempotency_key?: string | null
          invoice_id: string
          notes?: string | null
          organisation_id: string
          payment_date: string
          payment_method: string
          recorded_by?: string | null
          reference?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          customer_id?: string
          id?: string
          idempotency_key?: string | null
          invoice_id?: string
          notes?: string | null
          organisation_id?: string
          payment_date?: string
          payment_method?: string
          recorded_by?: string | null
          reference?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_customer_fk"
            columns: ["customer_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "payments_invoice_fk"
            columns: ["invoice_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          description: string
          key: string
        }
        Insert: {
          description: string
          key: string
        }
        Update: {
          description?: string
          key?: string
        }
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
      quote_items: {
        Row: {
          created_at: string
          description: string
          discount_type: string | null
          discount_value: number | null
          id: string
          line_discount: number
          line_subtotal: number
          line_tax: number
          line_total: number
          organisation_id: string
          quantity: number
          quote_id: string
          sort_order: number
          taxable: boolean
          unit: string | null
          unit_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          discount_type?: string | null
          discount_value?: number | null
          id?: string
          line_discount?: number
          line_subtotal?: number
          line_tax?: number
          line_total?: number
          organisation_id: string
          quantity?: number
          quote_id: string
          sort_order?: number
          taxable?: boolean
          unit?: string | null
          unit_price?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          discount_type?: string | null
          discount_value?: number | null
          id?: string
          line_discount?: number
          line_subtotal?: number
          line_tax?: number
          line_total?: number
          organisation_id?: string
          quantity?: number
          quote_id?: string
          sort_order?: number
          taxable?: boolean
          unit?: string | null
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_quote_fk"
            columns: ["quote_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id", "organisation_id"]
          },
        ]
      }
      quotes: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          accepted_method: string | null
          archived_at: string | null
          contact_email_snapshot: string | null
          contact_id: string | null
          contact_name_snapshot: string | null
          contact_phone_snapshot: string | null
          created_at: string
          created_by: string | null
          currency: string
          customer_address_snapshot: string | null
          customer_id: string
          customer_name_snapshot: string | null
          customer_registration_snapshot: string | null
          customer_tax_snapshot: string | null
          decline_reason: string | null
          declined_at: string | null
          declined_by: string | null
          discount_total: number
          expired_at: string | null
          expiry_date: string | null
          id: string
          issue_date: string
          issued_at: string | null
          lead_id: string | null
          notes: string | null
          organisation_id: string
          prices_include_tax: boolean
          quote_number: string
          revision_of_id: string | null
          seller_address_snapshot: string | null
          seller_email_snapshot: string | null
          seller_legal_name_snapshot: string | null
          seller_name_snapshot: string | null
          seller_phone_snapshot: string | null
          seller_registration_snapshot: string | null
          seller_tax_snapshot: string | null
          sent_method: string | null
          site_address_id: string | null
          site_address_snapshot: string | null
          status: string
          subtotal: number
          tax_label_snapshot: string
          tax_rate_snapshot: number
          tax_total: number
          terms: string | null
          title: string | null
          total: number
          updated_at: string
          vat_registered_snapshot: boolean
          viewed_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          accepted_method?: string | null
          archived_at?: string | null
          contact_email_snapshot?: string | null
          contact_id?: string | null
          contact_name_snapshot?: string | null
          contact_phone_snapshot?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_address_snapshot?: string | null
          customer_id: string
          customer_name_snapshot?: string | null
          customer_registration_snapshot?: string | null
          customer_tax_snapshot?: string | null
          decline_reason?: string | null
          declined_at?: string | null
          declined_by?: string | null
          discount_total?: number
          expired_at?: string | null
          expiry_date?: string | null
          id?: string
          issue_date?: string
          issued_at?: string | null
          lead_id?: string | null
          notes?: string | null
          organisation_id: string
          prices_include_tax?: boolean
          quote_number: string
          revision_of_id?: string | null
          seller_address_snapshot?: string | null
          seller_email_snapshot?: string | null
          seller_legal_name_snapshot?: string | null
          seller_name_snapshot?: string | null
          seller_phone_snapshot?: string | null
          seller_registration_snapshot?: string | null
          seller_tax_snapshot?: string | null
          sent_method?: string | null
          site_address_id?: string | null
          site_address_snapshot?: string | null
          status?: string
          subtotal?: number
          tax_label_snapshot?: string
          tax_rate_snapshot?: number
          tax_total?: number
          terms?: string | null
          title?: string | null
          total?: number
          updated_at?: string
          vat_registered_snapshot?: boolean
          viewed_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          accepted_method?: string | null
          archived_at?: string | null
          contact_email_snapshot?: string | null
          contact_id?: string | null
          contact_name_snapshot?: string | null
          contact_phone_snapshot?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_address_snapshot?: string | null
          customer_id?: string
          customer_name_snapshot?: string | null
          customer_registration_snapshot?: string | null
          customer_tax_snapshot?: string | null
          decline_reason?: string | null
          declined_at?: string | null
          declined_by?: string | null
          discount_total?: number
          expired_at?: string | null
          expiry_date?: string | null
          id?: string
          issue_date?: string
          issued_at?: string | null
          lead_id?: string | null
          notes?: string | null
          organisation_id?: string
          prices_include_tax?: boolean
          quote_number?: string
          revision_of_id?: string | null
          seller_address_snapshot?: string | null
          seller_email_snapshot?: string | null
          seller_legal_name_snapshot?: string | null
          seller_name_snapshot?: string | null
          seller_phone_snapshot?: string | null
          seller_registration_snapshot?: string | null
          seller_tax_snapshot?: string | null
          sent_method?: string | null
          site_address_id?: string | null
          site_address_snapshot?: string | null
          status?: string
          subtotal?: number
          tax_label_snapshot?: string
          tax_rate_snapshot?: number
          tax_total?: number
          terms?: string | null
          title?: string | null
          total?: number
          updated_at?: string
          vat_registered_snapshot?: boolean
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_customer_fk"
            columns: ["customer_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "quotes_declined_by_fkey"
            columns: ["declined_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_lead_fk"
            columns: ["lead_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "organisation_id"]
          },
          {
            foreignKeyName: "quotes_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_revision_of_id_fkey"
            columns: ["revision_of_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission: string
          role: string
        }
        Insert: {
          permission: string
          role: string
        }
        Update: {
          permission?: string
          role?: string
        }
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
        Row: {
          description: string | null
          is_system: boolean
          key: string
          label: string
          rank: number
        }
        Insert: {
          description?: string | null
          is_system?: boolean
          key: string
          label: string
          rank: number
        }
        Update: {
          description?: string | null
          is_system?: boolean
          key?: string
          label?: string
          rank?: number
        }
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
    Views: {
      [_ in never]: never
    }
    Functions: {
      ai_begin_request: {
        Args: {
          p_category: string
          p_est_input_tokens: number
          p_max_output_tokens: number
          p_model: string
          p_organisation_id: string
          p_provider: string
          p_user_id: string
        }
        Returns: Json
      }
      ai_effective_limits: {
        Args: { p_organisation_id: string }
        Returns: {
          ai_enabled: boolean
          hard_budget_usd: number
          monthly_request_limit: number
          plan_key: string
          premium_allowed: boolean
          soft_budget_usd: number
          user_rate_limit: number
          user_rate_window_seconds: number
        }[]
      }
      ai_finish_request: {
        Args: { p_request_id: string; p_status: string }
        Returns: Json
      }
      ai_purge_old_conversations: { Args: { p_days?: number }; Returns: number }
      ai_record_usage: {
        Args: {
          p_cached_input_tokens?: number
          p_input_tokens: number
          p_latency_ms: number
          p_model: string
          p_outcome: string
          p_output_tokens: number
          p_provider: string
          p_reasoning_tokens?: number
          p_request_id: string
          p_tier: string
          p_tool_name: string
        }
        Returns: number
      }
      ai_release_stale_reservations: {
        Args: { p_older_than?: string }
        Returns: number
      }
      ai_usage_summary: { Args: { p_organisation_id: string }; Returns: Json }
      archive_invoice: { Args: { p_invoice_id: string }; Returns: Json }
      convert_lead_to_customer: {
        Args: {
          p_allow_duplicate?: boolean
          p_existing_customer_id?: string
          p_lead_id: string
        }
        Returns: Json
      }
      create_customer: {
        Args: {
          p_address?: Json
          p_contact?: Json
          p_customer: Json
          p_organisation_id: string
        }
        Returns: string
      }
      create_invoice_from_job: { Args: { p_job_id: string }; Returns: Json }
      create_invoice_from_quote: { Args: { p_quote_id: string }; Returns: Json }
      create_job_from_quote: {
        Args: {
          p_quote_id: string
          p_scheduled_end?: string
          p_scheduled_start?: string
          p_title?: string
        }
        Returns: Json
      }
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
      customer_balance: { Args: { p_customer_id: string }; Returns: Json }
      duplicate_quote: { Args: { p_quote_id: string }; Returns: string }
      find_customer_duplicates: {
        Args: {
          p_email?: string
          p_exclude_id?: string
          p_name?: string
          p_organisation_id: string
          p_phone?: string
          p_vat?: string
        }
        Returns: {
          display_name: string
          id: string
          reason: string
          score: number
          status: string
        }[]
      }
      find_schedule_conflicts: {
        Args: {
          p_end: string
          p_exclude_job_id?: string
          p_organisation_id: string
          p_start: string
          p_user_ids: string[]
        }
        Returns: {
          job_id: string
          job_number: string
          scheduled_end: string
          scheduled_start: string
          title: string
          user_id: string
        }[]
      }
      get_field_job: { Args: { p_job_id: string }; Returns: Json }
      get_my_permissions: {
        Args: { p_organisation_id: string }
        Returns: string[]
      }
      global_search: {
        Args: { p_limit?: number; p_organisation_id: string; p_query: string }
        Returns: {
          entity_type: string
          id: string
          rank: number
          status: string
          subtitle: string
          title: string
        }[]
      }
      invoice_effective_status: {
        Args: {
          p_amount_due: number
          p_due: string
          p_status: string
          p_tz?: string
        }
        Returns: string
      }
      issue_invoice: { Args: { p_invoice_id: string }; Returns: Json }
      issue_quote: {
        Args: { p_method?: string; p_quote_id: string }
        Returns: Json
      }
      list_my_jobs: {
        Args: { p_from?: string; p_organisation_id: string; p_to?: string }
        Returns: {
          customer_name: string
          id: string
          job_number: string
          scheduled_end: string
          scheduled_start: string
          site_address: string
          status: string
          title: string
        }[]
      }
      log_communication: {
        Args: {
          p_body: string
          p_conversation_id?: string
          p_customer_id?: string
          p_direction?: string
          p_invoice_id?: string
          p_job_id?: string
          p_kind?: string
          p_lead_id?: string
          p_occurred_at?: string
          p_organisation_id: string
          p_quote_id?: string
          p_subject?: string
        }
        Returns: Json
      }
      mark_notifications_read: {
        Args: { p_ids?: string[]; p_organisation_id: string }
        Returns: number
      }
      quote_effective_status: {
        Args: { p_expiry: string; p_status: string; p_tz?: string }
        Returns: string
      }
      record_payment: {
        Args: {
          p_amount: number
          p_idempotency_key?: string
          p_invoice_id: string
          p_method?: string
          p_notes?: string
          p_payment_date?: string
          p_reference?: string
        }
        Returns: Json
      }
      set_job_status: {
        Args: { p_action: string; p_job_id: string; p_notes?: string }
        Returns: Json
      }
      set_quote_outcome: {
        Args: {
          p_method?: string
          p_outcome: string
          p_quote_id: string
          p_reason?: string
        }
        Returns: Json
      }
      today_summary: { Args: { p_organisation_id: string }; Returns: Json }
      void_invoice: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: Json
      }
      void_payment: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
