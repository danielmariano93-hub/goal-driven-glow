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
      account_balance_snapshots: {
        Row: {
          account_id: string
          balance: number
          balance_date: string
          created_at: string
          id: string
          reconciliation: Json
          source: string
          source_document_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          balance: number
          balance_date: string
          created_at?: string
          id?: string
          reconciliation?: Json
          source?: string
          source_document_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          balance?: number
          balance_date?: string
          created_at?: string
          id?: string
          reconciliation?: Json
          source?: string
          source_document_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_balance_snapshots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_balance_snapshots_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "document_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_balance_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "account_balance_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      account_deletion_requests: {
        Row: {
          admin_notes: string | null
          cancelled_at: string | null
          grace_period_ends_at: string | null
          id: string
          processed_at: string | null
          processed_by: string | null
          reason: string | null
          requested_at: string
          status: Database["public"]["Enums"]["deletion_status"]
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          cancelled_at?: string | null
          grace_period_ends_at?: string | null
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["deletion_status"]
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          cancelled_at?: string | null
          grace_period_ends_at?: string | null
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["deletion_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_deletion_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "account_deletion_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      accounts: {
        Row: {
          active: boolean
          created_at: string
          id: string
          institution: string | null
          name: string
          opening_balance: number
          type: Database["public"]["Enums"]["account_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          institution?: string | null
          name: string
          opening_balance?: number
          type?: Database["public"]["Enums"]["account_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          institution?: string | null
          name?: string
          opening_balance?: number
          type?: Database["public"]["Enums"]["account_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      admin_action_rate: {
        Row: {
          action: string
          actor_id: string
          count: number
          window_start: string
        }
        Insert: {
          action: string
          actor_id: string
          count?: number
          window_start?: string
        }
        Update: {
          action?: string
          actor_id?: string
          count?: number
          window_start?: string
        }
        Relationships: []
      }
      admin_configuration_audit: {
        Row: {
          action: string
          actor_id: string | null
          after_json: Json | null
          before_json: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_json?: Json | null
          before_json?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: never
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_json?: Json | null
          before_json?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "admin_configuration_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_configuration_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      admin_grants_audit: {
        Row: {
          granted_at: string
          granted_by: string
          id: string
          notes: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by: string
          id?: string
          notes?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string
          id?: string
          notes?: string | null
          user_id?: string
        }
        Relationships: []
      }
      admin_reauth_events: {
        Row: {
          admin_id: string
          created_at: string
          id: string
          method: string
        }
        Insert: {
          admin_id: string
          created_at?: string
          id?: string
          method: string
        }
        Update: {
          admin_id?: string
          created_at?: string
          id?: string
          method?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_reauth_events_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_reauth_events_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      advisor_reviews: {
        Row: {
          actions: Json
          formula_version: string
          generated_at: string
          id: string
          last_generated_at: string
          period_end: string
          period_kind: string
          period_start: string
          status: string
          summary: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          actions?: Json
          formula_version?: string
          generated_at?: string
          id?: string
          last_generated_at?: string
          period_end: string
          period_kind: string
          period_start: string
          status?: string
          summary?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          actions?: Json
          formula_version?: string
          generated_at?: string
          id?: string
          last_generated_at?: string
          period_end?: string
          period_kind?: string
          period_start?: string
          status?: string
          summary?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "advisor_reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "advisor_reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      agent_artifacts: {
        Row: {
          conversation_id: string | null
          created_at: string
          delivered_at: string | null
          delivery_status: string | null
          fallback_text: string | null
          formula_version: string | null
          id: string
          kind: string
          media_expires_at: string | null
          media_mime: string | null
          media_path: string | null
          media_url: string | null
          payload: Json
          rendered_at: string | null
          summary_text: string | null
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_status?: string | null
          fallback_text?: string | null
          formula_version?: string | null
          id?: string
          kind: string
          media_expires_at?: string | null
          media_mime?: string | null
          media_path?: string | null
          media_url?: string | null
          payload: Json
          rendered_at?: string | null
          summary_text?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_status?: string | null
          fallback_text?: string | null
          formula_version?: string | null
          id?: string
          kind?: string
          media_expires_at?: string | null
          media_mime?: string | null
          media_path?: string | null
          media_url?: string | null
          payload?: Json
          rendered_at?: string | null
          summary_text?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_artifacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "agent_artifacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      agent_decisions: {
        Row: {
          channel: string | null
          conversation_id: string | null
          created_at: string
          duration_ms: number | null
          error: string | null
          fallback_used: boolean
          id: string
          intent: string | null
          metrics: Json
          planned_steps: Json
          policy_decision: string | null
          run_id: string | null
          tool_calls: Json
          user_id: string
          validations: Json
        }
        Insert: {
          channel?: string | null
          conversation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          fallback_used?: boolean
          id?: string
          intent?: string | null
          metrics?: Json
          planned_steps?: Json
          policy_decision?: string | null
          run_id?: string | null
          tool_calls?: Json
          user_id: string
          validations?: Json
        }
        Update: {
          channel?: string | null
          conversation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          fallback_used?: boolean
          id?: string
          intent?: string | null
          metrics?: Json
          planned_steps?: Json
          policy_decision?: string | null
          run_id?: string | null
          tool_calls?: Json
          user_id?: string
          validations?: Json
        }
        Relationships: [
          {
            foreignKeyName: "agent_decisions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_knowledge_entries: {
        Row: {
          active: boolean
          category: string
          content: string
          created_at: string
          id: string
          key: string
          source_url: string | null
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          active?: boolean
          category?: string
          content: string
          created_at?: string
          id?: string
          key: string
          source_url?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          active?: boolean
          category?: string
          content?: string
          created_at?: string
          id?: string
          key?: string
          source_url?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_knowledge_entries_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "agent_knowledge_entries_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      agent_memory: {
        Row: {
          confidence: number
          created_at: string
          expires_at: string | null
          id: string
          key: string
          kind: string
          last_used_at: string | null
          source: string
          updated_at: string
          use_count: number
          user_id: string
          value: Json
          visibility: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          key: string
          kind: string
          last_used_at?: string | null
          source?: string
          updated_at?: string
          use_count?: number
          user_id: string
          value?: Json
          visibility?: string
        }
        Update: {
          confidence?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          key?: string
          kind?: string
          last_used_at?: string | null
          source?: string
          updated_at?: string
          use_count?: number
          user_id?: string
          value?: Json
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_memory_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "agent_memory_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      agent_metrics_daily: {
        Row: {
          cost_cents: number
          day: string
          latency_ms_p50: number | null
          latency_ms_p95: number | null
          runs: number
          runs_error: number
          runs_ok: number
          surface: string
          tokens_in: number
          tokens_out: number
          updated_at: string
        }
        Insert: {
          cost_cents?: number
          day: string
          latency_ms_p50?: number | null
          latency_ms_p95?: number | null
          runs?: number
          runs_error?: number
          runs_ok?: number
          surface: string
          tokens_in?: number
          tokens_out?: number
          updated_at?: string
        }
        Update: {
          cost_cents?: number
          day?: string
          latency_ms_p50?: number | null
          latency_ms_p95?: number | null
          runs?: number
          runs_error?: number
          runs_ok?: number
          surface?: string
          tokens_in?: number
          tokens_out?: number
          updated_at?: string
        }
        Relationships: []
      }
      agent_prompt_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          max_steps: number
          model: string
          notes: string | null
          parent_version_id: string | null
          published_at: string | null
          published_by: string | null
          restored_from_id: string | null
          status: Database["public"]["Enums"]["prompt_status"]
          structured_config: Json
          system_prompt: string
          temperature: number
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          max_steps?: number
          model?: string
          notes?: string | null
          parent_version_id?: string | null
          published_at?: string | null
          published_by?: string | null
          restored_from_id?: string | null
          status?: Database["public"]["Enums"]["prompt_status"]
          structured_config?: Json
          system_prompt: string
          temperature?: number
          updated_at?: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          max_steps?: number
          model?: string
          notes?: string | null
          parent_version_id?: string | null
          published_at?: string | null
          published_by?: string | null
          restored_from_id?: string | null
          status?: Database["public"]["Enums"]["prompt_status"]
          structured_config?: Json
          system_prompt?: string
          temperature?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_prompt_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "agent_prompt_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "agent_prompt_versions_parent_version_id_fkey"
            columns: ["parent_version_id"]
            isOneToOne: false
            referencedRelation: "agent_prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_prompt_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "agent_prompt_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "agent_prompt_versions_restored_from_id_fkey"
            columns: ["restored_from_id"]
            isOneToOne: false
            referencedRelation: "agent_prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          capability: string | null
          conversation_id: string | null
          cost_cents: number
          ended_at: string | null
          error_masked: string | null
          error_sanitized: string | null
          formula_versions: Json | null
          id: string
          intent_requested: string | null
          intent_served: string | null
          latency_ms: number | null
          model: string | null
          model_attempts: Json
          path: string | null
          prompt_version_id: string | null
          started_at: string
          status: Database["public"]["Enums"]["run_status"]
          steps: number
          tokens_in: number
          tokens_out: number
          tool_scope: string[]
          tools_used: string[] | null
          user_id: string
        }
        Insert: {
          capability?: string | null
          conversation_id?: string | null
          cost_cents?: number
          ended_at?: string | null
          error_masked?: string | null
          error_sanitized?: string | null
          formula_versions?: Json | null
          id?: string
          intent_requested?: string | null
          intent_served?: string | null
          latency_ms?: number | null
          model?: string | null
          model_attempts?: Json
          path?: string | null
          prompt_version_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          steps?: number
          tokens_in?: number
          tokens_out?: number
          tool_scope?: string[]
          tools_used?: string[] | null
          user_id: string
        }
        Update: {
          capability?: string | null
          conversation_id?: string | null
          cost_cents?: number
          ended_at?: string | null
          error_masked?: string | null
          error_sanitized?: string | null
          formula_versions?: Json | null
          id?: string
          intent_requested?: string | null
          intent_served?: string | null
          latency_ms?: number | null
          model?: string | null
          model_attempts?: Json
          path?: string | null
          prompt_version_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          steps?: number
          tokens_in?: number
          tokens_out?: number
          tool_scope?: string[]
          tools_used?: string[] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "agent_prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "agent_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      agent_sessions: {
        Row: {
          channel: string
          conversation_id: string
          created_at: string
          expires_at: string
          id: string
          last_activity_at: string
          state: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          conversation_id: string
          created_at?: string
          expires_at?: string
          id?: string
          last_activity_at?: string
          state?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          conversation_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_activity_at?: string
          state?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "agent_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      agent_settings: {
        Row: {
          anticipation_dry_run: boolean
          anticipation_enabled: boolean
          anticipation_rollout_pct: number
          anticipation_rollout_user_ids: string[]
          default_proactivity: string | null
          default_retention_days: number | null
          default_technical_level: string | null
          id: number
          last_tick_at: string | null
          last_tick_duration_ms: number | null
          last_tick_errors: Json
          last_tick_users: number | null
          max_steps: number
          model: string
          next_tick_at: string | null
          proactive_channels: string[]
          proactive_enabled: boolean
          proactive_rollout_user_ids: string[]
          temperature: number
          timeout_ms: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          anticipation_dry_run?: boolean
          anticipation_enabled?: boolean
          anticipation_rollout_pct?: number
          anticipation_rollout_user_ids?: string[]
          default_proactivity?: string | null
          default_retention_days?: number | null
          default_technical_level?: string | null
          id?: number
          last_tick_at?: string | null
          last_tick_duration_ms?: number | null
          last_tick_errors?: Json
          last_tick_users?: number | null
          max_steps?: number
          model?: string
          next_tick_at?: string | null
          proactive_channels?: string[]
          proactive_enabled?: boolean
          proactive_rollout_user_ids?: string[]
          temperature?: number
          timeout_ms?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          anticipation_dry_run?: boolean
          anticipation_enabled?: boolean
          anticipation_rollout_pct?: number
          anticipation_rollout_user_ids?: string[]
          default_proactivity?: string | null
          default_retention_days?: number | null
          default_technical_level?: string | null
          id?: number
          last_tick_at?: string | null
          last_tick_duration_ms?: number | null
          last_tick_errors?: Json
          last_tick_users?: number | null
          max_steps?: number
          model?: string
          next_tick_at?: string | null
          proactive_channels?: string[]
          proactive_enabled?: boolean
          proactive_rollout_user_ids?: string[]
          temperature?: number
          timeout_ms?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "agent_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      agent_steps: {
        Row: {
          args_hash: string | null
          created_at: string
          id: string
          idx: number
          kind: string
          name: string | null
          result_hash: string | null
          run_id: string
          tokens: number | null
        }
        Insert: {
          args_hash?: string | null
          created_at?: string
          id?: string
          idx: number
          kind: string
          name?: string | null
          result_hash?: string | null
          run_id: string
          tokens?: number | null
        }
        Update: {
          args_hash?: string | null
          created_at?: string
          id?: string
          idx?: number
          kind?: string
          name?: string | null
          result_hash?: string | null
          run_id?: string
          tokens?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tool_calls: {
        Row: {
          args: Json
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          ok: boolean
          result: Json | null
          run_id: string
          step_index: number
          tool_name: string
        }
        Insert: {
          args?: Json
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          ok?: boolean
          result?: Json | null
          run_id: string
          step_index: number
          tool_name: string
        }
        Update: {
          args?: Json
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          ok?: boolean
          result?: Json | null
          run_id?: string
          step_index?: number
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tool_calls_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_turn_events: {
        Row: {
          artifact_id: string | null
          artifact_status: string
          capability: string | null
          channel: string
          conversation_id: string | null
          created_at: string
          error: string | null
          estimated_cost_usd: number | null
          fallback_used: boolean
          formula_versions: Json
          id: string
          intent: string | null
          model: string | null
          model_attempts: Json
          run_id: string | null
          stages_ms: Json
          tokens_in: number
          tokens_out: number
          tool_scope: string[]
          tools_used: Json
          user_id: string
        }
        Insert: {
          artifact_id?: string | null
          artifact_status?: string
          capability?: string | null
          channel: string
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          estimated_cost_usd?: number | null
          fallback_used?: boolean
          formula_versions?: Json
          id?: string
          intent?: string | null
          model?: string | null
          model_attempts?: Json
          run_id?: string | null
          stages_ms?: Json
          tokens_in?: number
          tokens_out?: number
          tool_scope?: string[]
          tools_used?: Json
          user_id: string
        }
        Update: {
          artifact_id?: string | null
          artifact_status?: string
          capability?: string | null
          channel?: string
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          estimated_cost_usd?: number | null
          fallback_used?: boolean
          formula_versions?: Json
          id?: string
          intent?: string | null
          model?: string | null
          model_attempts?: Json
          run_id?: string | null
          stages_ms?: Json
          tokens_in?: number
          tokens_out?: number
          tool_scope?: string[]
          tools_used?: Json
          user_id?: string
        }
        Relationships: []
      }
      ai_model_routes: {
        Row: {
          active: boolean
          fallback_model: string | null
          max_latency_ms: number
          max_steps: number
          primary_model: string
          task: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          fallback_model?: string | null
          max_latency_ms?: number
          max_steps?: number
          primary_model: string
          task: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          fallback_model?: string | null
          max_latency_ms?: number
          max_steps?: number
          primary_model?: string
          task?: string
          updated_at?: string
        }
        Relationships: []
      }
      anticipation_detector_config: {
        Row: {
          active: boolean
          created_at: string
          detector: string
          kind: string
          lead_time_hours: number
          min_absolute_delta: number
          min_confidence: number
          min_coverage: number
          min_hit_rate: number
          min_sample: number
          min_uplift_pct: number
          min_utility_score: number
          min_window_days: number
          notes: string | null
          updated_at: string
          version: string
          window_hours: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          detector: string
          kind: string
          lead_time_hours?: number
          min_absolute_delta?: number
          min_confidence?: number
          min_coverage?: number
          min_hit_rate?: number
          min_sample?: number
          min_uplift_pct?: number
          min_utility_score?: number
          min_window_days?: number
          notes?: string | null
          updated_at?: string
          version?: string
          window_hours?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          detector?: string
          kind?: string
          lead_time_hours?: number
          min_absolute_delta?: number
          min_confidence?: number
          min_coverage?: number
          min_hit_rate?: number
          min_sample?: number
          min_uplift_pct?: number
          min_utility_score?: number
          min_window_days?: number
          notes?: string | null
          updated_at?: string
          version?: string
          window_hours?: number
        }
        Relationships: []
      }
      anticipation_opportunities: {
        Row: {
          action: Json | null
          baseline_value: number
          body: string
          channel_target: string
          confidence: number
          created_at: string
          dedup_key: string
          detector: string
          dispatched_at: string | null
          dry_run: boolean
          eligible_from: string
          evidence: Json
          expected_value: number
          id: string
          kind: string
          logical_dedup_key: string
          opportunity_date: string
          optimal_send_at: string | null
          pattern_id: string | null
          severity: string
          stale_policy: string
          status: string
          suppress_reason: string | null
          timezone: string
          title: string
          updated_at: string
          user_id: string
          utility_breakdown: Json
          utility_score: number
          window_end: string
          window_start: string
        }
        Insert: {
          action?: Json | null
          baseline_value?: number
          body: string
          channel_target?: string
          confidence?: number
          created_at?: string
          dedup_key: string
          detector: string
          dispatched_at?: string | null
          dry_run?: boolean
          eligible_from: string
          evidence?: Json
          expected_value?: number
          id?: string
          kind: string
          logical_dedup_key: string
          opportunity_date: string
          optimal_send_at?: string | null
          pattern_id?: string | null
          severity?: string
          stale_policy?: string
          status?: string
          suppress_reason?: string | null
          timezone?: string
          title: string
          updated_at?: string
          user_id: string
          utility_breakdown?: Json
          utility_score?: number
          window_end: string
          window_start: string
        }
        Update: {
          action?: Json | null
          baseline_value?: number
          body?: string
          channel_target?: string
          confidence?: number
          created_at?: string
          dedup_key?: string
          detector?: string
          dispatched_at?: string | null
          dry_run?: boolean
          eligible_from?: string
          evidence?: Json
          expected_value?: number
          id?: string
          kind?: string
          logical_dedup_key?: string
          opportunity_date?: string
          optimal_send_at?: string | null
          pattern_id?: string | null
          severity?: string
          stale_policy?: string
          status?: string
          suppress_reason?: string | null
          timezone?: string
          title?: string
          updated_at?: string
          user_id?: string
          utility_breakdown?: Json
          utility_score?: number
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "anticipation_opportunities_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "behavioral_patterns"
            referencedColumns: ["id"]
          },
        ]
      }
      anticipation_outcomes: {
        Row: {
          acted: boolean
          actual_value: number
          baseline_value: number
          confidence_delta: number
          created_at: string
          detector: string
          evidence: Json
          formula_version: string
          id: string
          interacted: boolean
          opportunity_date: string
          opportunity_id: string | null
          outcome: string
          pattern_id: string | null
          predicted_value: number
          updated_at: string
          user_feedback: string | null
          user_id: string
        }
        Insert: {
          acted?: boolean
          actual_value?: number
          baseline_value?: number
          confidence_delta?: number
          created_at?: string
          detector: string
          evidence?: Json
          formula_version?: string
          id?: string
          interacted?: boolean
          opportunity_date: string
          opportunity_id?: string | null
          outcome?: string
          pattern_id?: string | null
          predicted_value?: number
          updated_at?: string
          user_feedback?: string | null
          user_id: string
        }
        Update: {
          acted?: boolean
          actual_value?: number
          baseline_value?: number
          confidence_delta?: number
          created_at?: string
          detector?: string
          evidence?: Json
          formula_version?: string
          id?: string
          interacted?: boolean
          opportunity_date?: string
          opportunity_id?: string | null
          outcome?: string
          pattern_id?: string | null
          predicted_value?: number
          updated_at?: string
          user_feedback?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "anticipation_outcomes_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: true
            referencedRelation: "anticipation_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anticipation_outcomes_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "behavioral_patterns"
            referencedColumns: ["id"]
          },
        ]
      }
      behavior_hypotheses: {
        Row: {
          confidence: number
          confirmed_at: string | null
          created_at: string
          dedup_key: string
          evidence: Json
          expires_at: string | null
          explanation: string
          id: string
          kind: string
          status: string
          title: string
          updated_at: string
          user_feedback: string | null
          user_id: string
        }
        Insert: {
          confidence?: number
          confirmed_at?: string | null
          created_at?: string
          dedup_key: string
          evidence?: Json
          expires_at?: string | null
          explanation: string
          id?: string
          kind: string
          status?: string
          title: string
          updated_at?: string
          user_feedback?: string | null
          user_id: string
        }
        Update: {
          confidence?: number
          confirmed_at?: string | null
          created_at?: string
          dedup_key?: string
          evidence?: Json
          expires_at?: string | null
          explanation?: string
          id?: string
          kind?: string
          status?: string
          title?: string
          updated_at?: string
          user_feedback?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "behavior_hypotheses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "behavior_hypotheses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      behavioral_cycle_facts: {
        Row: {
          created_at: string
          cycle_key: string
          cycle_kind: string
          data_confidence: number
          days_covered: number
          entries_count: number
          formula_version: string
          id: string
          metrics: Json
          period_end: string
          period_start: string
          total_adjustable: number
          total_card: number
          total_consumption: number
          total_fixed: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          cycle_key: string
          cycle_kind: string
          data_confidence?: number
          days_covered?: number
          entries_count?: number
          formula_version?: string
          id?: string
          metrics?: Json
          period_end: string
          period_start: string
          total_adjustable?: number
          total_card?: number
          total_consumption?: number
          total_fixed?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          cycle_key?: string
          cycle_kind?: string
          data_confidence?: number
          days_covered?: number
          entries_count?: number
          formula_version?: string
          id?: string
          metrics?: Json
          period_end?: string
          period_start?: string
          total_adjustable?: number
          total_card?: number
          total_consumption?: number
          total_fixed?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      behavioral_daily_facts: {
        Row: {
          amount_uncategorized: number
          categorization_coverage: number
          created_at: string
          data_confidence: number
          entries_count: number
          formula_version: string
          is_exceptional_day: boolean
          is_holiday: boolean
          is_payday_window: boolean
          local_date: string
          month_phase: string
          small_spend_count: number
          total_adjustable: number
          total_card: number
          total_consumption: number
          total_fixed: number
          total_food: number
          total_leisure: number
          total_small_spend: number
          updated_at: string
          user_id: string
          week_start: string
          weekday: number
        }
        Insert: {
          amount_uncategorized?: number
          categorization_coverage?: number
          created_at?: string
          data_confidence?: number
          entries_count?: number
          formula_version?: string
          is_exceptional_day?: boolean
          is_holiday?: boolean
          is_payday_window?: boolean
          local_date: string
          month_phase: string
          small_spend_count?: number
          total_adjustable?: number
          total_card?: number
          total_consumption?: number
          total_fixed?: number
          total_food?: number
          total_leisure?: number
          total_small_spend?: number
          updated_at?: string
          user_id: string
          week_start: string
          weekday: number
        }
        Update: {
          amount_uncategorized?: number
          categorization_coverage?: number
          created_at?: string
          data_confidence?: number
          entries_count?: number
          formula_version?: string
          is_exceptional_day?: boolean
          is_holiday?: boolean
          is_payday_window?: boolean
          local_date?: string
          month_phase?: string
          small_spend_count?: number
          total_adjustable?: number
          total_card?: number
          total_consumption?: number
          total_fixed?: number
          total_food?: number
          total_leisure?: number
          total_small_spend?: number
          updated_at?: string
          user_id?: string
          week_start?: string
          weekday?: number
        }
        Relationships: []
      }
      behavioral_patterns: {
        Row: {
          absolute_delta: number
          baseline_value: number
          confidence: number
          consistency: number
          created_at: string
          data_coverage: number
          detector: string
          detector_version: string
          evidence: Json
          exclusions: Json
          expires_at: string | null
          formula_version: string
          hit_rate: number
          id: string
          label: string
          last_seen_at: string | null
          pattern_key: string
          pattern_value: number
          sample_size: number
          status: string
          updated_at: string
          uplift_pct: number
          user_id: string
          validated_at: string | null
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          absolute_delta?: number
          baseline_value?: number
          confidence?: number
          consistency?: number
          created_at?: string
          data_coverage?: number
          detector: string
          detector_version?: string
          evidence?: Json
          exclusions?: Json
          expires_at?: string | null
          formula_version?: string
          hit_rate?: number
          id?: string
          label: string
          last_seen_at?: string | null
          pattern_key: string
          pattern_value?: number
          sample_size?: number
          status?: string
          updated_at?: string
          uplift_pct?: number
          user_id: string
          validated_at?: string | null
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          absolute_delta?: number
          baseline_value?: number
          confidence?: number
          consistency?: number
          created_at?: string
          data_coverage?: number
          detector?: string
          detector_version?: string
          evidence?: Json
          exclusions?: Json
          expires_at?: string | null
          formula_version?: string
          hit_rate?: number
          id?: string
          label?: string
          last_seen_at?: string | null
          pattern_key?: string
          pattern_value?: number
          sample_size?: number
          status?: string
          updated_at?: string
          uplift_pct?: number
          user_id?: string
          validated_at?: string | null
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: []
      }
      behavioral_transaction_facts: {
        Row: {
          amount_gross: number
          amount_net: number
          behavioral_class: string
          card_cycle_day: number | null
          card_cycle_id: string | null
          category_confidence: number
          category_id: string | null
          category_name: string | null
          created_at: string
          data_confidence: number
          formula_version: string
          is_adjustable: boolean
          is_card_payment: boolean
          is_consumption: boolean
          is_debt_principal: boolean
          is_exceptional: boolean
          is_fixed: boolean
          is_planned: boolean
          is_refund: boolean
          is_transfer: boolean
          local_date: string
          local_time: string | null
          merchant_canonical: string | null
          merchant_normalized: string | null
          month_phase: string
          movement_kind: string
          occurred_at_precision: string
          source_snapshot_id: string | null
          transaction_id: string
          updated_at: string
          user_id: string
          week_start: string
          weekday: number
        }
        Insert: {
          amount_gross?: number
          amount_net?: number
          behavioral_class?: string
          card_cycle_day?: number | null
          card_cycle_id?: string | null
          category_confidence?: number
          category_id?: string | null
          category_name?: string | null
          created_at?: string
          data_confidence?: number
          formula_version?: string
          is_adjustable?: boolean
          is_card_payment?: boolean
          is_consumption?: boolean
          is_debt_principal?: boolean
          is_exceptional?: boolean
          is_fixed?: boolean
          is_planned?: boolean
          is_refund?: boolean
          is_transfer?: boolean
          local_date: string
          local_time?: string | null
          merchant_canonical?: string | null
          merchant_normalized?: string | null
          month_phase: string
          movement_kind?: string
          occurred_at_precision?: string
          source_snapshot_id?: string | null
          transaction_id: string
          updated_at?: string
          user_id: string
          week_start: string
          weekday: number
        }
        Update: {
          amount_gross?: number
          amount_net?: number
          behavioral_class?: string
          card_cycle_day?: number | null
          card_cycle_id?: string | null
          category_confidence?: number
          category_id?: string | null
          category_name?: string | null
          created_at?: string
          data_confidence?: number
          formula_version?: string
          is_adjustable?: boolean
          is_card_payment?: boolean
          is_consumption?: boolean
          is_debt_principal?: boolean
          is_exceptional?: boolean
          is_fixed?: boolean
          is_planned?: boolean
          is_refund?: boolean
          is_transfer?: boolean
          local_date?: string
          local_time?: string | null
          merchant_canonical?: string | null
          merchant_normalized?: string | null
          month_phase?: string
          movement_kind?: string
          occurred_at_precision?: string
          source_snapshot_id?: string | null
          transaction_id?: string
          updated_at?: string
          user_id?: string
          week_start?: string
          weekday?: number
        }
        Relationships: []
      }
      break_glass_sessions: {
        Row: {
          admin_id: string
          closed_at: string | null
          closed_reason: string | null
          expires_at: string
          fields: string[]
          id: string
          opened_at: string
          pseudo_id: string
          reads_count: number
          reason: string
          ticket_ref: string
        }
        Insert: {
          admin_id: string
          closed_at?: string | null
          closed_reason?: string | null
          expires_at: string
          fields: string[]
          id?: string
          opened_at?: string
          pseudo_id: string
          reads_count?: number
          reason: string
          ticket_ref: string
        }
        Update: {
          admin_id?: string
          closed_at?: string | null
          closed_reason?: string | null
          expires_at?: string
          fields?: string[]
          id?: string
          opened_at?: string
          pseudo_id?: string
          reads_count?: number
          reason?: string
          ticket_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "break_glass_sessions_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "break_glass_sessions_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "break_glass_sessions_pseudo_id_fkey"
            columns: ["pseudo_id"]
            isOneToOne: false
            referencedRelation: "user_pseudonyms"
            referencedColumns: ["pseudo_id"]
          },
          {
            foreignKeyName: "break_glass_sessions_pseudo_id_fkey"
            columns: ["pseudo_id"]
            isOneToOne: false
            referencedRelation: "v_client_pseudonyms"
            referencedColumns: ["pseudo_id"]
          },
          {
            foreignKeyName: "break_glass_sessions_pseudo_id_fkey"
            columns: ["pseudo_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["pseudo_id"]
          },
        ]
      }
      categories: {
        Row: {
          archived_at: string | null
          color: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
          slug: string
          type: Database["public"]["Enums"]["category_type"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          slug: string
          type: Database["public"]["Enums"]["category_type"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          slug?: string
          type?: Database["public"]["Enums"]["category_type"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "categories_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      categorization_metrics_daily: {
        Row: {
          auto_applied: number
          category_source: string
          computed_at: string
          correction_rate_pct: number | null
          coverage_pct: number | null
          date: string
          precision_proxy_pct: number | null
          sem_categoria_pct: number | null
          suggested: number
          total_tx: number
          uncategorized: number
          user_corrected_within_7d: number
        }
        Insert: {
          auto_applied?: number
          category_source?: string
          computed_at?: string
          correction_rate_pct?: number | null
          coverage_pct?: number | null
          date: string
          precision_proxy_pct?: number | null
          sem_categoria_pct?: number | null
          suggested?: number
          total_tx?: number
          uncategorized?: number
          user_corrected_within_7d?: number
        }
        Update: {
          auto_applied?: number
          category_source?: string
          computed_at?: string
          correction_rate_pct?: number | null
          coverage_pct?: number | null
          date?: string
          precision_proxy_pct?: number | null
          sem_categoria_pct?: number | null
          suggested?: number
          total_tx?: number
          uncategorized?: number
          user_corrected_within_7d?: number
        }
        Relationships: []
      }
      category_classification_queue: {
        Row: {
          attempts: number
          available_at: string
          created_at: string
          id: string
          last_error: string | null
          locked_at: string | null
          processed_at: string | null
          status: string
          transaction_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          created_at?: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          processed_at?: string | null
          status?: string
          transaction_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          available_at?: string
          created_at?: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          processed_at?: string | null
          status?: string
          transaction_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_classification_queue_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      category_decisions: {
        Row: {
          action: string
          actor: string
          alternatives: Json
          applied_at: string | null
          confidence: number
          created_at: string
          decided_category_id: string | null
          engine_version: string
          id: string
          input_fingerprint: string | null
          mode: string
          previous_category_id: string | null
          reason: string | null
          reason_code: string
          run_id: string | null
          source: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          actor?: string
          alternatives?: Json
          applied_at?: string | null
          confidence?: number
          created_at?: string
          decided_category_id?: string | null
          engine_version?: string
          id?: string
          input_fingerprint?: string | null
          mode?: string
          previous_category_id?: string | null
          reason?: string | null
          reason_code: string
          run_id?: string | null
          source: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          actor?: string
          alternatives?: Json
          applied_at?: string | null
          confidence?: number
          created_at?: string
          decided_category_id?: string | null
          engine_version?: string
          id?: string
          input_fingerprint?: string | null
          mode?: string
          previous_category_id?: string | null
          reason?: string | null
          reason_code?: string
          run_id?: string | null
          source?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_decisions_decided_category_id_fkey"
            columns: ["decided_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_decisions_previous_category_id_fkey"
            columns: ["previous_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_decisions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "category_engine_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_decisions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      category_engine_runs: {
        Row: {
          auto_applied: number
          checkpoint: Json
          completed_at: string | null
          created_at: string
          dry_run: boolean
          engine_version: string
          error: string | null
          failed: number
          heartbeat_at: string | null
          id: string
          mode: string
          processed_items: number
          started_at: string | null
          status: string
          suggested: number
          total_items: number
          unresolved: number
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_applied?: number
          checkpoint?: Json
          completed_at?: string | null
          created_at?: string
          dry_run?: boolean
          engine_version?: string
          error?: string | null
          failed?: number
          heartbeat_at?: string | null
          id?: string
          mode: string
          processed_items?: number
          started_at?: string | null
          status?: string
          suggested?: number
          total_items?: number
          unresolved?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_applied?: number
          checkpoint?: Json
          completed_at?: string | null
          created_at?: string
          dry_run?: boolean
          engine_version?: string
          error?: string | null
          failed?: number
          heartbeat_at?: string | null
          id?: string
          mode?: string
          processed_items?: number
          started_at?: string | null
          status?: string
          suggested?: number
          total_items?: number
          unresolved?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      category_spending_goal_cycles: {
        Row: {
          actual_spend: number
          baseline_snapshot: number | null
          closed_at: string | null
          created_at: string
          end_date: string
          final_status: string | null
          goal_id: string
          id: string
          projected_spend: number | null
          start_date: string
          target_snapshot: number
          updated_at: string
          user_id: string
        }
        Insert: {
          actual_spend?: number
          baseline_snapshot?: number | null
          closed_at?: string | null
          created_at?: string
          end_date: string
          final_status?: string | null
          goal_id: string
          id?: string
          projected_spend?: number | null
          start_date: string
          target_snapshot: number
          updated_at?: string
          user_id: string
        }
        Update: {
          actual_spend?: number
          baseline_snapshot?: number | null
          closed_at?: string | null
          created_at?: string
          end_date?: string
          final_status?: string | null
          goal_id?: string
          id?: string
          projected_spend?: number | null
          start_date?: string
          target_snapshot?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_spending_goal_cycles_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "category_spending_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_spending_goal_cycles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "category_spending_goal_cycles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      category_spending_goals: {
        Row: {
          alerts: Json
          baseline_kind: string
          baseline_value: number | null
          cancelled_at: string | null
          category_id: string
          computed_limit: number
          created_at: string
          end_date: string | null
          fixed_limit: number | null
          frequency: string
          id: string
          mode: string
          paused_at: string | null
          period_type: string
          recurrence_end_date: string | null
          reduction_pct: number | null
          start_date: string
          status: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alerts?: Json
          baseline_kind?: string
          baseline_value?: number | null
          cancelled_at?: string | null
          category_id: string
          computed_limit: number
          created_at?: string
          end_date?: string | null
          fixed_limit?: number | null
          frequency?: string
          id?: string
          mode: string
          paused_at?: string | null
          period_type?: string
          recurrence_end_date?: string | null
          reduction_pct?: number | null
          start_date?: string
          status?: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alerts?: Json
          baseline_kind?: string
          baseline_value?: number | null
          cancelled_at?: string | null
          category_id?: string
          computed_limit?: number
          created_at?: string
          end_date?: string | null
          fixed_limit?: number | null
          frequency?: string
          id?: string
          mode?: string
          paused_at?: string | null
          period_type?: string
          recurrence_end_date?: string | null
          reduction_pct?: number | null
          start_date?: string
          status?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_spending_goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "category_spending_goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      challenges: {
        Row: {
          created_at: string
          description: string | null
          duration_days: number
          id: string
          slug: string
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_days?: number
          id?: string
          slug: string
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_days?: number
          id?: string
          slug?: string
          title?: string
        }
        Relationships: []
      }
      challenges_catalog: {
        Row: {
          active: boolean
          created_at: string
          description: string
          duration_days: number
          goal_value: number
          kind: Database["public"]["Enums"]["challenge_kind"]
          slug: string
          title: string
          updated_at: string
          xp_reward: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          description: string
          duration_days?: number
          goal_value?: number
          kind: Database["public"]["Enums"]["challenge_kind"]
          slug: string
          title: string
          updated_at?: string
          xp_reward?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          duration_days?: number
          goal_value?: number
          kind?: Database["public"]["Enums"]["challenge_kind"]
          slug?: string
          title?: string
          updated_at?: string
          xp_reward?: number
        }
        Relationships: []
      }
      communication_catalog: {
        Row: {
          active: boolean
          allowed_channels: string[]
          audience_note: string | null
          base_priority: number
          content_mode: string
          cooldown_hours: number
          created_at: string
          default_channels: string[]
          default_window_hours: number
          description: string | null
          dismiss_cooldown_days: number
          escalation_channels: string[]
          fallback_policy: string
          family: string
          kind: string
          label: string
          max_per_day: number
          min_severity_for_whatsapp: string
          min_utility_score: number
          not_useful_cooldown_days: number
          requires_manual_approval: boolean
          same_pattern_cooldown_days: number
          sensitivity: string
          stale_policy: string
          updated_at: string
          whatsapp_min_absolute_impact: number
          whatsapp_min_confidence: number
        }
        Insert: {
          active?: boolean
          allowed_channels?: string[]
          audience_note?: string | null
          base_priority?: number
          content_mode?: string
          cooldown_hours?: number
          created_at?: string
          default_channels?: string[]
          default_window_hours?: number
          description?: string | null
          dismiss_cooldown_days?: number
          escalation_channels?: string[]
          fallback_policy?: string
          family: string
          kind: string
          label: string
          max_per_day?: number
          min_severity_for_whatsapp?: string
          min_utility_score?: number
          not_useful_cooldown_days?: number
          requires_manual_approval?: boolean
          same_pattern_cooldown_days?: number
          sensitivity?: string
          stale_policy?: string
          updated_at?: string
          whatsapp_min_absolute_impact?: number
          whatsapp_min_confidence?: number
        }
        Update: {
          active?: boolean
          allowed_channels?: string[]
          audience_note?: string | null
          base_priority?: number
          content_mode?: string
          cooldown_hours?: number
          created_at?: string
          default_channels?: string[]
          default_window_hours?: number
          description?: string | null
          dismiss_cooldown_days?: number
          escalation_channels?: string[]
          fallback_policy?: string
          family?: string
          kind?: string
          label?: string
          max_per_day?: number
          min_severity_for_whatsapp?: string
          min_utility_score?: number
          not_useful_cooldown_days?: number
          requires_manual_approval?: boolean
          same_pattern_cooldown_days?: number
          sensitivity?: string
          stale_policy?: string
          updated_at?: string
          whatsapp_min_absolute_impact?: number
          whatsapp_min_confidence?: number
        }
        Relationships: []
      }
      communication_deliveries: {
        Row: {
          acted_at: string | null
          action_taken: string | null
          block_context: Json
          channel: string
          cost_usd: number | null
          created_at: string
          dedup_key: string | null
          delivered_at: string | null
          evidence: Json
          false_positive: boolean | null
          id: string
          interacted_at: string | null
          kind: string
          logical_dedup_key: string | null
          reason: string | null
          status: string
          suggestion_id: string | null
          user_feedback: string | null
          user_id: string
        }
        Insert: {
          acted_at?: string | null
          action_taken?: string | null
          block_context?: Json
          channel: string
          cost_usd?: number | null
          created_at?: string
          dedup_key?: string | null
          delivered_at?: string | null
          evidence?: Json
          false_positive?: boolean | null
          id?: string
          interacted_at?: string | null
          kind: string
          logical_dedup_key?: string | null
          reason?: string | null
          status: string
          suggestion_id?: string | null
          user_feedback?: string | null
          user_id: string
        }
        Update: {
          acted_at?: string | null
          action_taken?: string | null
          block_context?: Json
          channel?: string
          cost_usd?: number | null
          created_at?: string
          dedup_key?: string | null
          delivered_at?: string | null
          evidence?: Json
          false_positive?: boolean | null
          id?: string
          interacted_at?: string | null
          kind?: string
          logical_dedup_key?: string | null
          reason?: string | null
          status?: string
          suggestion_id?: string | null
          user_feedback?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_deliveries_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "pending_proactive_suggestions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_deliveries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "communication_deliveries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      communication_feedback: {
        Row: {
          created_at: string
          dedup_key: string | null
          family: string | null
          feedback: string
          id: string
          kind: string
          source_id: string | null
          source_table: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dedup_key?: string | null
          family?: string | null
          feedback: string
          id?: string
          kind: string
          source_id?: string | null
          source_table: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dedup_key?: string | null
          family?: string | null
          feedback?: string
          id?: string
          kind?: string
          source_id?: string | null
          source_table?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      communication_templates: {
        Row: {
          active: boolean
          allowed_variables: string[]
          body_template: string
          channel: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          title_template: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          active?: boolean
          allowed_variables?: string[]
          body_template: string
          channel: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          title_template: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          active?: boolean
          allowed_variables?: string[]
          body_template?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          title_template?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "communication_templates_kind_fkey"
            columns: ["kind"]
            isOneToOne: false
            referencedRelation: "communication_catalog"
            referencedColumns: ["kind"]
          },
        ]
      }
      company_accounts: {
        Row: {
          created_at: string
          currency: string
          id: string
          kind: string
          name: string
          notes: string | null
          opening_balance: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          kind?: string
          name: string
          notes?: string | null
          opening_balance?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          kind?: string
          name?: string
          notes?: string | null
          opening_balance?: number
          updated_at?: string
        }
        Relationships: []
      }
      company_budgets: {
        Row: {
          category_id: string | null
          created_at: string
          id: string
          month: string
          notes: string | null
          planned_amount: number
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          id?: string
          month: string
          notes?: string | null
          planned_amount?: number
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          id?: string
          month?: string
          notes?: string | null
          planned_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "company_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      company_categories: {
        Row: {
          color: string | null
          created_at: string
          id: string
          kind: string
          name: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          kind: string
          name: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          kind?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_transactions: {
        Row: {
          account_id: string | null
          amount: number
          category_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          occurred_at: string
          type: string
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          occurred_at: string
          type: string
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          occurred_at?: string
          type?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "company_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "company_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_transactions_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "company_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      company_vendors: {
        Row: {
          contact: string | null
          created_at: string
          document: string | null
          id: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          contact?: string | null
          created_at?: string
          document?: string | null
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          contact?: string | null
          created_at?: string
          document?: string | null
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      conversation_messages: {
        Row: {
          artifact_ids: string[] | null
          body_masked: string
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["msg_direction"]
          id: string
          user_id: string
        }
        Insert: {
          artifact_ids?: string[] | null
          body_masked: string
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["msg_direction"]
          id?: string
          user_id: string
        }
        Update: {
          artifact_ids?: string[] | null
          body_masked?: string
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["msg_direction"]
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          pending_slots: Json | null
          phone_e164: string | null
          source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          pending_slots?: Json | null
          phone_e164?: string | null
          source?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          pending_slots?: Json | null
          phone_e164?: string | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      credit_card_installments: {
        Row: {
          absorbed_at: string | null
          absorbed_by_statement_id: string | null
          amount: number
          competence_month: string
          created_at: string
          credit_card_id: string
          due_date: string | null
          id: string
          installment_number: number
          legacy_transaction_id: string | null
          purchase_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          absorbed_at?: string | null
          absorbed_by_statement_id?: string | null
          amount: number
          competence_month: string
          created_at?: string
          credit_card_id: string
          due_date?: string | null
          id?: string
          installment_number: number
          legacy_transaction_id?: string | null
          purchase_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          absorbed_at?: string | null
          absorbed_by_statement_id?: string | null
          amount?: number
          competence_month?: string
          created_at?: string
          credit_card_id?: string
          due_date?: string | null
          id?: string
          installment_number?: number
          legacy_transaction_id?: string | null
          purchase_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_card_installments_absorbed_by_statement_id_fkey"
            columns: ["absorbed_by_statement_id"]
            isOneToOne: false
            referencedRelation: "credit_card_statements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_installments_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_installments_legacy_transaction_id_fkey"
            columns: ["legacy_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_installments_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "credit_card_purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_installments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credit_card_installments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      credit_card_payment_allocations: {
        Row: {
          amount: number
          created_at: string
          id: string
          payment_id: string
          statement_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          payment_id: string
          statement_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          payment_id?: string
          statement_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_card_payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "credit_card_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_payment_allocations_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "credit_card_statements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_payment_allocations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credit_card_payment_allocations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      credit_card_payment_reversals: {
        Row: {
          id: string
          payment_id: string
          payment_snapshot: Json
          reversed_at: string
          reversed_transaction_snapshot: Json | null
          statement_id: string
          user_id: string
        }
        Insert: {
          id?: string
          payment_id: string
          payment_snapshot: Json
          reversed_at?: string
          reversed_transaction_snapshot?: Json | null
          statement_id: string
          user_id: string
        }
        Update: {
          id?: string
          payment_id?: string
          payment_snapshot?: Json
          reversed_at?: string
          reversed_transaction_snapshot?: Json | null
          statement_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_card_payment_reversals_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "credit_card_statements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_payment_reversals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credit_card_payment_reversals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      credit_card_payments: {
        Row: {
          account_id: string | null
          amount: number
          created_at: string
          credit_card_id: string
          id: string
          idempotency_key: string | null
          paid_at: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          created_at?: string
          credit_card_id: string
          id?: string
          idempotency_key?: string | null
          paid_at: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          created_at?: string
          credit_card_id?: string
          id?: string
          idempotency_key?: string | null
          paid_at?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_card_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_payments_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credit_card_payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      credit_card_purchases: {
        Row: {
          category_id: string | null
          confidence: number | null
          created_at: string
          credit_card_id: string
          id: string
          inferred_total: boolean
          installments_total: number
          legacy_purchase_group_id: string | null
          merchant: string
          purchase_date: string
          source: string
          source_document_id: string | null
          status: string
          total_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          category_id?: string | null
          confidence?: number | null
          created_at?: string
          credit_card_id: string
          id?: string
          inferred_total?: boolean
          installments_total?: number
          legacy_purchase_group_id?: string | null
          merchant: string
          purchase_date: string
          source?: string
          source_document_id?: string | null
          status?: string
          total_amount: number
          updated_at?: string
          user_id: string
        }
        Update: {
          category_id?: string | null
          confidence?: number | null
          created_at?: string
          credit_card_id?: string
          id?: string
          inferred_total?: boolean
          installments_total?: number
          legacy_purchase_group_id?: string | null
          merchant?: string
          purchase_date?: string
          source?: string
          source_document_id?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_card_purchases_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_purchases_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_purchases_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "document_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credit_card_purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      credit_card_statement_items: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          installment_id: string | null
          item_kind: string
          legacy_transaction_id: string | null
          occurred_at: string | null
          source_extracted_item_id: string | null
          statement_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          installment_id?: string | null
          item_kind?: string
          legacy_transaction_id?: string | null
          occurred_at?: string | null
          source_extracted_item_id?: string | null
          statement_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          installment_id?: string | null
          item_kind?: string
          legacy_transaction_id?: string | null
          occurred_at?: string | null
          source_extracted_item_id?: string | null
          statement_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_card_statement_items_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "credit_card_installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_statement_items_legacy_transaction_id_fkey"
            columns: ["legacy_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_statement_items_source_extracted_item_id_fkey"
            columns: ["source_extracted_item_id"]
            isOneToOne: false
            referencedRelation: "extracted_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_statement_items_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "credit_card_statements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_statement_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credit_card_statement_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      credit_card_statements: {
        Row: {
          adjustment_evidence: Json | null
          adjustment_reason_code: string | null
          closing_date: string | null
          competence_month: string
          created_at: string
          credit_card_id: string
          due_date: string
          financed_balance: number
          id: string
          opening_balance: number
          outstanding_amount: number | null
          paid_amount: number
          payments_total: number
          period_end: string | null
          period_start: string | null
          reconciled_total: number
          reconciliation_difference: number | null
          requires_manual_review: boolean
          source_document_id: string | null
          stated_total: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          adjustment_evidence?: Json | null
          adjustment_reason_code?: string | null
          closing_date?: string | null
          competence_month: string
          created_at?: string
          credit_card_id: string
          due_date: string
          financed_balance?: number
          id?: string
          opening_balance?: number
          outstanding_amount?: number | null
          paid_amount?: number
          payments_total?: number
          period_end?: string | null
          period_start?: string | null
          reconciled_total?: number
          reconciliation_difference?: number | null
          requires_manual_review?: boolean
          source_document_id?: string | null
          stated_total?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          adjustment_evidence?: Json | null
          adjustment_reason_code?: string | null
          closing_date?: string | null
          competence_month?: string
          created_at?: string
          credit_card_id?: string
          due_date?: string
          financed_balance?: number
          id?: string
          opening_balance?: number
          outstanding_amount?: number | null
          paid_amount?: number
          payments_total?: number
          period_end?: string | null
          period_start?: string | null
          reconciled_total?: number
          reconciliation_difference?: number | null
          requires_manual_review?: boolean
          source_document_id?: string | null
          stated_total?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_card_statements_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_statements_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "document_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_statements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credit_card_statements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      credit_cards: {
        Row: {
          active: boolean
          brand: string | null
          closing_day: number
          color: string | null
          created_at: string
          due_day: number
          id: string
          last_four: string | null
          name: string
          statement_goal: number | null
          total_limit: number
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          brand?: string | null
          closing_day: number
          color?: string | null
          created_at?: string
          due_day: number
          id?: string
          last_four?: string | null
          name: string
          statement_goal?: number | null
          total_limit?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          brand?: string | null
          closing_day?: number
          color?: string | null
          created_at?: string
          due_day?: number
          id?: string
          last_four?: string | null
          name?: string
          statement_goal?: number | null
          total_limit?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_cards_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credit_cards_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      debt_payments: {
        Row: {
          account_id: string | null
          amount: number
          amount_applied: number
          created_at: string
          debt_id: string
          fee_amount: number
          id: string
          idempotency_key: string | null
          installments_covered: number
          interest_amount: number
          notes: string | null
          paid_at: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          amount_applied: number
          created_at?: string
          debt_id: string
          fee_amount?: number
          id?: string
          idempotency_key?: string | null
          installments_covered?: number
          interest_amount?: number
          notes?: string | null
          paid_at?: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          amount_applied?: number
          created_at?: string
          debt_id?: string
          fee_amount?: number
          id?: string
          idempotency_key?: string | null
          installments_covered?: number
          interest_amount?: number
          notes?: string | null
          paid_at?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "debt_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debt_payments_debt_id_fkey"
            columns: ["debt_id"]
            isOneToOne: false
            referencedRelation: "debts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debt_payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debt_payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "debt_payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      debts: {
        Row: {
          accounting_method: string
          amount_was_inferred: boolean
          contract_total_amount: number
          created_at: string
          creditor: string | null
          due_day: number | null
          first_due_date: string | null
          formula_version: string
          id: string
          installment_amount: number | null
          installments_paid: number
          installments_total: number | null
          interest_rate_pct: number | null
          name: string
          notes: string | null
          original_amount: number
          outstanding_balance: number
          principal_amount: number
          start_date: string | null
          status: Database["public"]["Enums"]["debt_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          accounting_method?: string
          amount_was_inferred?: boolean
          contract_total_amount: number
          created_at?: string
          creditor?: string | null
          due_day?: number | null
          first_due_date?: string | null
          formula_version?: string
          id?: string
          installment_amount?: number | null
          installments_paid?: number
          installments_total?: number | null
          interest_rate_pct?: number | null
          name: string
          notes?: string | null
          original_amount: number
          outstanding_balance: number
          principal_amount: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["debt_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          accounting_method?: string
          amount_was_inferred?: boolean
          contract_total_amount?: number
          created_at?: string
          creditor?: string | null
          due_day?: number | null
          first_due_date?: string | null
          formula_version?: string
          id?: string
          installment_amount?: number | null
          installments_paid?: number
          installments_total?: number | null
          interest_rate_pct?: number | null
          name?: string
          notes?: string | null
          original_amount?: number
          outstanding_balance?: number
          principal_amount?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["debt_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "debts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "debts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      document_fragments: {
        Row: {
          attempts: number
          created_at: string
          document_id: string
          duplicates_found: number
          error: string | null
          error_code: string | null
          extraction_ms: number
          fragment_index: number
          heartbeat_at: string | null
          id: string
          items_found: number
          page_end: number
          page_start: number
          partial: boolean
          status: string
          tokens_in: number
          tokens_out: number
          total_fragments: number
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          document_id: string
          duplicates_found?: number
          error?: string | null
          error_code?: string | null
          extraction_ms?: number
          fragment_index: number
          heartbeat_at?: string | null
          id?: string
          items_found?: number
          page_end: number
          page_start: number
          partial?: boolean
          status?: string
          tokens_in?: number
          tokens_out?: number
          total_fragments: number
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          document_id?: string
          duplicates_found?: number
          error?: string | null
          error_code?: string | null
          extraction_ms?: number
          fragment_index?: number
          heartbeat_at?: string | null
          id?: string
          items_found?: number
          page_end?: number
          page_start?: number
          partial?: boolean
          status?: string
          tokens_in?: number
          tokens_out?: number
          total_fragments?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_fragments_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "document_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_fragments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "document_fragments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      document_import_audit: {
        Row: {
          action: string
          created_at: string
          document_id: string
          id: string
          payload: Json
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          document_id: string
          id?: string
          payload?: Json
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          document_id?: string
          id?: string
          payload?: Json
          user_id?: string
        }
        Relationships: []
      }
      document_imports: {
        Row: {
          attempt_count: number
          conversation_id: string | null
          cost_usd_micros: number | null
          counters: Json
          created_at: string
          document_kind: string | null
          error: string | null
          expires_at: string | null
          external_message_id: string | null
          extraction_ms: number | null
          id: string
          invoice_card_last4: string | null
          invoice_closing_date: string | null
          invoice_competence_month: string | null
          invoice_coverage: Json | null
          invoice_credits_total: number | null
          invoice_current_charges_total: number | null
          invoice_domestic_total: number | null
          invoice_due_date: string | null
          invoice_financed_balance: number | null
          invoice_international_total: number | null
          invoice_payments_total: number | null
          invoice_previous_balance: number | null
          invoice_summary_source: string | null
          invoice_taxes_total: number | null
          invoice_total: number | null
          message_id: string | null
          mime_type: string
          model: string | null
          next_attempt_at: string | null
          period_end: string | null
          period_start: string | null
          provider_message_id: string | null
          raw_text: string | null
          sha256: string
          size_bytes: number
          source: string
          source_account_id: string | null
          source_context_confidence: number | null
          source_context_method: string | null
          source_context_reason: string | null
          source_credit_card_id: string | null
          statement_balance_date: string | null
          statement_bank: string | null
          statement_closing_balance: number | null
          statement_opening_balance: number | null
          statement_period_end: string | null
          statement_period_start: string | null
          status: string
          storage_path: string
          tokens_in: number | null
          tokens_out: number | null
          updated_at: string
          user_id: string
          user_instructions: string | null
        }
        Insert: {
          attempt_count?: number
          conversation_id?: string | null
          cost_usd_micros?: number | null
          counters?: Json
          created_at?: string
          document_kind?: string | null
          error?: string | null
          expires_at?: string | null
          external_message_id?: string | null
          extraction_ms?: number | null
          id?: string
          invoice_card_last4?: string | null
          invoice_closing_date?: string | null
          invoice_competence_month?: string | null
          invoice_coverage?: Json | null
          invoice_credits_total?: number | null
          invoice_current_charges_total?: number | null
          invoice_domestic_total?: number | null
          invoice_due_date?: string | null
          invoice_financed_balance?: number | null
          invoice_international_total?: number | null
          invoice_payments_total?: number | null
          invoice_previous_balance?: number | null
          invoice_summary_source?: string | null
          invoice_taxes_total?: number | null
          invoice_total?: number | null
          message_id?: string | null
          mime_type: string
          model?: string | null
          next_attempt_at?: string | null
          period_end?: string | null
          period_start?: string | null
          provider_message_id?: string | null
          raw_text?: string | null
          sha256: string
          size_bytes: number
          source: string
          source_account_id?: string | null
          source_context_confidence?: number | null
          source_context_method?: string | null
          source_context_reason?: string | null
          source_credit_card_id?: string | null
          statement_balance_date?: string | null
          statement_bank?: string | null
          statement_closing_balance?: number | null
          statement_opening_balance?: number | null
          statement_period_end?: string | null
          statement_period_start?: string | null
          status?: string
          storage_path: string
          tokens_in?: number | null
          tokens_out?: number | null
          updated_at?: string
          user_id: string
          user_instructions?: string | null
        }
        Update: {
          attempt_count?: number
          conversation_id?: string | null
          cost_usd_micros?: number | null
          counters?: Json
          created_at?: string
          document_kind?: string | null
          error?: string | null
          expires_at?: string | null
          external_message_id?: string | null
          extraction_ms?: number | null
          id?: string
          invoice_card_last4?: string | null
          invoice_closing_date?: string | null
          invoice_competence_month?: string | null
          invoice_coverage?: Json | null
          invoice_credits_total?: number | null
          invoice_current_charges_total?: number | null
          invoice_domestic_total?: number | null
          invoice_due_date?: string | null
          invoice_financed_balance?: number | null
          invoice_international_total?: number | null
          invoice_payments_total?: number | null
          invoice_previous_balance?: number | null
          invoice_summary_source?: string | null
          invoice_taxes_total?: number | null
          invoice_total?: number | null
          message_id?: string | null
          mime_type?: string
          model?: string | null
          next_attempt_at?: string | null
          period_end?: string | null
          period_start?: string | null
          provider_message_id?: string | null
          raw_text?: string | null
          sha256?: string
          size_bytes?: number
          source?: string
          source_account_id?: string | null
          source_context_confidence?: number | null
          source_context_method?: string | null
          source_context_reason?: string | null
          source_credit_card_id?: string | null
          statement_balance_date?: string | null
          statement_bank?: string | null
          statement_closing_balance?: number | null
          statement_opening_balance?: number | null
          statement_period_end?: string | null
          statement_period_start?: string | null
          status?: string
          storage_path?: string
          tokens_in?: number | null
          tokens_out?: number | null
          updated_at?: string
          user_id?: string
          user_instructions?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_imports_source_account_id_fkey"
            columns: ["source_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_imports_source_credit_card_id_fkey"
            columns: ["source_credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_imports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "document_imports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      document_item_rejections: {
        Row: {
          created_at: string
          description_excerpt: string | null
          document_id: string
          id: string
          item_index: number | null
          offending_fields: Json
          reason_code: string
          reason_field: string | null
          reason_message: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          description_excerpt?: string | null
          document_id: string
          id?: string
          item_index?: number | null
          offending_fields?: Json
          reason_code: string
          reason_field?: string | null
          reason_message?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          description_excerpt?: string | null
          document_id?: string
          id?: string
          item_index?: number | null
          offending_fields?: Json
          reason_code?: string
          reason_field?: string | null
          reason_message?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_item_rejections_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "document_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_item_rejections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "document_item_rejections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      document_processing_events: {
        Row: {
          created_at: string
          document_id: string
          error_code: string | null
          event_type: string
          id: string
          items_found: number | null
          items_rejected: number | null
          items_valid: number | null
          metadata: Json
          progress_current: number | null
          progress_total: number | null
          stage: string | null
          user_id: string
          user_message: string | null
        }
        Insert: {
          created_at?: string
          document_id: string
          error_code?: string | null
          event_type: string
          id?: string
          items_found?: number | null
          items_rejected?: number | null
          items_valid?: number | null
          metadata?: Json
          progress_current?: number | null
          progress_total?: number | null
          stage?: string | null
          user_id: string
          user_message?: string | null
        }
        Update: {
          created_at?: string
          document_id?: string
          error_code?: string | null
          event_type?: string
          id?: string
          items_found?: number | null
          items_rejected?: number | null
          items_valid?: number | null
          metadata?: Json
          progress_current?: number | null
          progress_total?: number | null
          stage?: string | null
          user_id?: string
          user_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_processing_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "document_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      edge_incidents: {
        Row: {
          created_at: string
          details: Json
          error_code: string
          function_name: string
          http_status: number
          id: string
          request_id: string
          retryable: boolean
          user_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          error_code: string
          function_name: string
          http_status: number
          id?: string
          request_id: string
          retryable?: boolean
          user_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          error_code?: string
          function_name?: string
          http_status?: number
          id?: string
          request_id?: string
          retryable?: boolean
          user_id?: string | null
        }
        Relationships: []
      }
      emotional_checkins: {
        Row: {
          created_at: string
          emotion_key: string | null
          id: string
          mood: number
          notes: string | null
          occurred_at: string
          transaction_id: string | null
          trigger_label: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          emotion_key?: string | null
          id?: string
          mood: number
          notes?: string | null
          occurred_at?: string
          transaction_id?: string | null
          trigger_label?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          emotion_key?: string | null
          id?: string
          mood?: number
          notes?: string | null
          occurred_at?: string
          transaction_id?: string | null
          trigger_label?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emotional_checkins_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emotional_checkins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "emotional_checkins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      extracted_items: {
        Row: {
          account_hint: string | null
          account_id: string | null
          amount: number
          bank_description: string | null
          bank_reference: string | null
          card_hint: string | null
          category_confidence: number | null
          category_hint: string | null
          category_id: string | null
          category_source: string | null
          competence_date: string | null
          confidence: Json
          created_at: string
          credit_card_id: string | null
          dedupe_fingerprint: string | null
          description: string | null
          document_id: string
          duplicate_of: string | null
          duplicate_reason: string | null
          external_id: string | null
          friendly_description: string | null
          historical_installments_paid_assumption: boolean | null
          id: string
          idx: number
          installment_inferred: boolean
          installment_number: number | null
          installments_total: number | null
          is_future_installment: boolean
          movement_kind: string
          normalized_description: string | null
          occurred_at: string
          payment_method: string | null
          posted_at: string | null
          posted_at_source: string | null
          purchase_date: string | null
          raw: Json | null
          raw_description: string | null
          source_line_index: number | null
          source_span: Json | null
          statement_item_kind: string | null
          statement_section: string | null
          status: string
          transaction_id: string | null
          type: string
          updated_at: string
          user_edited_at: string | null
          user_id: string
        }
        Insert: {
          account_hint?: string | null
          account_id?: string | null
          amount: number
          bank_description?: string | null
          bank_reference?: string | null
          card_hint?: string | null
          category_confidence?: number | null
          category_hint?: string | null
          category_id?: string | null
          category_source?: string | null
          competence_date?: string | null
          confidence?: Json
          created_at?: string
          credit_card_id?: string | null
          dedupe_fingerprint?: string | null
          description?: string | null
          document_id: string
          duplicate_of?: string | null
          duplicate_reason?: string | null
          external_id?: string | null
          friendly_description?: string | null
          historical_installments_paid_assumption?: boolean | null
          id?: string
          idx: number
          installment_inferred?: boolean
          installment_number?: number | null
          installments_total?: number | null
          is_future_installment?: boolean
          movement_kind?: string
          normalized_description?: string | null
          occurred_at: string
          payment_method?: string | null
          posted_at?: string | null
          posted_at_source?: string | null
          purchase_date?: string | null
          raw?: Json | null
          raw_description?: string | null
          source_line_index?: number | null
          source_span?: Json | null
          statement_item_kind?: string | null
          statement_section?: string | null
          status?: string
          transaction_id?: string | null
          type: string
          updated_at?: string
          user_edited_at?: string | null
          user_id: string
        }
        Update: {
          account_hint?: string | null
          account_id?: string | null
          amount?: number
          bank_description?: string | null
          bank_reference?: string | null
          card_hint?: string | null
          category_confidence?: number | null
          category_hint?: string | null
          category_id?: string | null
          category_source?: string | null
          competence_date?: string | null
          confidence?: Json
          created_at?: string
          credit_card_id?: string | null
          dedupe_fingerprint?: string | null
          description?: string | null
          document_id?: string
          duplicate_of?: string | null
          duplicate_reason?: string | null
          external_id?: string | null
          friendly_description?: string | null
          historical_installments_paid_assumption?: boolean | null
          id?: string
          idx?: number
          installment_inferred?: boolean
          installment_number?: number | null
          installments_total?: number | null
          is_future_installment?: boolean
          movement_kind?: string
          normalized_description?: string | null
          occurred_at?: string
          payment_method?: string | null
          posted_at?: string | null
          posted_at_source?: string | null
          purchase_date?: string | null
          raw?: Json | null
          raw_description?: string | null
          source_line_index?: number | null
          source_span?: Json | null
          statement_item_kind?: string | null
          statement_section?: string | null
          status?: string
          transaction_id?: string | null
          type?: string
          updated_at?: string
          user_edited_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extracted_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_items_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_items_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "document_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_items_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_items_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_funnel_daily: {
        Row: {
          day: string
          events: number
          feature: string
          step: string
          updated_at: string
          users: number
        }
        Insert: {
          day: string
          events?: number
          feature: string
          step: string
          updated_at?: string
          users?: number
        }
        Update: {
          day?: string
          events?: number
          feature?: string
          step?: string
          updated_at?: string
          users?: number
        }
        Relationships: []
      }
      financial_backfill_checkpoints: {
        Row: {
          attempts: number
          cursor_date: string | null
          cursor_user_id: string | null
          job_key: string
          last_error: string | null
          phase: string
          rows_processed: number
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          cursor_date?: string | null
          cursor_user_id?: string | null
          job_key: string
          last_error?: string | null
          phase?: string
          rows_processed?: number
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          cursor_date?: string | null
          cursor_user_id?: string | null
          job_key?: string
          last_error?: string | null
          phase?: string
          rows_processed?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      financial_cash_bridges: {
        Row: {
          account_id: string | null
          adjustments: number
          calculated_closing_cash: number
          card_payments: number
          computed_at: string
          confidence: string
          confirmed_closing_cash: number
          created_at: string
          debt_interest_and_fees: number
          debt_principal_payments: number
          evidence: Json
          external_transfers_in: number
          external_transfers_out: number
          formula_version: string
          id: string
          internal_transfers_net: number
          investment_applications: number
          investment_redemptions: number
          loan_proceeds: number
          opening_cash: number
          operational_account_expense: number
          operational_income: number
          period_end: string
          period_start: string
          reconciliation_difference: number
          refunds_and_reimbursements: number
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          adjustments?: number
          calculated_closing_cash?: number
          card_payments?: number
          computed_at?: string
          confidence?: string
          confirmed_closing_cash?: number
          created_at?: string
          debt_interest_and_fees?: number
          debt_principal_payments?: number
          evidence?: Json
          external_transfers_in?: number
          external_transfers_out?: number
          formula_version?: string
          id?: string
          internal_transfers_net?: number
          investment_applications?: number
          investment_redemptions?: number
          loan_proceeds?: number
          opening_cash?: number
          operational_account_expense?: number
          operational_income?: number
          period_end: string
          period_start: string
          reconciliation_difference?: number
          refunds_and_reimbursements?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          adjustments?: number
          calculated_closing_cash?: number
          card_payments?: number
          computed_at?: string
          confidence?: string
          confirmed_closing_cash?: number
          created_at?: string
          debt_interest_and_fees?: number
          debt_principal_payments?: number
          evidence?: Json
          external_transfers_in?: number
          external_transfers_out?: number
          formula_version?: string
          id?: string
          internal_transfers_net?: number
          investment_applications?: number
          investment_redemptions?: number
          loan_proceeds?: number
          opening_cash?: number
          operational_account_expense?: number
          operational_income?: number
          period_end?: string
          period_start?: string
          reconciliation_difference?: number
          refunds_and_reimbursements?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_cash_bridges_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_current_snapshots: {
        Row: {
          account_consumption: number
          as_of_date: string
          available_balance: number
          behavioral_consumption: number
          card_consumption: number
          cash_outflow: number
          completeness: string
          computed_at: string
          confidence: string
          contract_version: string
          formula_versions: Json
          generated_at: string
          income: number
          missing_sources: string[]
          payload: Json | null
          period_start: string
          period_status: string
          source_freshness: Json
          user_id: string
        }
        Insert: {
          account_consumption?: number
          as_of_date: string
          available_balance?: number
          behavioral_consumption?: number
          card_consumption?: number
          cash_outflow?: number
          completeness?: string
          computed_at?: string
          confidence?: string
          contract_version?: string
          formula_versions?: Json
          generated_at?: string
          income?: number
          missing_sources?: string[]
          payload?: Json | null
          period_start: string
          period_status?: string
          source_freshness?: Json
          user_id: string
        }
        Update: {
          account_consumption?: number
          as_of_date?: string
          available_balance?: number
          behavioral_consumption?: number
          card_consumption?: number
          cash_outflow?: number
          completeness?: string
          computed_at?: string
          confidence?: string
          contract_version?: string
          formula_versions?: Json
          generated_at?: string
          income?: number
          missing_sources?: string[]
          payload?: Json | null
          period_start?: string
          period_status?: string
          source_freshness?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_current_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "financial_current_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      financial_daily_category_facts: {
        Row: {
          category_id: string | null
          computed_at: string
          consumption: number
          fact_date: string
          formula_version: string
          id: number
          transaction_count: number
          user_id: string
        }
        Insert: {
          category_id?: string | null
          computed_at?: string
          consumption?: number
          fact_date: string
          formula_version?: string
          id?: never
          transaction_count?: number
          user_id: string
        }
        Update: {
          category_id?: string | null
          computed_at?: string
          consumption?: number
          fact_date?: string
          formula_version?: string
          id?: never
          transaction_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_daily_category_facts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_daily_category_facts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "financial_daily_category_facts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      financial_daily_facts: {
        Row: {
          account_consumption: number
          behavioral_consumption: number
          card_consumption: number
          cash_outflow: number
          computed_at: string
          fact_date: string
          formula_version: string
          income: number
          transaction_count: number
          user_id: string
        }
        Insert: {
          account_consumption?: number
          behavioral_consumption?: number
          card_consumption?: number
          cash_outflow?: number
          computed_at?: string
          fact_date: string
          formula_version?: string
          income?: number
          transaction_count?: number
          user_id: string
        }
        Update: {
          account_consumption?: number
          behavioral_consumption?: number
          card_consumption?: number
          cash_outflow?: number
          computed_at?: string
          fact_date?: string
          formula_version?: string
          income?: number
          transaction_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_daily_facts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "financial_daily_facts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      financial_feature_flags: {
        Row: {
          anticipation_dry_run: boolean
          anticipation_whatsapp_enabled: boolean
          updated_at: string
          use_anticipation_engine: boolean
          use_canonical_financial_snapshot: boolean
          use_chart_templates: boolean
          use_commit_movement_rpc: boolean
          use_daily_financial_facts: boolean
          use_more_menu_v2: boolean
          use_nino_home_orchestrator: boolean
          use_nino_unified_intelligence: boolean
          use_report_templates: boolean
          use_reports_unified: boolean
          use_v2_artifact_normalizer: boolean
          use_wave1_bill_payment: boolean
          user_id: string
        }
        Insert: {
          anticipation_dry_run?: boolean
          anticipation_whatsapp_enabled?: boolean
          updated_at?: string
          use_anticipation_engine?: boolean
          use_canonical_financial_snapshot?: boolean
          use_chart_templates?: boolean
          use_commit_movement_rpc?: boolean
          use_daily_financial_facts?: boolean
          use_more_menu_v2?: boolean
          use_nino_home_orchestrator?: boolean
          use_nino_unified_intelligence?: boolean
          use_report_templates?: boolean
          use_reports_unified?: boolean
          use_v2_artifact_normalizer?: boolean
          use_wave1_bill_payment?: boolean
          user_id: string
        }
        Update: {
          anticipation_dry_run?: boolean
          anticipation_whatsapp_enabled?: boolean
          updated_at?: string
          use_anticipation_engine?: boolean
          use_canonical_financial_snapshot?: boolean
          use_chart_templates?: boolean
          use_commit_movement_rpc?: boolean
          use_daily_financial_facts?: boolean
          use_more_menu_v2?: boolean
          use_nino_home_orchestrator?: boolean
          use_nino_unified_intelligence?: boolean
          use_report_templates?: boolean
          use_reports_unified?: boolean
          use_v2_artifact_normalizer?: boolean
          use_wave1_bill_payment?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_feature_flags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "financial_feature_flags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      financial_insight_facts: {
        Row: {
          absolute_delta: number | null
          as_of: string
          category_id: string | null
          comparison_value: number | null
          confidence: number
          coverage: number
          created_at: string
          current_value: number | null
          evidence: Json
          fact_type: string
          formula_version: string
          id: string
          merchant_normalized: string | null
          metric_key: string
          percentage_delta: number | null
          period_end: string
          period_start: string
          source_snapshot_id: string | null
          transaction_ids: string[]
          updated_at: string
          user_id: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          absolute_delta?: number | null
          as_of?: string
          category_id?: string | null
          comparison_value?: number | null
          confidence?: number
          coverage?: number
          created_at?: string
          current_value?: number | null
          evidence?: Json
          fact_type: string
          formula_version?: string
          id?: string
          merchant_normalized?: string | null
          metric_key: string
          percentage_delta?: number | null
          period_end: string
          period_start: string
          source_snapshot_id?: string | null
          transaction_ids?: string[]
          updated_at?: string
          user_id: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          absolute_delta?: number | null
          as_of?: string
          category_id?: string | null
          comparison_value?: number | null
          confidence?: number
          coverage?: number
          created_at?: string
          current_value?: number | null
          evidence?: Json
          fact_type?: string
          formula_version?: string
          id?: string
          merchant_normalized?: string | null
          metric_key?: string
          percentage_delta?: number | null
          period_end?: string
          period_start?: string
          source_snapshot_id?: string | null
          transaction_ids?: string[]
          updated_at?: string
          user_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      financial_metric_diffs: {
        Row: {
          absolute_diff: number | null
          canonical_formula: string | null
          canonical_value: number | null
          comparison_contract: string | null
          created_at: string
          id: number
          legacy_formula: string | null
          legacy_value: number | null
          metadata: Json
          metric_key: string
          period_end: string
          period_start: string
          user_id: string
          within_tolerance: boolean | null
        }
        Insert: {
          absolute_diff?: number | null
          canonical_formula?: string | null
          canonical_value?: number | null
          comparison_contract?: string | null
          created_at?: string
          id?: never
          legacy_formula?: string | null
          legacy_value?: number | null
          metadata?: Json
          metric_key: string
          period_end: string
          period_start: string
          user_id: string
          within_tolerance?: boolean | null
        }
        Update: {
          absolute_diff?: number | null
          canonical_formula?: string | null
          canonical_value?: number | null
          comparison_contract?: string | null
          created_at?: string
          id?: never
          legacy_formula?: string | null
          legacy_value?: number | null
          metadata?: Json
          metric_key?: string
          period_end?: string
          period_start?: string
          user_id?: string
          within_tolerance?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_metric_diffs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "financial_metric_diffs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      financial_net_worth_bridges: {
        Row: {
          closing_cash: number
          closing_debts: number
          closing_investments: number
          closing_net_worth: number
          computed_at: string
          confidence: string
          created_at: string
          debt_principal_change: number
          evidence: Json
          formula_version: string
          id: string
          interest_and_fees: number
          investment_applications: number
          investment_redemptions: number
          investment_return: number
          opening_cash: number
          opening_debts: number
          opening_investments: number
          opening_net_worth: number
          operational_result: number
          period_end: string
          period_start: string
          updated_at: string
          user_id: string
          valuation_adjustments: number
        }
        Insert: {
          closing_cash?: number
          closing_debts?: number
          closing_investments?: number
          closing_net_worth?: number
          computed_at?: string
          confidence?: string
          created_at?: string
          debt_principal_change?: number
          evidence?: Json
          formula_version?: string
          id?: string
          interest_and_fees?: number
          investment_applications?: number
          investment_redemptions?: number
          investment_return?: number
          opening_cash?: number
          opening_debts?: number
          opening_investments?: number
          opening_net_worth?: number
          operational_result?: number
          period_end: string
          period_start: string
          updated_at?: string
          user_id: string
          valuation_adjustments?: number
        }
        Update: {
          closing_cash?: number
          closing_debts?: number
          closing_investments?: number
          closing_net_worth?: number
          computed_at?: string
          confidence?: string
          created_at?: string
          debt_principal_change?: number
          evidence?: Json
          formula_version?: string
          id?: string
          interest_and_fees?: number
          investment_applications?: number
          investment_redemptions?: number
          investment_return?: number
          opening_cash?: number
          opening_debts?: number
          opening_investments?: number
          opening_net_worth?: number
          operational_result?: number
          period_end?: string
          period_start?: string
          updated_at?: string
          user_id?: string
          valuation_adjustments?: number
        }
        Relationships: []
      }
      financial_reconciliation_audit: {
        Row: {
          actor_id: string | null
          amount: number | null
          created_at: string
          credit_card_id: string | null
          event_type: string
          evidence: Json
          id: string
          reason_code: string | null
          statement_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          amount?: number | null
          created_at?: string
          credit_card_id?: string | null
          event_type: string
          evidence?: Json
          id?: string
          reason_code?: string | null
          statement_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          amount?: number | null
          created_at?: string
          credit_card_id?: string | null
          event_type?: string
          evidence?: Json
          id?: string
          reason_code?: string | null
          statement_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_reconciliation_audit_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_reconciliation_audit_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "credit_card_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_report_deletions: {
        Row: {
          deleted_at: string
          deliveries_deleted: number
          highlights_deleted: number
          id: string
          metrics_deleted: number
          period_end: string | null
          period_start: string | null
          report_id: string
          report_type: string | null
          user_id: string
        }
        Insert: {
          deleted_at?: string
          deliveries_deleted?: number
          highlights_deleted?: number
          id?: string
          metrics_deleted?: number
          period_end?: string | null
          period_start?: string | null
          report_id: string
          report_type?: string | null
          user_id: string
        }
        Update: {
          deleted_at?: string
          deliveries_deleted?: number
          highlights_deleted?: number
          id?: string
          metrics_deleted?: number
          period_end?: string | null
          period_start?: string | null
          report_id?: string
          report_type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      financial_report_deliveries: {
        Row: {
          attempt_count: number
          channel: string
          created_at: string
          delivered_at: string | null
          error_code: string | null
          error_details: string | null
          failed_at: string | null
          id: string
          last_attempt_at: string | null
          provider_message_id: string | null
          recipient: string | null
          report_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          channel: string
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_details?: string | null
          failed_at?: string | null
          id?: string
          last_attempt_at?: string | null
          provider_message_id?: string | null
          recipient?: string | null
          report_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          channel?: string
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_details?: string | null
          failed_at?: string | null
          id?: string
          last_attempt_at?: string | null
          provider_message_id?: string | null
          recipient?: string | null
          report_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_report_deliveries_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "financial_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_report_highlights: {
        Row: {
          body: string
          category: string | null
          confidence: string
          created_at: string
          cta_label: string | null
          cta_route: string | null
          dedup_key: string
          detector_key: string
          detector_version: string
          evidence: Json
          id: string
          priority: number
          report_id: string
          selection_reason: string | null
          sort_order: number
          title: string
          type: string
        }
        Insert: {
          body: string
          category?: string | null
          confidence?: string
          created_at?: string
          cta_label?: string | null
          cta_route?: string | null
          dedup_key: string
          detector_key: string
          detector_version?: string
          evidence?: Json
          id?: string
          priority?: number
          report_id: string
          selection_reason?: string | null
          sort_order?: number
          title: string
          type?: string
        }
        Update: {
          body?: string
          category?: string | null
          confidence?: string
          created_at?: string
          cta_label?: string | null
          cta_route?: string | null
          dedup_key?: string
          detector_key?: string
          detector_version?: string
          evidence?: Json
          id?: string
          priority?: number
          report_id?: string
          selection_reason?: string | null
          sort_order?: number
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_report_highlights_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "financial_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_report_metrics: {
        Row: {
          comparison_percentage: number | null
          comparison_value: number | null
          created_at: string
          evidence: Json
          id: string
          metric_key: string
          metric_label: string
          metric_text: string | null
          metric_value: number | null
          report_id: string
          sort_order: number
          source: string
          unit: string
        }
        Insert: {
          comparison_percentage?: number | null
          comparison_value?: number | null
          created_at?: string
          evidence?: Json
          id?: string
          metric_key: string
          metric_label?: string
          metric_text?: string | null
          metric_value?: number | null
          report_id: string
          sort_order?: number
          source?: string
          unit?: string
        }
        Update: {
          comparison_percentage?: number | null
          comparison_value?: number | null
          created_at?: string
          evidence?: Json
          id?: string
          metric_key?: string
          metric_label?: string
          metric_text?: string | null
          metric_value?: number | null
          report_id?: string
          sort_order?: number
          source?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_report_metrics_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "financial_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_report_templates: {
        Row: {
          active: boolean
          created_at: string
          definition: Json
          name: string
          template_key: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          definition: Json
          name: string
          template_key: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          definition?: Json
          name?: string
          template_key?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      financial_reports: {
        Row: {
          closing_text: string | null
          created_at: string
          data_quality_flags: Json
          data_quality_status: string
          executive_summary: string | null
          finance_contract_version: string
          generated_at: string
          health_breakdown: Json
          health_score: number | null
          id: string
          idempotency_key: string | null
          insight_catalog_version: string
          payload: Json
          period_end: string
          period_start: string
          published_at: string | null
          report_type: string
          request_id: string | null
          status: string
          template_version: string
          text_fallback_reason: string | null
          text_source: string
          timezone: string
          updated_at: string
          user_id: string
          viewed_at: string | null
        }
        Insert: {
          closing_text?: string | null
          created_at?: string
          data_quality_flags?: Json
          data_quality_status?: string
          executive_summary?: string | null
          finance_contract_version?: string
          generated_at?: string
          health_breakdown?: Json
          health_score?: number | null
          id?: string
          idempotency_key?: string | null
          insight_catalog_version?: string
          payload?: Json
          period_end: string
          period_start: string
          published_at?: string | null
          report_type: string
          request_id?: string | null
          status?: string
          template_version?: string
          text_fallback_reason?: string | null
          text_source?: string
          timezone?: string
          updated_at?: string
          user_id: string
          viewed_at?: string | null
        }
        Update: {
          closing_text?: string | null
          created_at?: string
          data_quality_flags?: Json
          data_quality_status?: string
          executive_summary?: string | null
          finance_contract_version?: string
          generated_at?: string
          health_breakdown?: Json
          health_score?: number | null
          id?: string
          idempotency_key?: string | null
          insight_catalog_version?: string
          payload?: Json
          period_end?: string
          period_start?: string
          published_at?: string | null
          report_type?: string
          request_id?: string | null
          status?: string
          template_version?: string
          text_fallback_reason?: string | null
          text_source?: string
          timezone?: string
          updated_at?: string
          user_id?: string
          viewed_at?: string | null
        }
        Relationships: []
      }
      financial_situation_actions: {
        Row: {
          action_key: string
          action_type: string
          created_at: string
          estimated_impact: number | null
          expires_at: string | null
          explanation: string | null
          id: string
          metadata: Json
          priority: number
          route: string
          situation_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          action_key: string
          action_type: string
          created_at?: string
          estimated_impact?: number | null
          expires_at?: string | null
          explanation?: string | null
          id?: string
          metadata?: Json
          priority?: number
          route: string
          situation_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          action_key?: string
          action_type?: string
          created_at?: string
          estimated_impact?: number | null
          expires_at?: string | null
          explanation?: string | null
          id?: string
          metadata?: Json
          priority?: number
          route?: string
          situation_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_situation_actions_situation_id_fkey"
            columns: ["situation_id"]
            isOneToOne: false
            referencedRelation: "financial_situations"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_situation_events: {
        Row: {
          delta_amount: number | null
          event_type: string
          from_status: string | null
          id: string
          metadata: Json
          narrative: string
          occurred_at: string
          situation_id: string
          to_status: string | null
          user_id: string
        }
        Insert: {
          delta_amount?: number | null
          event_type: string
          from_status?: string | null
          id?: string
          metadata?: Json
          narrative: string
          occurred_at?: string
          situation_id: string
          to_status?: string | null
          user_id: string
        }
        Update: {
          delta_amount?: number | null
          event_type?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          narrative?: string
          occurred_at?: string
          situation_id?: string
          to_status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_situation_events_situation_id_fkey"
            columns: ["situation_id"]
            isOneToOne: false
            referencedRelation: "financial_situations"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_situation_evidence: {
        Row: {
          confidence: number | null
          contribution_amount: number | null
          contribution_pct: number | null
          created_at: string
          evaluation_run_id: string | null
          evidence_type: string
          fact_id: string | null
          id: string
          metadata: Json
          metric_key: string | null
          opportunity_id: string | null
          pattern_id: string | null
          report_id: string | null
          situation_id: string
          transaction_id: string | null
          value: number | null
        }
        Insert: {
          confidence?: number | null
          contribution_amount?: number | null
          contribution_pct?: number | null
          created_at?: string
          evaluation_run_id?: string | null
          evidence_type: string
          fact_id?: string | null
          id?: string
          metadata?: Json
          metric_key?: string | null
          opportunity_id?: string | null
          pattern_id?: string | null
          report_id?: string | null
          situation_id: string
          transaction_id?: string | null
          value?: number | null
        }
        Update: {
          confidence?: number | null
          contribution_amount?: number | null
          contribution_pct?: number | null
          created_at?: string
          evaluation_run_id?: string | null
          evidence_type?: string
          fact_id?: string | null
          id?: string
          metadata?: Json
          metric_key?: string | null
          opportunity_id?: string | null
          pattern_id?: string | null
          report_id?: string | null
          situation_id?: string
          transaction_id?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_situation_evidence_evaluation_run_id_fkey"
            columns: ["evaluation_run_id"]
            isOneToOne: false
            referencedRelation: "nino_diagnosis_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_situation_evidence_fact_id_fkey"
            columns: ["fact_id"]
            isOneToOne: false
            referencedRelation: "financial_insight_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_situation_evidence_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "anticipation_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_situation_evidence_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "behavioral_patterns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_situation_evidence_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "financial_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_situation_evidence_situation_id_fkey"
            columns: ["situation_id"]
            isOneToOne: false
            referencedRelation: "financial_situations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_situation_evidence_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_situation_feedback: {
        Row: {
          created_at: string
          feedback: string
          id: string
          item_id: string | null
          situation_id: string
          surface: string
          user_id: string
        }
        Insert: {
          created_at?: string
          feedback: string
          id?: string
          item_id?: string | null
          situation_id: string
          surface: string
          user_id: string
        }
        Update: {
          created_at?: string
          feedback?: string
          id?: string
          item_id?: string | null
          situation_id?: string
          surface?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_situation_feedback_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "nino_intelligence_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_situation_feedback_situation_id_fkey"
            columns: ["situation_id"]
            isOneToOne: false
            referencedRelation: "financial_situations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_situation_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "financial_situation_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      financial_situations: {
        Row: {
          absolute_delta: number | null
          baseline_value: number | null
          cause_summary: string | null
          confidence: number
          consequence_summary: string | null
          created_at: string
          current_value: number | null
          evaluation: Json
          forecast_summary: string | null
          formula_version: string
          headline: string
          id: string
          impact_amount: number | null
          last_evaluation_run_id: string | null
          narrative_role: string
          one_line_summary: string | null
          percentage_delta: number | null
          period_end: string | null
          period_start: string | null
          relevance_score: number
          resolved_at: string | null
          run_mode: string
          severity: string
          situation_key: string
          situation_type: string
          status: string
          supersedes_id: string | null
          temporal_scope: string
          updated_at: string
          user_id: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          absolute_delta?: number | null
          baseline_value?: number | null
          cause_summary?: string | null
          confidence: number
          consequence_summary?: string | null
          created_at?: string
          current_value?: number | null
          evaluation?: Json
          forecast_summary?: string | null
          formula_version?: string
          headline: string
          id?: string
          impact_amount?: number | null
          last_evaluation_run_id?: string | null
          narrative_role?: string
          one_line_summary?: string | null
          percentage_delta?: number | null
          period_end?: string | null
          period_start?: string | null
          relevance_score?: number
          resolved_at?: string | null
          run_mode?: string
          severity: string
          situation_key: string
          situation_type: string
          status: string
          supersedes_id?: string | null
          temporal_scope: string
          updated_at?: string
          user_id: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          absolute_delta?: number | null
          baseline_value?: number | null
          cause_summary?: string | null
          confidence?: number
          consequence_summary?: string | null
          created_at?: string
          current_value?: number | null
          evaluation?: Json
          forecast_summary?: string | null
          formula_version?: string
          headline?: string
          id?: string
          impact_amount?: number | null
          last_evaluation_run_id?: string | null
          narrative_role?: string
          one_line_summary?: string | null
          percentage_delta?: number | null
          period_end?: string | null
          period_start?: string | null
          relevance_score?: number
          resolved_at?: string | null
          run_mode?: string
          severity?: string
          situation_key?: string
          situation_type?: string
          status?: string
          supersedes_id?: string | null
          temporal_scope?: string
          updated_at?: string
          user_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_situations_last_evaluation_run_id_fkey"
            columns: ["last_evaluation_run_id"]
            isOneToOne: false
            referencedRelation: "nino_diagnosis_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_situations_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "financial_situations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_situations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "financial_situations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      goal_contributions: {
        Row: {
          account_id: string | null
          amount: number
          created_at: string
          goal_id: string
          id: string
          notes: string | null
          occurred_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          created_at?: string
          goal_id: string
          id?: string
          notes?: string | null
          occurred_at: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          created_at?: string
          goal_id?: string
          id?: string
          notes?: string | null
          occurred_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_contributions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_contributions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_contributions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_contributions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      goals: {
        Row: {
          created_at: string
          donation_due_day: number
          donation_end_date: string | null
          donation_income_category_ids: string[]
          donation_income_scope: string
          donation_mode: string | null
          donation_percent: number | null
          id: string
          kind: string
          monthly_target: number | null
          name: string
          notes: string | null
          priority: number
          status: Database["public"]["Enums"]["goal_status"]
          target_amount: number
          target_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          donation_due_day?: number
          donation_end_date?: string | null
          donation_income_category_ids?: string[]
          donation_income_scope?: string
          donation_mode?: string | null
          donation_percent?: number | null
          id?: string
          kind?: string
          monthly_target?: number | null
          name: string
          notes?: string | null
          priority?: number
          status?: Database["public"]["Enums"]["goal_status"]
          target_amount: number
          target_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          donation_due_day?: number
          donation_end_date?: string | null
          donation_income_category_ids?: string[]
          donation_income_scope?: string
          donation_mode?: string | null
          donation_percent?: number | null
          id?: string
          kind?: string
          monthly_target?: number | null
          name?: string
          notes?: string | null
          priority?: number
          status?: Database["public"]["Enums"]["goal_status"]
          target_amount?: number
          target_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          first_seen_at: string
          key: string
          result_ref: string | null
          scope: string
          user_id: string | null
        }
        Insert: {
          first_seen_at?: string
          key: string
          result_ref?: string | null
          scope: string
          user_id?: string | null
        }
        Update: {
          first_seen_at?: string
          key?: string
          result_ref?: string | null
          scope?: string
          user_id?: string | null
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          failed_rows: number
          id: string
          imported_count: number
          imported_rows: number
          skipped_count: number
          source: string
          status: Database["public"]["Enums"]["import_batch_status"]
          total_rows: number
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          failed_rows?: number
          id?: string
          imported_count?: number
          imported_rows?: number
          skipped_count?: number
          source: string
          status?: Database["public"]["Enums"]["import_batch_status"]
          total_rows?: number
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          failed_rows?: number
          id?: string
          imported_count?: number
          imported_rows?: number
          skipped_count?: number
          source?: string
          status?: Database["public"]["Enums"]["import_batch_status"]
          total_rows?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "import_batches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      import_rows: {
        Row: {
          action: string | null
          batch_id: string
          created_at: string
          entity: string | null
          error: string | null
          external_id: string | null
          id: string
          imported: boolean
          notes: string | null
          payload: Json
          row_index: number
          user_id: string
        }
        Insert: {
          action?: string | null
          batch_id: string
          created_at?: string
          entity?: string | null
          error?: string | null
          external_id?: string | null
          id?: string
          imported?: boolean
          notes?: string | null
          payload: Json
          row_index: number
          user_id: string
        }
        Update: {
          action?: string | null
          batch_id?: string
          created_at?: string
          entity?: string | null
          error?: string | null
          external_id?: string | null
          id?: string
          imported?: boolean
          notes?: string | null
          payload?: Json
          row_index?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "import_rows_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      inbound_messages: {
        Row: {
          body: string | null
          detected_intent: string | null
          document_import_id: string | null
          from_phone: string
          has_media: boolean
          id: string
          ignored_reason: string | null
          logical_dedup_key: string | null
          media_bytes: number | null
          media_error: string | null
          media_kind: string | null
          media_mime: string | null
          media_storage_path: string | null
          participant_id: string | null
          processed_at: string | null
          provider: Database["public"]["Enums"]["messaging_provider"]
          provider_message_id: string
          raw_hash: string | null
          received_at: string
          to_phone: string | null
        }
        Insert: {
          body?: string | null
          detected_intent?: string | null
          document_import_id?: string | null
          from_phone: string
          has_media?: boolean
          id?: string
          ignored_reason?: string | null
          logical_dedup_key?: string | null
          media_bytes?: number | null
          media_error?: string | null
          media_kind?: string | null
          media_mime?: string | null
          media_storage_path?: string | null
          participant_id?: string | null
          processed_at?: string | null
          provider: Database["public"]["Enums"]["messaging_provider"]
          provider_message_id: string
          raw_hash?: string | null
          received_at?: string
          to_phone?: string | null
        }
        Update: {
          body?: string | null
          detected_intent?: string | null
          document_import_id?: string | null
          from_phone?: string
          has_media?: boolean
          id?: string
          ignored_reason?: string | null
          logical_dedup_key?: string | null
          media_bytes?: number | null
          media_error?: string | null
          media_kind?: string | null
          media_mime?: string | null
          media_storage_path?: string | null
          participant_id?: string | null
          processed_at?: string | null
          provider?: Database["public"]["Enums"]["messaging_provider"]
          provider_message_id?: string
          raw_hash?: string | null
          received_at?: string
          to_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_messages_document_import_id_fkey"
            columns: ["document_import_id"]
            isOneToOne: false
            referencedRelation: "document_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_messages_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "my_shared_charges"
            referencedColumns: ["participant_id"]
          },
          {
            foreignKeyName: "inbound_messages_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "shared_expense_participants"
            referencedColumns: ["id"]
          },
        ]
      }
      intelligence_metric_registry: {
        Row: {
          active: boolean
          default_window_days: number
          description: string
          formula: string
          formula_version: string
          include_zero_days: boolean
          label: string
          metric_key: string
          minimum_sample: number
          outlier_policy: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          default_window_days: number
          description: string
          formula: string
          formula_version: string
          include_zero_days?: boolean
          label: string
          metric_key: string
          minimum_sample: number
          outlier_policy: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          default_window_days?: number
          description?: string
          formula?: string
          formula_version?: string
          include_zero_days?: boolean
          label?: string
          metric_key?: string
          minimum_sample?: number
          outlier_policy?: string
          updated_at?: string
        }
        Relationships: []
      }
      investment_aliases: {
        Row: {
          alias: string
          created_at: string
          id: string
          investment_id: string
          normalized_alias: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          investment_id: string
          normalized_alias: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          investment_id?: string
          normalized_alias?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investment_aliases_investment_id_fkey"
            columns: ["investment_id"]
            isOneToOne: false
            referencedRelation: "investments"
            referencedColumns: ["id"]
          },
        ]
      }
      investment_movements: {
        Row: {
          amount: number
          applied: boolean
          created_at: string
          id: string
          investment_id: string
          kind: string
          notes: string | null
          occurred_at: string
          principal_amount: number | null
          transaction_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          applied?: boolean
          created_at?: string
          id?: string
          investment_id: string
          kind: string
          notes?: string | null
          occurred_at: string
          principal_amount?: number | null
          transaction_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          applied?: boolean
          created_at?: string
          id?: string
          investment_id?: string
          kind?: string
          notes?: string | null
          occurred_at?: string
          principal_amount?: number | null
          transaction_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investment_movements_investment_id_fkey"
            columns: ["investment_id"]
            isOneToOne: false
            referencedRelation: "investments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_movements_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_movements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "investment_movements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      investments: {
        Row: {
          category: string
          created_at: string
          current_value: number
          goal_id: string | null
          id: string
          institution: string | null
          invested_amount: number
          name: string
          notes: string | null
          reference_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          created_at?: string
          current_value?: number
          goal_id?: string | null
          id?: string
          institution?: string | null
          invested_amount?: number
          name: string
          notes?: string | null
          reference_date?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          current_value?: number
          goal_id?: string | null
          id?: string
          institution?: string | null
          invested_amount?: number
          name?: string
          notes?: string | null
          reference_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investments_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "investments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      job_heartbeats: {
        Row: {
          failed: number
          job_key: string
          last_error_code: string | null
          last_ok: boolean | null
          last_run_at: string | null
          next_run_at: string | null
          processed: number
          stages: Json
          updated_at: string
        }
        Insert: {
          failed?: number
          job_key: string
          last_error_code?: string | null
          last_ok?: boolean | null
          last_run_at?: string | null
          next_run_at?: string | null
          processed?: number
          stages?: Json
          updated_at?: string
        }
        Update: {
          failed?: number
          job_key?: string
          last_error_code?: string | null
          last_ok?: boolean | null
          last_run_at?: string | null
          next_run_at?: string | null
          processed?: number
          stages?: Json
          updated_at?: string
        }
        Relationships: []
      }
      merchant_aliases: {
        Row: {
          alias_key: string
          canonical_name: string | null
          category_id: string | null
          confidence: number | null
          confirmed_by_user_at: string | null
          created_at: string
          friendly_name: string
          hits: number
          id: string
          last_used_at: string
          learned_from: string
          normalized_pattern: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          alias_key: string
          canonical_name?: string | null
          category_id?: string | null
          confidence?: number | null
          confirmed_by_user_at?: string | null
          created_at?: string
          friendly_name: string
          hits?: number
          id?: string
          last_used_at?: string
          learned_from?: string
          normalized_pattern?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          alias_key?: string
          canonical_name?: string | null
          category_id?: string | null
          confidence?: number | null
          confirmed_by_user_at?: string | null
          created_at?: string
          friendly_name?: string
          hits?: number
          id?: string
          last_used_at?: string
          learned_from?: string
          normalized_pattern?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_aliases_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_aliases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "merchant_aliases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      message_delivery_events: {
        Row: {
          id: string
          occurred_at: string
          outbound_id: string | null
          payload_hash: string | null
          provider_message_id: string | null
          status: Database["public"]["Enums"]["msg_status"]
        }
        Insert: {
          id?: string
          occurred_at?: string
          outbound_id?: string | null
          payload_hash?: string | null
          provider_message_id?: string | null
          status: Database["public"]["Enums"]["msg_status"]
        }
        Update: {
          id?: string
          occurred_at?: string
          outbound_id?: string | null
          payload_hash?: string | null
          provider_message_id?: string | null
          status?: Database["public"]["Enums"]["msg_status"]
        }
        Relationships: [
          {
            foreignKeyName: "message_delivery_events_outbound_id_fkey"
            columns: ["outbound_id"]
            isOneToOne: false
            referencedRelation: "outbound_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_delivery_events_outbound_id_fkey"
            columns: ["outbound_id"]
            isOneToOne: false
            referencedRelation: "v_outbound_sla_breach"
            referencedColumns: ["id"]
          },
        ]
      }
      nino_diagnosis_config: {
        Row: {
          assembler_version: string
          communication_mode: string
          contract_version: string
          enabled: boolean
          max_supporting: number
          min_primary_confidence: number
          rollout_mode: string
          singleton: boolean
          updated_at: string
        }
        Insert: {
          assembler_version?: string
          communication_mode?: string
          contract_version?: string
          enabled?: boolean
          max_supporting?: number
          min_primary_confidence?: number
          rollout_mode?: string
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          assembler_version?: string
          communication_mode?: string
          contract_version?: string
          enabled?: boolean
          max_supporting?: number
          min_primary_confidence?: number
          rollout_mode?: string
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      nino_diagnosis_runs: {
        Row: {
          as_of: string
          error_message: string | null
          finished_at: string | null
          id: string
          projected_items: number
          run_mode: string
          situations_created: number
          situations_resolved: number
          situations_updated: number
          source: string
          started_at: string
          status: string
          user_id: string
          warnings: Json
        }
        Insert: {
          as_of: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          projected_items?: number
          run_mode: string
          situations_created?: number
          situations_resolved?: number
          situations_updated?: number
          source?: string
          started_at?: string
          status?: string
          user_id: string
          warnings?: Json
        }
        Update: {
          as_of?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          projected_items?: number
          run_mode?: string
          situations_created?: number
          situations_resolved?: number
          situations_updated?: number
          source?: string
          started_at?: string
          status?: string
          user_id?: string
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "nino_diagnosis_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "nino_diagnosis_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      nino_diagnosis_snapshots: {
        Row: {
          as_of: string
          confidence: number
          contract_version: string
          created_at: string
          data_quality: Json
          forecast: Json
          id: string
          is_current: boolean
          overall_state: string
          payload: Json
          primary_action_id: string | null
          primary_situation_id: string | null
          rationale: Json
          run_mode: string
          supporting_situation_ids: string[]
          user_id: string
        }
        Insert: {
          as_of: string
          confidence?: number
          contract_version?: string
          created_at?: string
          data_quality?: Json
          forecast?: Json
          id?: string
          is_current?: boolean
          overall_state: string
          payload?: Json
          primary_action_id?: string | null
          primary_situation_id?: string | null
          rationale?: Json
          run_mode?: string
          supporting_situation_ids?: string[]
          user_id: string
        }
        Update: {
          as_of?: string
          confidence?: number
          contract_version?: string
          created_at?: string
          data_quality?: Json
          forecast?: Json
          id?: string
          is_current?: boolean
          overall_state?: string
          payload?: Json
          primary_action_id?: string | null
          primary_situation_id?: string | null
          rationale?: Json
          run_mode?: string
          supporting_situation_ids?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nino_diagnosis_snapshots_primary_action_id_fkey"
            columns: ["primary_action_id"]
            isOneToOne: false
            referencedRelation: "financial_situation_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nino_diagnosis_snapshots_primary_situation_id_fkey"
            columns: ["primary_situation_id"]
            isOneToOne: false
            referencedRelation: "financial_situations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nino_diagnosis_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "nino_diagnosis_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      nino_duplicate_decisions: {
        Row: {
          created_at: string
          decision: string
          id: string
          pair_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decision: string
          id?: string
          pair_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          decision?: string
          id?: string
          pair_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      nino_intelligence_items: {
        Row: {
          acted_at: string | null
          category: string
          confidence: number
          created_at: string
          created_by: string
          data_quality: string
          dedup_key: string
          dismissed_at: string | null
          evidence: Json
          explanation: string
          facts: Json
          formula_version: string
          group_key: string | null
          group_size: number
          id: string
          impact_amount: number | null
          impact_pct: number | null
          insight_id: string | null
          kind: Database["public"]["Enums"]["nino_item_kind"]
          logical_topic_key: string | null
          narrative_version: string
          opportunity_id: string | null
          pattern_id: string | null
          primary_action: Json | null
          priority: number
          report_id: string | null
          review_id: string | null
          secondary_action: Json | null
          selection_reason: Json
          severity: string
          source: string
          source_period_end: string | null
          source_period_start: string | null
          status: Database["public"]["Enums"]["nino_item_status"]
          suggestion_id: string | null
          summary: string
          superseded_at: string | null
          suppression_reason: string | null
          temporal_role: Database["public"]["Enums"]["nino_temporal_role"]
          title: string
          updated_at: string
          user_id: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          acted_at?: string | null
          category?: string
          confidence?: number
          created_at?: string
          created_by?: string
          data_quality?: string
          dedup_key: string
          dismissed_at?: string | null
          evidence?: Json
          explanation?: string
          facts?: Json
          formula_version?: string
          group_key?: string | null
          group_size?: number
          id?: string
          impact_amount?: number | null
          impact_pct?: number | null
          insight_id?: string | null
          kind: Database["public"]["Enums"]["nino_item_kind"]
          logical_topic_key?: string | null
          narrative_version?: string
          opportunity_id?: string | null
          pattern_id?: string | null
          primary_action?: Json | null
          priority?: number
          report_id?: string | null
          review_id?: string | null
          secondary_action?: Json | null
          selection_reason?: Json
          severity?: string
          source?: string
          source_period_end?: string | null
          source_period_start?: string | null
          status?: Database["public"]["Enums"]["nino_item_status"]
          suggestion_id?: string | null
          summary?: string
          superseded_at?: string | null
          suppression_reason?: string | null
          temporal_role?: Database["public"]["Enums"]["nino_temporal_role"]
          title: string
          updated_at?: string
          user_id: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          acted_at?: string | null
          category?: string
          confidence?: number
          created_at?: string
          created_by?: string
          data_quality?: string
          dedup_key?: string
          dismissed_at?: string | null
          evidence?: Json
          explanation?: string
          facts?: Json
          formula_version?: string
          group_key?: string | null
          group_size?: number
          id?: string
          impact_amount?: number | null
          impact_pct?: number | null
          insight_id?: string | null
          kind?: Database["public"]["Enums"]["nino_item_kind"]
          logical_topic_key?: string | null
          narrative_version?: string
          opportunity_id?: string | null
          pattern_id?: string | null
          primary_action?: Json | null
          priority?: number
          report_id?: string | null
          review_id?: string | null
          secondary_action?: Json | null
          selection_reason?: Json
          severity?: string
          source?: string
          source_period_end?: string | null
          source_period_start?: string | null
          status?: Database["public"]["Enums"]["nino_item_status"]
          suggestion_id?: string | null
          summary?: string
          superseded_at?: string | null
          suppression_reason?: string | null
          temporal_role?: Database["public"]["Enums"]["nino_temporal_role"]
          title?: string
          updated_at?: string
          user_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nino_intelligence_items_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "anticipation_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nino_intelligence_items_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "behavioral_patterns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nino_intelligence_items_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "financial_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nino_intelligence_items_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "advisor_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      nino_item_exposures: {
        Row: {
          acted_at: string | null
          blocked_reason: string | null
          channel: string
          created_at: string
          feedback: string | null
          id: string
          item_id: string
          outcome: string | null
          rank: number | null
          selection_reason: string | null
          shown_at: string | null
          surface: string
          updated_at: string
          user_id: string
        }
        Insert: {
          acted_at?: string | null
          blocked_reason?: string | null
          channel?: string
          created_at?: string
          feedback?: string | null
          id?: string
          item_id: string
          outcome?: string | null
          rank?: number | null
          selection_reason?: string | null
          shown_at?: string | null
          surface: string
          updated_at?: string
          user_id: string
        }
        Update: {
          acted_at?: string | null
          blocked_reason?: string | null
          channel?: string
          created_at?: string
          feedback?: string | null
          id?: string
          item_id?: string
          outcome?: string | null
          rank?: number | null
          selection_reason?: string | null
          shown_at?: string | null
          surface?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nino_item_exposures_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "nino_intelligence_items"
            referencedColumns: ["id"]
          },
        ]
      }
      nino_narrative_catalog: {
        Row: {
          active: boolean
          allowed_channels: string[]
          allowed_terms: string[]
          body_template: string
          caution_level: string
          created_at: string
          default_cta_label: string | null
          default_cta_route: string | null
          forbidden_terms: string[]
          id: string
          kind: Database["public"]["Enums"]["nino_item_kind"]
          narrative_key: string
          narrative_version: string
          required_evidence: string[]
          title_template: string
          tone: string
          updated_at: string
          variant: string
        }
        Insert: {
          active?: boolean
          allowed_channels?: string[]
          allowed_terms?: string[]
          body_template: string
          caution_level?: string
          created_at?: string
          default_cta_label?: string | null
          default_cta_route?: string | null
          forbidden_terms?: string[]
          id?: string
          kind: Database["public"]["Enums"]["nino_item_kind"]
          narrative_key: string
          narrative_version?: string
          required_evidence?: string[]
          title_template: string
          tone?: string
          updated_at?: string
          variant?: string
        }
        Update: {
          active?: boolean
          allowed_channels?: string[]
          allowed_terms?: string[]
          body_template?: string
          caution_level?: string
          created_at?: string
          default_cta_label?: string | null
          default_cta_route?: string | null
          forbidden_terms?: string[]
          id?: string
          kind?: Database["public"]["Enums"]["nino_item_kind"]
          narrative_key?: string
          narrative_version?: string
          required_evidence?: string[]
          title_template?: string
          tone?: string
          updated_at?: string
          variant?: string
        }
        Relationships: []
      }
      nino_surface_state: {
        Row: {
          continuity_topic: string | null
          created_at: string
          id: string
          last_item_id: string | null
          last_seen_at: string
          section: string
          surface: string
          updated_at: string
          user_id: string
        }
        Insert: {
          continuity_topic?: string | null
          created_at?: string
          id?: string
          last_item_id?: string | null
          last_seen_at?: string
          section?: string
          surface: string
          updated_at?: string
          user_id: string
        }
        Update: {
          continuity_topic?: string | null
          created_at?: string
          id?: string
          last_item_id?: string | null
          last_seen_at?: string
          section?: string
          surface?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          achievement: boolean
          agent_confirmation: boolean
          anticipation_consent_at: string | null
          anticipation_enabled: boolean
          anticipation_kinds: Json
          anticipation_max_per_week: number
          anticipation_whatsapp: boolean
          emotional_checkin: boolean
          goal_reached: boolean
          import_done: boolean
          max_proactive_per_day: number
          max_proactive_per_week: number
          monthly_report_enabled: boolean
          muted_pattern_ids: string[]
          muted_proactive_kinds: string[]
          proactive_financial: boolean
          quiet_behavior: string
          quiet_end: string | null
          quiet_start: string | null
          recurrence_due: boolean
          report_channel: string
          report_detail_level: string
          report_hour: number
          report_timezone: string
          report_tone: string
          report_weekday: number
          smart_tips: boolean
          split_reminder: boolean
          system: boolean
          timezone: string | null
          updated_at: string
          user_id: string
          weekly_report_enabled: boolean
          whatsapp_proactive: boolean
        }
        Insert: {
          achievement?: boolean
          agent_confirmation?: boolean
          anticipation_consent_at?: string | null
          anticipation_enabled?: boolean
          anticipation_kinds?: Json
          anticipation_max_per_week?: number
          anticipation_whatsapp?: boolean
          emotional_checkin?: boolean
          goal_reached?: boolean
          import_done?: boolean
          max_proactive_per_day?: number
          max_proactive_per_week?: number
          monthly_report_enabled?: boolean
          muted_pattern_ids?: string[]
          muted_proactive_kinds?: string[]
          proactive_financial?: boolean
          quiet_behavior?: string
          quiet_end?: string | null
          quiet_start?: string | null
          recurrence_due?: boolean
          report_channel?: string
          report_detail_level?: string
          report_hour?: number
          report_timezone?: string
          report_tone?: string
          report_weekday?: number
          smart_tips?: boolean
          split_reminder?: boolean
          system?: boolean
          timezone?: string | null
          updated_at?: string
          user_id: string
          weekly_report_enabled?: boolean
          whatsapp_proactive?: boolean
        }
        Update: {
          achievement?: boolean
          agent_confirmation?: boolean
          anticipation_consent_at?: string | null
          anticipation_enabled?: boolean
          anticipation_kinds?: Json
          anticipation_max_per_week?: number
          anticipation_whatsapp?: boolean
          emotional_checkin?: boolean
          goal_reached?: boolean
          import_done?: boolean
          max_proactive_per_day?: number
          max_proactive_per_week?: number
          monthly_report_enabled?: boolean
          muted_pattern_ids?: string[]
          muted_proactive_kinds?: string[]
          proactive_financial?: boolean
          quiet_behavior?: string
          quiet_end?: string | null
          quiet_start?: string | null
          recurrence_due?: boolean
          report_channel?: string
          report_detail_level?: string
          report_hour?: number
          report_timezone?: string
          report_tone?: string
          report_weekday?: number
          smart_tips?: boolean
          split_reminder?: boolean
          system?: boolean
          timezone?: string | null
          updated_at?: string
          user_id?: string
          weekly_report_enabled?: boolean
          whatsapp_proactive?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          body: string | null
          created_at: string
          dedup_key: string
          id: string
          logical_dedup_key: string | null
          read_at: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          action_url?: string | null
          body?: string | null
          created_at?: string
          dedup_key: string
          id?: string
          logical_dedup_key?: string | null
          read_at?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          action_url?: string | null
          body?: string | null
          created_at?: string
          dedup_key?: string
          id?: string
          logical_dedup_key?: string | null
          read_at?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      outbound_messages: {
        Row: {
          accepted_at: string | null
          artifact_id: string | null
          attempts: number
          body: string
          channel: string
          claimed_at: string | null
          context_id: string | null
          context_type: string | null
          created_at: string
          dead_letter_at: string | null
          delivered_at: string | null
          feature: string | null
          id: string
          idempotency_key: string | null
          inbound_message_id: string | null
          kind: string
          last_ack_at: string | null
          last_error: string | null
          lease_expires_at: string | null
          media_mime: string | null
          media_status: string | null
          media_url: string | null
          metadata: Json
          next_attempt_at: string
          participant_id: string | null
          provider: Database["public"]["Enums"]["messaging_provider"]
          provider_message_id: string | null
          read_at: string | null
          retry_count: number
          sent_at: string | null
          sla_breach_at: string | null
          status: Database["public"]["Enums"]["msg_status"]
          surface: string | null
          to_phone: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          artifact_id?: string | null
          attempts?: number
          body: string
          channel?: string
          claimed_at?: string | null
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          dead_letter_at?: string | null
          delivered_at?: string | null
          feature?: string | null
          id?: string
          idempotency_key?: string | null
          inbound_message_id?: string | null
          kind?: string
          last_ack_at?: string | null
          last_error?: string | null
          lease_expires_at?: string | null
          media_mime?: string | null
          media_status?: string | null
          media_url?: string | null
          metadata?: Json
          next_attempt_at?: string
          participant_id?: string | null
          provider?: Database["public"]["Enums"]["messaging_provider"]
          provider_message_id?: string | null
          read_at?: string | null
          retry_count?: number
          sent_at?: string | null
          sla_breach_at?: string | null
          status?: Database["public"]["Enums"]["msg_status"]
          surface?: string | null
          to_phone: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          artifact_id?: string | null
          attempts?: number
          body?: string
          channel?: string
          claimed_at?: string | null
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          dead_letter_at?: string | null
          delivered_at?: string | null
          feature?: string | null
          id?: string
          idempotency_key?: string | null
          inbound_message_id?: string | null
          kind?: string
          last_ack_at?: string | null
          last_error?: string | null
          lease_expires_at?: string | null
          media_mime?: string | null
          media_status?: string | null
          media_url?: string | null
          metadata?: Json
          next_attempt_at?: string
          participant_id?: string | null
          provider?: Database["public"]["Enums"]["messaging_provider"]
          provider_message_id?: string | null
          read_at?: string | null
          retry_count?: number
          sent_at?: string | null
          sla_breach_at?: string | null
          status?: Database["public"]["Enums"]["msg_status"]
          surface?: string | null
          to_phone?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outbound_messages_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "agent_artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_inbound_message_id_fkey"
            columns: ["inbound_message_id"]
            isOneToOne: false
            referencedRelation: "inbound_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "outbound_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      outbound_metrics_daily: {
        Row: {
          day: string
          delivered: number
          failed: number
          feature: string
          read: number
          sent: number
          surface: string
          updated_at: string
        }
        Insert: {
          day: string
          delivered?: number
          failed?: number
          feature: string
          read?: number
          sent?: number
          surface: string
          updated_at?: string
        }
        Update: {
          day?: string
          delivered?: number
          failed?: number
          feature?: string
          read?: number
          sent?: number
          surface?: string
          updated_at?: string
        }
        Relationships: []
      }
      participant_contexts: {
        Row: {
          awaiting_receipt: boolean
          awaiting_receipt_since: string | null
          created_at: string
          id: string
          last_intent: string | null
          last_message_at: string | null
          last_receipt_at: string | null
          owner_user_id: string
          participant_id: string
          phone_e164: string
          receipt_count: number
          reported_amount: number | null
          shared_expense_id: string
          state: Json
          updated_at: string
        }
        Insert: {
          awaiting_receipt?: boolean
          awaiting_receipt_since?: string | null
          created_at?: string
          id?: string
          last_intent?: string | null
          last_message_at?: string | null
          last_receipt_at?: string | null
          owner_user_id: string
          participant_id: string
          phone_e164: string
          receipt_count?: number
          reported_amount?: number | null
          shared_expense_id: string
          state?: Json
          updated_at?: string
        }
        Update: {
          awaiting_receipt?: boolean
          awaiting_receipt_since?: string | null
          created_at?: string
          id?: string
          last_intent?: string | null
          last_message_at?: string | null
          last_receipt_at?: string | null
          owner_user_id?: string
          participant_id?: string
          phone_e164?: string
          receipt_count?: number
          reported_amount?: number | null
          shared_expense_id?: string
          state?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "participant_contexts_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: true
            referencedRelation: "my_shared_charges"
            referencedColumns: ["participant_id"]
          },
          {
            foreignKeyName: "participant_contexts_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: true
            referencedRelation: "shared_expense_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participant_contexts_shared_expense_id_fkey"
            columns: ["shared_expense_id"]
            isOneToOne: false
            referencedRelation: "shared_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_confirmations: {
        Row: {
          confirmed_from_message_id: string | null
          conversation_id: string | null
          conversation_msg_ref: string | null
          created_at: string
          executed_at: string | null
          expires_at: string
          id: string
          kind: string
          payload: Json
          result_ref: string | null
          result_snapshot: Json | null
          status: Database["public"]["Enums"]["confirmation_status"]
          summary_text: string
          user_id: string
        }
        Insert: {
          confirmed_from_message_id?: string | null
          conversation_id?: string | null
          conversation_msg_ref?: string | null
          created_at?: string
          executed_at?: string | null
          expires_at: string
          id?: string
          kind: string
          payload: Json
          result_ref?: string | null
          result_snapshot?: Json | null
          status?: Database["public"]["Enums"]["confirmation_status"]
          summary_text: string
          user_id: string
        }
        Update: {
          confirmed_from_message_id?: string | null
          conversation_id?: string | null
          conversation_msg_ref?: string | null
          created_at?: string
          executed_at?: string | null
          expires_at?: string
          id?: string
          kind?: string
          payload?: Json
          result_ref?: string | null
          result_snapshot?: Json | null
          status?: Database["public"]["Enums"]["confirmation_status"]
          summary_text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_confirmations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_confirmations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "pending_confirmations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      pending_proactive_suggestions: {
        Row: {
          action: Json | null
          body: string
          channel_ready: string
          created_at: string
          dedup_key: string
          defer_reason: string | null
          dismissed_at: string | null
          dispatched_at: string | null
          evidence: Json
          expires_at: string | null
          id: string
          kind: string
          logical_dedup_key: string | null
          next_attempt_at: string | null
          severity: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          action?: Json | null
          body: string
          channel_ready?: string
          created_at?: string
          dedup_key: string
          defer_reason?: string | null
          dismissed_at?: string | null
          dispatched_at?: string | null
          evidence?: Json
          expires_at?: string | null
          id?: string
          kind: string
          logical_dedup_key?: string | null
          next_attempt_at?: string | null
          severity?: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          action?: Json | null
          body?: string
          channel_ready?: string
          created_at?: string
          dedup_key?: string
          defer_reason?: string | null
          dismissed_at?: string | null
          dispatched_at?: string | null
          evidence?: Json
          expires_at?: string | null
          id?: string
          kind?: string
          logical_dedup_key?: string | null
          next_attempt_at?: string | null
          severity?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_proactive_suggestions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "pending_proactive_suggestions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      phone_link_codes: {
        Row: {
          attempts: number
          code_hash: string
          cooldown_until: string | null
          created_at: string
          expires_at: string
          id: string
          lookup_key: string | null
          used_at: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          cooldown_until?: string | null
          created_at?: string
          expires_at: string
          id?: string
          lookup_key?: string | null
          used_at?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          cooldown_until?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          lookup_key?: string | null
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_link_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "phone_link_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      platform_admin_audit: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: string
          meta: Json
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          meta?: Json
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          meta?: Json
          target_user_id?: string | null
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          role: Database["public"]["Enums"]["platform_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          role: Database["public"]["Enums"]["platform_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          role?: Database["public"]["Enums"]["platform_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_admins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "platform_admins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      platform_permissions: {
        Row: {
          action: string
          allowed: boolean
          role: Database["public"]["Enums"]["platform_role"]
          updated_at: string
        }
        Insert: {
          action: string
          allowed?: boolean
          role: Database["public"]["Enums"]["platform_role"]
          updated_at?: string
        }
        Update: {
          action?: string
          allowed?: boolean
          role?: Database["public"]["Enums"]["platform_role"]
          updated_at?: string
        }
        Relationships: []
      }
      platform_public_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      product_cohorts_weekly: {
        Row: {
          activated_users: number
          cohort_week: string
          reference_week: string
          retained_users: number
          updated_at: string
          week_offset: number
        }
        Insert: {
          activated_users?: number
          cohort_week: string
          reference_week: string
          retained_users?: number
          updated_at?: string
          week_offset: number
        }
        Update: {
          activated_users?: number
          cohort_week?: string
          reference_week?: string
          retained_users?: number
          updated_at?: string
          week_offset?: number
        }
        Relationships: []
      }
      product_daily_value: {
        Row: {
          activated_count: number
          day: string
          formula_version: string
          sample_size: number
          significant_entry_users: number
          updated_at: string
          value_delivered_count: number
          wvu_count: number
        }
        Insert: {
          activated_count?: number
          day: string
          formula_version?: string
          sample_size?: number
          significant_entry_users?: number
          updated_at?: string
          value_delivered_count?: number
          wvu_count?: number
        }
        Update: {
          activated_count?: number
          day?: string
          formula_version?: string
          sample_size?: number
          significant_entry_users?: number
          updated_at?: string
          value_delivered_count?: number
          wvu_count?: number
        }
        Relationships: []
      }
      product_event_types: {
        Row: {
          category: string
          created_at: string
          description: string
          event_name: string
          requires_value_bucket: boolean
        }
        Insert: {
          category: string
          created_at?: string
          description: string
          event_name: string
          requires_value_bucket?: boolean
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          event_name?: string
          requires_value_bucket?: boolean
        }
        Relationships: []
      }
      product_events: {
        Row: {
          created_at: string
          event_name: string
          event_source: Database["public"]["Enums"]["event_source"]
          feature: string | null
          id: string
          idempotency_key: string
          occurred_at: string
          outcome: string | null
          pseudo_id: string
          surface: string | null
          value_bucket: Database["public"]["Enums"]["value_bucket"] | null
        }
        Insert: {
          created_at?: string
          event_name: string
          event_source?: Database["public"]["Enums"]["event_source"]
          feature?: string | null
          id?: string
          idempotency_key: string
          occurred_at?: string
          outcome?: string | null
          pseudo_id: string
          surface?: string | null
          value_bucket?: Database["public"]["Enums"]["value_bucket"] | null
        }
        Update: {
          created_at?: string
          event_name?: string
          event_source?: Database["public"]["Enums"]["event_source"]
          feature?: string | null
          id?: string
          idempotency_key?: string
          occurred_at?: string
          outcome?: string | null
          pseudo_id?: string
          surface?: string | null
          value_bucket?: Database["public"]["Enums"]["value_bucket"] | null
        }
        Relationships: [
          {
            foreignKeyName: "product_events_event_name_fkey"
            columns: ["event_name"]
            isOneToOne: false
            referencedRelation: "product_event_types"
            referencedColumns: ["event_name"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          currency: string
          display_name: string | null
          hide_financial_values: boolean
          id: string
          is_sandbox: boolean
          is_test: boolean
          onboarding_completed_at: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          display_name?: string | null
          hide_financial_values?: boolean
          id: string
          is_sandbox?: boolean
          is_test?: boolean
          onboarding_completed_at?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          display_name?: string | null
          hide_financial_values?: boolean
          id?: string
          is_sandbox?: boolean
          is_test?: boolean
          onboarding_completed_at?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      provider_health_events: {
        Row: {
          error_masked: string | null
          id: string
          latency_ms: number | null
          occurred_at: string
          ok: boolean
          provider: Database["public"]["Enums"]["messaging_provider"]
        }
        Insert: {
          error_masked?: string | null
          id?: string
          latency_ms?: number | null
          occurred_at?: string
          ok: boolean
          provider: Database["public"]["Enums"]["messaging_provider"]
        }
        Update: {
          error_masked?: string | null
          id?: string
          latency_ms?: number | null
          occurred_at?: string
          ok?: boolean
          provider?: Database["public"]["Enums"]["messaging_provider"]
        }
        Relationships: []
      }
      provider_inbound_drops: {
        Row: {
          event: string | null
          has_alt: boolean
          has_key: boolean
          id: string
          jid_domains: string[]
          lid_masked: string | null
          occurred_at: string
          provider: string
          reason: string
          session: string | null
        }
        Insert: {
          event?: string | null
          has_alt?: boolean
          has_key?: boolean
          id?: string
          jid_domains?: string[]
          lid_masked?: string | null
          occurred_at?: string
          provider: string
          reason: string
          session?: string | null
        }
        Update: {
          event?: string | null
          has_alt?: boolean
          has_key?: boolean
          id?: string
          jid_domains?: string[]
          lid_masked?: string | null
          occurred_at?: string
          provider?: string
          reason?: string
          session?: string | null
        }
        Relationships: []
      }
      pulse_snapshots: {
        Row: {
          band: string
          computed_at: string
          created_at: string
          factors: Json
          id: string
          next_action: string | null
          score: number
          snapshot_date: string
          state: string
          user_id: string
          week_delta: number | null
        }
        Insert: {
          band: string
          computed_at?: string
          created_at?: string
          factors?: Json
          id?: string
          next_action?: string | null
          score: number
          snapshot_date: string
          state?: string
          user_id: string
          week_delta?: number | null
        }
        Update: {
          band?: string
          computed_at?: string
          created_at?: string
          factors?: Json
          id?: string
          next_action?: string | null
          score?: number
          snapshot_date?: string
          state?: string
          user_id?: string
          week_delta?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pulse_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "pulse_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      reconciliation_issues: {
        Row: {
          details: Json
          detected_at: string
          entity_id: string | null
          id: string
          kind: string
          resolved_at: string | null
          severity: string
          user_id: string
        }
        Insert: {
          details?: Json
          detected_at?: string
          entity_id?: string | null
          id?: string
          kind: string
          resolved_at?: string | null
          severity?: string
          user_id: string
        }
        Update: {
          details?: Json
          detected_at?: string
          entity_id?: string | null
          id?: string
          kind?: string
          resolved_at?: string | null
          severity?: string
          user_id?: string
        }
        Relationships: []
      }
      recurring_entries: {
        Row: {
          account_id: string | null
          active: boolean
          amount: number
          category_id: string | null
          created_at: string
          frequency: Database["public"]["Enums"]["recurring_frequency"]
          id: string
          name: string
          next_due_date: string
          type: Database["public"]["Enums"]["category_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          active?: boolean
          amount: number
          category_id?: string | null
          created_at?: string
          frequency?: Database["public"]["Enums"]["recurring_frequency"]
          id?: string
          name: string
          next_due_date: string
          type: Database["public"]["Enums"]["category_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          active?: boolean
          amount?: number
          category_id?: string | null
          created_at?: string
          frequency?: Database["public"]["Enums"]["recurring_frequency"]
          id?: string
          name?: string
          next_due_date?: string
          type?: Database["public"]["Enums"]["category_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_entries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "recurring_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      recurring_occurrences: {
        Row: {
          created_at: string
          due_date: string
          id: string
          recurring_rule_id: string
          status: Database["public"]["Enums"]["occurrence_status"]
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          due_date: string
          id?: string
          recurring_rule_id: string
          status?: Database["public"]["Enums"]["occurrence_status"]
          transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          due_date?: string
          id?: string
          recurring_rule_id?: string
          status?: Database["public"]["Enums"]["occurrence_status"]
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_occurrences_recurring_rule_id_fkey"
            columns: ["recurring_rule_id"]
            isOneToOne: false
            referencedRelation: "recurring_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_occurrences_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_rules: {
        Row: {
          account_id: string
          amount: number
          category_id: string | null
          created_at: string
          day_of_month: number | null
          end_date: string | null
          frequency: Database["public"]["Enums"]["recurring_frequency"]
          id: string
          kind: Database["public"]["Enums"]["transaction_type"]
          last_generated_at: string | null
          name: string
          start_date: string
          status: Database["public"]["Enums"]["recurring_status"]
          updated_at: string
          user_id: string
          weekday: number | null
        }
        Insert: {
          account_id: string
          amount: number
          category_id?: string | null
          created_at?: string
          day_of_month?: number | null
          end_date?: string | null
          frequency?: Database["public"]["Enums"]["recurring_frequency"]
          id?: string
          kind: Database["public"]["Enums"]["transaction_type"]
          last_generated_at?: string | null
          name: string
          start_date?: string
          status?: Database["public"]["Enums"]["recurring_status"]
          updated_at?: string
          user_id: string
          weekday?: number | null
        }
        Update: {
          account_id?: string
          amount?: number
          category_id?: string | null
          created_at?: string
          day_of_month?: number | null
          end_date?: string | null
          frequency?: Database["public"]["Enums"]["recurring_frequency"]
          id?: string
          kind?: Database["public"]["Enums"]["transaction_type"]
          last_generated_at?: string | null
          name?: string
          start_date?: string
          status?: Database["public"]["Enums"]["recurring_status"]
          updated_at?: string
          user_id?: string
          weekday?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_rules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_rules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "recurring_rules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      reminder_jobs: {
        Row: {
          attempts: number
          cancel_reason: string | null
          created_at: string
          deliver_after: string | null
          delivered_at: string | null
          delivery_status: string
          followup_of: string | null
          id: string
          idempotency_key: string | null
          kind: string
          last_error: string | null
          lease_expires_at: string | null
          next_attempt_at: string | null
          outbound_message_id: string | null
          owner_user_id: string
          participant_id: string | null
          policy_version: string | null
          read_at: string | null
          retry_count: number
          scheduled_for: string
          sent_at: string | null
          shared_expense_id: string
          status: Database["public"]["Enums"]["reminder_status"]
          superseded_by: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          cancel_reason?: string | null
          created_at?: string
          deliver_after?: string | null
          delivered_at?: string | null
          delivery_status?: string
          followup_of?: string | null
          id?: string
          idempotency_key?: string | null
          kind?: string
          last_error?: string | null
          lease_expires_at?: string | null
          next_attempt_at?: string | null
          outbound_message_id?: string | null
          owner_user_id: string
          participant_id?: string | null
          policy_version?: string | null
          read_at?: string | null
          retry_count?: number
          scheduled_for?: string
          sent_at?: string | null
          shared_expense_id: string
          status?: Database["public"]["Enums"]["reminder_status"]
          superseded_by?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          cancel_reason?: string | null
          created_at?: string
          deliver_after?: string | null
          delivered_at?: string | null
          delivery_status?: string
          followup_of?: string | null
          id?: string
          idempotency_key?: string | null
          kind?: string
          last_error?: string | null
          lease_expires_at?: string | null
          next_attempt_at?: string | null
          outbound_message_id?: string | null
          owner_user_id?: string
          participant_id?: string | null
          policy_version?: string | null
          read_at?: string | null
          retry_count?: number
          scheduled_for?: string
          sent_at?: string | null
          shared_expense_id?: string
          status?: Database["public"]["Enums"]["reminder_status"]
          superseded_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_jobs_followup_of_fkey"
            columns: ["followup_of"]
            isOneToOne: false
            referencedRelation: "reminder_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_jobs_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "my_shared_charges"
            referencedColumns: ["participant_id"]
          },
          {
            foreignKeyName: "reminder_jobs_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "shared_expense_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_jobs_shared_expense_id_fkey"
            columns: ["shared_expense_id"]
            isOneToOne: false
            referencedRelation: "shared_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_jobs_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "reminder_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_expense_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          owner_user_id: string
          participant_id: string | null
          payload: Json
          shared_expense_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          owner_user_id: string
          participant_id?: string | null
          payload?: Json
          shared_expense_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          owner_user_id?: string
          participant_id?: string | null
          payload?: Json
          shared_expense_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_expense_events_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "my_shared_charges"
            referencedColumns: ["participant_id"]
          },
          {
            foreignKeyName: "shared_expense_events_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "shared_expense_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_expense_events_shared_expense_id_fkey"
            columns: ["shared_expense_id"]
            isOneToOne: false
            referencedRelation: "shared_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_expense_participants: {
        Row: {
          amount_due: number
          amount_paid: number
          attempts: number
          communication_status: string
          created_at: string
          delivered_count: number
          dispute_status: string
          id: string
          invite_expires_at: string | null
          invite_status: string
          invite_token_hash: string | null
          last_attempted_at: string | null
          last_delivered_at: string | null
          last_reminded_at: string | null
          last_sent_at: string | null
          linked_user_id: string | null
          name: string
          opt_out_at: string | null
          opt_out_token: string | null
          owner_user_id: string
          paid_at: string | null
          phone_e164: string | null
          phone_masked: string | null
          queued_count: number
          read_count: number
          reminder_count: number
          sent_count: number
          shared_expense_id: string
          status: Database["public"]["Enums"]["participant_status"]
          updated_at: string
        }
        Insert: {
          amount_due: number
          amount_paid?: number
          attempts?: number
          communication_status?: string
          created_at?: string
          delivered_count?: number
          dispute_status?: string
          id?: string
          invite_expires_at?: string | null
          invite_status?: string
          invite_token_hash?: string | null
          last_attempted_at?: string | null
          last_delivered_at?: string | null
          last_reminded_at?: string | null
          last_sent_at?: string | null
          linked_user_id?: string | null
          name: string
          opt_out_at?: string | null
          opt_out_token?: string | null
          owner_user_id: string
          paid_at?: string | null
          phone_e164?: string | null
          phone_masked?: string | null
          queued_count?: number
          read_count?: number
          reminder_count?: number
          sent_count?: number
          shared_expense_id: string
          status?: Database["public"]["Enums"]["participant_status"]
          updated_at?: string
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          attempts?: number
          communication_status?: string
          created_at?: string
          delivered_count?: number
          dispute_status?: string
          id?: string
          invite_expires_at?: string | null
          invite_status?: string
          invite_token_hash?: string | null
          last_attempted_at?: string | null
          last_delivered_at?: string | null
          last_reminded_at?: string | null
          last_sent_at?: string | null
          linked_user_id?: string | null
          name?: string
          opt_out_at?: string | null
          opt_out_token?: string | null
          owner_user_id?: string
          paid_at?: string | null
          phone_e164?: string | null
          phone_masked?: string | null
          queued_count?: number
          read_count?: number
          reminder_count?: number
          sent_count?: number
          shared_expense_id?: string
          status?: Database["public"]["Enums"]["participant_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_expense_participants_linked_user_id_fkey"
            columns: ["linked_user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "shared_expense_participants_linked_user_id_fkey"
            columns: ["linked_user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "shared_expense_participants_shared_expense_id_fkey"
            columns: ["shared_expense_id"]
            isOneToOne: false
            referencedRelation: "shared_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_expenses: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          category_id: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          due_date: string | null
          id: string
          linked_transaction_id: string | null
          occurred_at: string
          owner_user_id: string
          pix_key: string | null
          reimbursement_account_id: string | null
          reminder_enabled: boolean
          source_account_id: string | null
          source_credit_card_id: string | null
          split_mode: Database["public"]["Enums"]["split_mode"]
          status: Database["public"]["Enums"]["split_status"]
          title: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          category_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          linked_transaction_id?: string | null
          occurred_at?: string
          owner_user_id: string
          pix_key?: string | null
          reimbursement_account_id?: string | null
          reminder_enabled?: boolean
          source_account_id?: string | null
          source_credit_card_id?: string | null
          split_mode?: Database["public"]["Enums"]["split_mode"]
          status?: Database["public"]["Enums"]["split_status"]
          title: string
          total_amount: number
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          category_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          linked_transaction_id?: string | null
          occurred_at?: string
          owner_user_id?: string
          pix_key?: string | null
          reimbursement_account_id?: string | null
          reminder_enabled?: boolean
          source_account_id?: string | null
          source_credit_card_id?: string | null
          split_mode?: Database["public"]["Enums"]["split_mode"]
          status?: Database["public"]["Enums"]["split_status"]
          title?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_expenses_linked_transaction_id_fkey"
            columns: ["linked_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_expenses_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "shared_expenses_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "shared_expenses_reimbursement_account_id_fkey"
            columns: ["reimbursement_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_expenses_source_account_id_fkey"
            columns: ["source_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_expenses_source_credit_card_id_fkey"
            columns: ["source_credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_goal_contributions: {
        Row: {
          amount: number
          created_at: string
          goal_id: string
          id: string
          idempotency_key: string | null
          note: string | null
          occurred_at: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          goal_id: string
          id?: string
          idempotency_key?: string | null
          note?: string | null
          occurred_at?: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          goal_id?: string
          id?: string
          idempotency_key?: string | null
          note?: string | null
          occurred_at?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_goal_contributions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "shared_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_goal_contributions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_goal_contributions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "shared_goal_contributions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      shared_goal_invites: {
        Row: {
          accepted_at: string | null
          accepted_by_user_id: string | null
          created_at: string
          expires_at: string
          goal_id: string
          id: string
          invited_by: string
          phone_e164: string
          status: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          created_at?: string
          expires_at?: string
          goal_id: string
          id?: string
          invited_by: string
          phone_e164: string
          status?: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          created_at?: string
          expires_at?: string
          goal_id?: string
          id?: string
          invited_by?: string
          phone_e164?: string
          status?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_goal_invites_accepted_by_user_id_fkey"
            columns: ["accepted_by_user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "shared_goal_invites_accepted_by_user_id_fkey"
            columns: ["accepted_by_user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "shared_goal_invites_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "shared_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_goal_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "shared_goal_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      shared_goal_members: {
        Row: {
          contribution_total: number
          created_at: string
          goal_id: string
          id: string
          invite_status: string
          joined_at: string | null
          phone_e164: string | null
          role: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          contribution_total?: number
          created_at?: string
          goal_id: string
          id?: string
          invite_status?: string
          joined_at?: string | null
          phone_e164?: string | null
          role?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          contribution_total?: number
          created_at?: string
          goal_id?: string
          id?: string
          invite_status?: string
          joined_at?: string | null
          phone_e164?: string | null
          role?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shared_goal_members_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "shared_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_goal_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "shared_goal_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      shared_goals: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          deadline: string | null
          id: string
          last_milestone_pct: number
          referral_source: string | null
          status: string
          target_amount: number
          title: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          deadline?: string | null
          id?: string
          last_milestone_pct?: number
          referral_source?: string | null
          status?: string
          target_amount: number
          title: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          deadline?: string | null
          id?: string
          last_milestone_pct?: number
          referral_source?: string | null
          status?: string
          target_amount?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_goals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "shared_goals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      split_link_audit: {
        Row: {
          created_at: string
          id: string
          new_user_id: string | null
          participant_id: string
          phone_e164: string | null
          prior_user_id: string | null
          reason: string
          shared_expense_id: string
          source: string
        }
        Insert: {
          created_at?: string
          id?: string
          new_user_id?: string | null
          participant_id: string
          phone_e164?: string | null
          prior_user_id?: string | null
          reason: string
          shared_expense_id: string
          source: string
        }
        Update: {
          created_at?: string
          id?: string
          new_user_id?: string | null
          participant_id?: string
          phone_e164?: string | null
          prior_user_id?: string | null
          reason?: string
          shared_expense_id?: string
          source?: string
        }
        Relationships: []
      }
      split_reminder_policy: {
        Row: {
          due_soon_days_before: number
          due_today_enabled: boolean
          enabled: boolean
          first_overdue_days: number
          id: number
          max_overdue_reminders: number
          pause_on_reply: boolean
          repeat_every_days: number
          send_hour: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          due_soon_days_before?: number
          due_today_enabled?: boolean
          enabled?: boolean
          first_overdue_days?: number
          id?: number
          max_overdue_reminders?: number
          pause_on_reply?: boolean
          repeat_every_days?: number
          send_hour?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          due_soon_days_before?: number
          due_today_enabled?: boolean
          enabled?: boolean
          first_overdue_days?: number
          id?: number
          max_overdue_reminders?: number
          pause_on_reply?: boolean
          repeat_every_days?: number
          send_hour?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "split_reminder_policy_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "split_reminder_policy_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string | null
          amount: number
          bank_description: string | null
          bank_reference: string | null
          behavior_date_confidence: number | null
          behavior_date_source: string | null
          behavior_occurred_at: string | null
          behavioral_day: string | null
          category_classified_at: string | null
          category_confidence: number | null
          category_decision_id: string | null
          category_engine_version: string | null
          category_id: string | null
          category_reason: string | null
          category_review_status: string
          category_source: string | null
          competence_date: string | null
          created_at: string
          credit_card_id: string | null
          dedupe_fingerprint: string | null
          description: string | null
          direction: Database["public"]["Enums"]["transfer_direction"] | null
          emotional_trigger: string | null
          external_id: string | null
          friendly_description: string | null
          id: string
          import_source_id: string | null
          installment_number: number | null
          installments_total: number | null
          investment_id: string | null
          local_occurred_at: string | null
          movement_kind: string
          normalized_description: string | null
          notes: string | null
          occurred_at: string
          occurred_at_precision: string | null
          occurred_at_time: string | null
          occurred_at_timezone: string | null
          origin: Database["public"]["Enums"]["txn_origin"]
          payment_method: string
          posted_at: string | null
          posted_at_source: string | null
          previous_category_id: string | null
          purchase_date: string | null
          purchase_group_id: string | null
          raw_description: string | null
          settles_card_id: string | null
          shared_expense_id: string | null
          source_document_id: string | null
          source_line_index: number | null
          split_transaction_role: string | null
          status: Database["public"]["Enums"]["transaction_status"]
          transfer_group_id: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_edited_at: string | null
          user_id: string
          version: number
        }
        Insert: {
          account_id?: string | null
          amount: number
          bank_description?: string | null
          bank_reference?: string | null
          behavior_date_confidence?: number | null
          behavior_date_source?: string | null
          behavior_occurred_at?: string | null
          behavioral_day?: string | null
          category_classified_at?: string | null
          category_confidence?: number | null
          category_decision_id?: string | null
          category_engine_version?: string | null
          category_id?: string | null
          category_reason?: string | null
          category_review_status?: string
          category_source?: string | null
          competence_date?: string | null
          created_at?: string
          credit_card_id?: string | null
          dedupe_fingerprint?: string | null
          description?: string | null
          direction?: Database["public"]["Enums"]["transfer_direction"] | null
          emotional_trigger?: string | null
          external_id?: string | null
          friendly_description?: string | null
          id?: string
          import_source_id?: string | null
          installment_number?: number | null
          installments_total?: number | null
          investment_id?: string | null
          local_occurred_at?: string | null
          movement_kind?: string
          normalized_description?: string | null
          notes?: string | null
          occurred_at: string
          occurred_at_precision?: string | null
          occurred_at_time?: string | null
          occurred_at_timezone?: string | null
          origin?: Database["public"]["Enums"]["txn_origin"]
          payment_method?: string
          posted_at?: string | null
          posted_at_source?: string | null
          previous_category_id?: string | null
          purchase_date?: string | null
          purchase_group_id?: string | null
          raw_description?: string | null
          settles_card_id?: string | null
          shared_expense_id?: string | null
          source_document_id?: string | null
          source_line_index?: number | null
          split_transaction_role?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          transfer_group_id?: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_edited_at?: string | null
          user_id: string
          version?: number
        }
        Update: {
          account_id?: string | null
          amount?: number
          bank_description?: string | null
          bank_reference?: string | null
          behavior_date_confidence?: number | null
          behavior_date_source?: string | null
          behavior_occurred_at?: string | null
          behavioral_day?: string | null
          category_classified_at?: string | null
          category_confidence?: number | null
          category_decision_id?: string | null
          category_engine_version?: string | null
          category_id?: string | null
          category_reason?: string | null
          category_review_status?: string
          category_source?: string | null
          competence_date?: string | null
          created_at?: string
          credit_card_id?: string | null
          dedupe_fingerprint?: string | null
          description?: string | null
          direction?: Database["public"]["Enums"]["transfer_direction"] | null
          emotional_trigger?: string | null
          external_id?: string | null
          friendly_description?: string | null
          id?: string
          import_source_id?: string | null
          installment_number?: number | null
          installments_total?: number | null
          investment_id?: string | null
          local_occurred_at?: string | null
          movement_kind?: string
          normalized_description?: string | null
          notes?: string | null
          occurred_at?: string
          occurred_at_precision?: string | null
          occurred_at_time?: string | null
          occurred_at_timezone?: string | null
          origin?: Database["public"]["Enums"]["txn_origin"]
          payment_method?: string
          posted_at?: string | null
          posted_at_source?: string | null
          previous_category_id?: string | null
          purchase_date?: string | null
          purchase_group_id?: string | null
          raw_description?: string | null
          settles_card_id?: string | null
          shared_expense_id?: string | null
          source_document_id?: string | null
          source_line_index?: number | null
          split_transaction_role?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          transfer_group_id?: string | null
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_edited_at?: string | null
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_decision_id_fkey"
            columns: ["category_decision_id"]
            isOneToOne: false
            referencedRelation: "category_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_investment_id_fkey"
            columns: ["investment_id"]
            isOneToOne: false
            referencedRelation: "investments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_settles_card_id_fkey"
            columns: ["settles_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_shared_expense_id_fkey"
            columns: ["shared_expense_id"]
            isOneToOne: false
            referencedRelation: "shared_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_ai_preferences: {
        Row: {
          example_style: string
          explanation_style: string
          fast_log_token: string
          suggestion_frequency: string
          technical_level: string
          tone: string
          updated_at: string
          user_id: string
          verbosity: string
        }
        Insert: {
          example_style?: string
          explanation_style?: string
          fast_log_token?: string
          suggestion_frequency?: string
          technical_level?: string
          tone?: string
          updated_at?: string
          user_id: string
          verbosity?: string
        }
        Update: {
          example_style?: string
          explanation_style?: string
          fast_log_token?: string
          suggestion_frequency?: string
          technical_level?: string
          tone?: string
          updated_at?: string
          user_id?: string
          verbosity?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_ai_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_ai_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_challenges: {
        Row: {
          challenge_id: string | null
          challenge_slug: string | null
          current_progress: number
          finished_at: string | null
          id: string
          progress: number
          started_at: string
          status: Database["public"]["Enums"]["user_challenge_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          challenge_id?: string | null
          challenge_slug?: string | null
          current_progress?: number
          finished_at?: string | null
          id?: string
          progress?: number
          started_at?: string
          status?: Database["public"]["Enums"]["user_challenge_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          challenge_id?: string | null
          challenge_slug?: string | null
          current_progress?: number
          finished_at?: string | null
          id?: string
          progress?: number
          started_at?: string
          status?: Database["public"]["Enums"]["user_challenge_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_challenges_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_challenges_challenge_slug_fkey"
            columns: ["challenge_slug"]
            isOneToOne: false
            referencedRelation: "challenges_catalog"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "user_challenges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_challenges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_financial_settings: {
        Row: {
          approximate_monthly_income: number | null
          created_at: string
          currency: string
          doc_max_items: number
          income_day: number | null
          income_frequency:
            | Database["public"]["Enums"]["income_frequency"]
            | null
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approximate_monthly_income?: number | null
          created_at?: string
          currency?: string
          doc_max_items?: number
          income_day?: number | null
          income_frequency?:
            | Database["public"]["Enums"]["income_frequency"]
            | null
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approximate_monthly_income?: number | null
          created_at?: string
          currency?: string
          doc_max_items?: number
          income_day?: number | null
          income_frequency?:
            | Database["public"]["Enums"]["income_frequency"]
            | null
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_financial_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_financial_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_gamification: {
        Row: {
          current_streak: number
          level: number
          longest_streak: number
          total_xp: number
          updated_at: string
          user_id: string
        }
        Insert: {
          current_streak?: number
          level?: number
          longest_streak?: number
          total_xp?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          current_streak?: number
          level?: number
          longest_streak?: number
          total_xp?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_gamification_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_gamification_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_insights: {
        Row: {
          as_of: string | null
          body: string
          created_at: string
          cta_label: string | null
          cta_route: string | null
          dedup_key: string | null
          eligible_channels: string[]
          evidence: Json
          expires_at: string
          family: string | null
          feedback: string | null
          formula_version: string | null
          generated_at: string
          id: string
          logical_dedup_key: string | null
          model: string | null
          prompt_version: string | null
          resolved_at: string | null
          score: number | null
          severity: string | null
          source_snapshot_id: string | null
          status: string
          title: string
          type: string
          updated_at: string
          user_id: string
          validity_until: string | null
        }
        Insert: {
          as_of?: string | null
          body: string
          created_at?: string
          cta_label?: string | null
          cta_route?: string | null
          dedup_key?: string | null
          eligible_channels?: string[]
          evidence?: Json
          expires_at?: string
          family?: string | null
          feedback?: string | null
          formula_version?: string | null
          generated_at?: string
          id?: string
          logical_dedup_key?: string | null
          model?: string | null
          prompt_version?: string | null
          resolved_at?: string | null
          score?: number | null
          severity?: string | null
          source_snapshot_id?: string | null
          status?: string
          title: string
          type: string
          updated_at?: string
          user_id: string
          validity_until?: string | null
        }
        Update: {
          as_of?: string | null
          body?: string
          created_at?: string
          cta_label?: string | null
          cta_route?: string | null
          dedup_key?: string | null
          eligible_channels?: string[]
          evidence?: Json
          expires_at?: string
          family?: string | null
          feedback?: string | null
          formula_version?: string | null
          generated_at?: string
          id?: string
          logical_dedup_key?: string | null
          model?: string | null
          prompt_version?: string | null
          resolved_at?: string | null
          score?: number | null
          severity?: string | null
          source_snapshot_id?: string | null
          status?: string
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
          validity_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_insights_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_insights_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_lifecycle_daily: {
        Row: {
          active_users: number
          churned_users: number
          day: string
          dormant_users: number
          new_users: number
          updated_at: string
        }
        Insert: {
          active_users?: number
          churned_users?: number
          day: string
          dormant_users?: number
          new_users?: number
          updated_at?: string
        }
        Update: {
          active_users?: number
          churned_users?: number
          day?: string
          dormant_users?: number
          new_users?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_profiles_snapshot: {
        Row: {
          behavior_tags: string[]
          computed_at: string
          estimated_income: number | null
          indicators: Json
          last_proactive_scan_at: string | null
          monthly_evolution: Json
          net_worth: number | null
          next_proactive_scan_at: string | null
          risk_level: string | null
          savings_capacity: number | null
          seasonality: Json
          spending_pattern: Json
          top_categories: Json
          user_id: string
        }
        Insert: {
          behavior_tags?: string[]
          computed_at?: string
          estimated_income?: number | null
          indicators?: Json
          last_proactive_scan_at?: string | null
          monthly_evolution?: Json
          net_worth?: number | null
          next_proactive_scan_at?: string | null
          risk_level?: string | null
          savings_capacity?: number | null
          seasonality?: Json
          spending_pattern?: Json
          top_categories?: Json
          user_id: string
        }
        Update: {
          behavior_tags?: string[]
          computed_at?: string
          estimated_income?: number | null
          indicators?: Json
          last_proactive_scan_at?: string | null
          monthly_evolution?: Json
          net_worth?: number | null
          next_proactive_scan_at?: string | null
          risk_level?: string | null
          savings_capacity?: number | null
          seasonality?: Json
          spending_pattern?: Json
          top_categories?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_snapshot_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_profiles_snapshot_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_pseudonyms: {
        Row: {
          created_at: string
          detached_at: string | null
          pseudo_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          detached_at?: string | null
          pseudo_id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          detached_at?: string | null
          pseudo_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_pseudonyms_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_pseudonyms_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
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
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      wave1_pre_snapshot: {
        Row: {
          bill_payments: number
          captured_at: string
          id: string
          label: string
          running_runs: number
          total_runs: number
          total_txs: number
        }
        Insert: {
          bill_payments: number
          captured_at?: string
          id?: string
          label: string
          running_runs: number
          total_runs: number
          total_txs: number
        }
        Update: {
          bill_payments?: number
          captured_at?: string
          id?: string
          label?: string
          running_runs?: number
          total_runs?: number
          total_txs?: number
        }
        Relationships: []
      }
      whatsapp_lid_map: {
        Row: {
          lid: string
          phone_e164: string
          updated_at: string
        }
        Insert: {
          lid: string
          phone_e164: string
          updated_at?: string
        }
        Update: {
          lid?: string
          phone_e164?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_links: {
        Row: {
          consent_at: string
          created_at: string
          id: string
          last_verified_at: string | null
          phone_e164: string
          phone_hash: string
          phone_masked: string
          revoked_at: string | null
          status: Database["public"]["Enums"]["link_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          consent_at?: string
          created_at?: string
          id?: string
          last_verified_at?: string | null
          phone_e164: string
          phone_hash: string
          phone_masked: string
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["link_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          consent_at?: string
          created_at?: string
          id?: string
          last_verified_at?: string | null
          phone_e164?: string
          phone_hash?: string
          phone_masked?: string
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["link_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "whatsapp_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      whatsapp_pipeline_events: {
        Row: {
          agent_run_id: string | null
          error_code: string | null
          id: string
          inbound_message_id: string | null
          metadata: Json
          occurred_at: string
          ok: boolean
          outbound_message_id: string | null
          provider_message_hash: string | null
          session: string | null
          stage: string
          user_id: string | null
        }
        Insert: {
          agent_run_id?: string | null
          error_code?: string | null
          id?: string
          inbound_message_id?: string | null
          metadata?: Json
          occurred_at?: string
          ok?: boolean
          outbound_message_id?: string | null
          provider_message_hash?: string | null
          session?: string | null
          stage: string
          user_id?: string | null
        }
        Update: {
          agent_run_id?: string | null
          error_code?: string | null
          id?: string
          inbound_message_id?: string | null
          metadata?: Json
          occurred_at?: string
          ok?: boolean
          outbound_message_id?: string | null
          provider_message_hash?: string | null
          session?: string | null
          stage?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_pipeline_events_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_pipeline_events_inbound_message_id_fkey"
            columns: ["inbound_message_id"]
            isOneToOne: false
            referencedRelation: "inbound_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_pipeline_events_outbound_message_id_fkey"
            columns: ["outbound_message_id"]
            isOneToOne: false
            referencedRelation: "outbound_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_pipeline_events_outbound_message_id_fkey"
            columns: ["outbound_message_id"]
            isOneToOne: false
            referencedRelation: "v_outbound_sla_breach"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_pipeline_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "whatsapp_pipeline_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      xp_events: {
        Row: {
          id: string
          occurred_at: string
          reason: string | null
          source_id: string
          source_type: string
          user_id: string
          xp_delta: number
        }
        Insert: {
          id?: string
          occurred_at?: string
          reason?: string | null
          source_id: string
          source_type: string
          user_id: string
          xp_delta: number
        }
        Update: {
          id?: string
          occurred_at?: string
          reason?: string | null
          source_id?: string
          source_type?: string
          user_id?: string
          xp_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "xp_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "xp_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      my_shared_charges: {
        Row: {
          amount_due: number | null
          amount_paid: number | null
          created_at: string | null
          dispute_status: string | null
          due_date: string | null
          occurred_at: string | null
          owner_display_name: string | null
          owner_user_id: string | null
          participant_id: string | null
          pix_key: string | null
          reminder_enabled: boolean | null
          shared_expense_id: string | null
          status: Database["public"]["Enums"]["participant_status"] | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shared_expense_participants_shared_expense_id_fkey"
            columns: ["shared_expense_id"]
            isOneToOne: false
            referencedRelation: "shared_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_expenses_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "shared_expenses_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      v_card_double_counting: {
        Row: {
          adjustments_total: number | null
          competence_month: string | null
          credit_card_id: string | null
          installments_absorbed_total: number | null
          installments_total: number | null
          issue: string | null
          official_total: number | null
          residual_vs_official: number | null
          statement_status: string | null
          transactions_total: number | null
          transactions_vs_official: number | null
          unjustified_adjustments: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_card_statements_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_statements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credit_card_statements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      v_client_pseudonyms: {
        Row: {
          pseudo_id: string | null
          user_id: string | null
        }
        Insert: {
          pseudo_id?: string | null
          user_id?: string | null
        }
        Update: {
          pseudo_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_pseudonyms_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_pseudonyms_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      v_client_universe: {
        Row: {
          created_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      v_client_users: {
        Row: {
          onboarding_completed_at: string | null
          pseudo_id: string | null
          registered_at: string | null
          user_id: string | null
        }
        Relationships: []
      }
      v_communication_ledger: {
        Row: {
          channel: string | null
          cost_usd: number | null
          created_at: string | null
          dedup_key: string | null
          family: string | null
          feedback: string | null
          kind: string | null
          source_id: string | null
          source_table: string | null
          status: string | null
          user_id: string | null
        }
        Relationships: []
      }
      v_outbound_sla_breach: {
        Row: {
          age_seconds: number | null
          attempts: number | null
          created_at: string | null
          id: string | null
          last_error: string | null
          next_attempt_at: string | null
          retry_count: number | null
          status: Database["public"]["Enums"]["msg_status"] | null
          to_phone: string | null
          user_id: string | null
        }
        Insert: {
          age_seconds?: never
          attempts?: number | null
          created_at?: string | null
          id?: string | null
          last_error?: string | null
          next_attempt_at?: string | null
          retry_count?: number | null
          status?: Database["public"]["Enums"]["msg_status"] | null
          to_phone?: string | null
          user_id?: string | null
        }
        Update: {
          age_seconds?: never
          attempts?: number | null
          created_at?: string | null
          id?: string | null
          last_error?: string | null
          next_attempt_at?: string | null
          retry_count?: number | null
          status?: Database["public"]["Enums"]["msg_status"] | null
          to_phone?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outbound_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_universe"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "outbound_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_client_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Functions: {
      _break_glass_allowed_fields: { Args: never; Returns: string[] }
      _cron_secret: { Args: never; Returns: string }
      _envelope: {
        Args: {
          _extras?: Json
          _formula_version?: string
          _polarity: string
          _previous: number
          _sample: number
          _value: number
        }
        Returns: Json
      }
      _exec_credit_card_bill_payment: {
        Args: {
          c: Database["public"]["Tables"]["pending_confirmations"]["Row"]
        }
        Returns: Json
      }
      _mask_email: { Args: { _email: string }; Returns: string }
      _mask_name: { Args: { _name: string }; Returns: string }
      _require_perm: { Args: { _action: string }; Returns: undefined }
      _sg_notify: {
        Args: {
          _body: string
          _dedup: string
          _title: string
          _type: Database["public"]["Enums"]["notification_type"]
          _url: string
          _user_id: string
        }
        Returns: undefined
      }
      _split_claim_for_user: { Args: { p_user_id: string }; Returns: number }
      _test_shared_goals_matrix: { Args: never; Returns: Json }
      _test_split_followup: {
        Args: never
        Returns: {
          assertion: string
          detail: string
          passed: boolean
        }[]
      }
      _test_split_link_matrix: {
        Args: never
        Returns: {
          assertion: string
          detail: string
          passed: boolean
        }[]
      }
      _vault_upsert: {
        Args: { p_description: string; p_name: string; p_value: string }
        Returns: string
      }
      abandon_challenge: {
        Args: { p_slug: string }
        Returns: {
          challenge_id: string | null
          challenge_slug: string | null
          current_progress: number
          finished_at: string | null
          id: string
          progress: number
          started_at: string
          status: Database["public"]["Enums"]["user_challenge_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "user_challenges"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      activity_events: { Args: never; Returns: string[] }
      add_credit_card_statement_item: {
        Args: {
          p_amount: number
          p_category_id?: string
          p_description: string
          p_item_kind: string
          p_occurred_at?: string
          p_statement_id: string
        }
        Returns: Json
      }
      admin_active_break_glass: {
        Args: never
        Returns: {
          admin_id: string
          closed_at: string | null
          closed_reason: string | null
          expires_at: string
          fields: string[]
          id: string
          opened_at: string
          pseudo_id: string
          reads_count: number
          reason: string
          ticket_ref: string
        }[]
        SetofOptions: {
          from: "*"
          to: "break_glass_sessions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_agent_knowledge_list: { Args: never; Returns: Json }
      admin_agent_knowledge_upsert: {
        Args: {
          _active: boolean
          _category: string
          _content: string
          _id: string
          _key: string
          _source_url: string
          _title: string
        }
        Returns: Json
      }
      admin_agent_stats: { Args: never; Returns: Json }
      admin_ai_model_route_update: {
        Args: {
          _active: boolean
          _fallback_model: string
          _max_latency_ms: number
          _max_steps: number
          _primary_model: string
          _task: string
        }
        Returns: Json
      }
      admin_ai_model_routes: { Args: never; Returns: Json }
      admin_approve_deletion_request: {
        Args: { p_grace_days?: number; p_id: string; p_notes: string }
        Returns: undefined
      }
      admin_close_break_glass: {
        Args: { _id: string; _reason?: string }
        Returns: boolean
      }
      admin_communication_catalog: { Args: never; Returns: Json }
      admin_communication_catalog_update: {
        Args: {
          _active?: boolean
          _allowed_channels?: string[]
          _base_priority?: number
          _cooldown_hours?: number
          _kind: string
          _max_per_day?: number
          _requires_manual_approval?: boolean
        }
        Returns: Json
      }
      admin_communication_template_upsert: {
        Args: {
          _active?: boolean
          _body_template: string
          _channel: string
          _kind: string
          _title_template: string
        }
        Returns: Json
      }
      admin_communication_templates: { Args: { _kind?: string }; Returns: Json }
      admin_consumer_users_set: {
        Args: never
        Returns: {
          created_at: string
          email: string
          last_sign_in_at: string
          user_id: string
        }[]
      }
      admin_conversation_activity: {
        Args: { p_from?: string; p_limit?: number; p_to?: string }
        Returns: Json
      }
      admin_dashboard_stats: { Args: never; Returns: Json }
      admin_document_metrics: {
        Args: { p_days?: number }
        Returns: {
          avg_latency_ms: number
          failed: number
          pending: number
          succeeded: number
          success_rate: number
          tokens_in: number
          tokens_out: number
          total: number
        }[]
      }
      admin_engagement_stats: { Args: never; Returns: Json }
      admin_list_platform_admins: {
        Args: never
        Returns: {
          active: boolean
          created_at: string
          display_name: string
          email: string
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }[]
      }
      admin_mark_user_as_test: {
        Args: { _is_test: boolean; _user_id: string }
        Returns: Json
      }
      admin_message_activity: {
        Args: {
          p_feature?: string
          p_from?: string
          p_kind?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
          p_surface?: string
          p_to?: string
          p_user_id?: string
        }
        Returns: Json
      }
      admin_message_metrics: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      admin_message_reprocess: { Args: { p_id: string }; Returns: Json }
      admin_message_timeline: { Args: { p_id: string }; Returns: Json }
      admin_open_break_glass: {
        Args: {
          _fields: string[]
          _pseudo_id: string
          _reason: string
          _ticket_ref: string
        }
        Returns: string
      }
      admin_ops_health: { Args: never; Returns: Json }
      admin_platform_status: { Args: never; Returns: Json }
      admin_proactive_engine_status: { Args: never; Returns: Json }
      admin_proactive_engine_toggle: {
        Args: { _channels?: string[]; _enabled?: boolean }
        Returns: Json
      }
      admin_proactive_queue: { Args: { _limit?: number }; Returns: Json }
      admin_process_deletion_request: {
        Args: { p_id: string }
        Returns: string
      }
      admin_rate_check: {
        Args: { p_action: string; p_limit?: number }
        Returns: boolean
      }
      admin_reconcile_split_reminders: {
        Args: { p_expense_id?: string }
        Returns: Json
      }
      admin_reject_deletion_request: {
        Args: { p_id: string; p_notes: string }
        Returns: undefined
      }
      admin_reprocess_failed: { Args: { p_job_key: string }; Returns: Json }
      admin_run_check: { Args: { p_job_key: string }; Returns: Json }
      admin_split_reminder_policy: { Args: never; Returns: Json }
      admin_split_reminder_policy_update: {
        Args: {
          _due_soon_days_before: number
          _due_today_enabled: boolean
          _enabled: boolean
          _first_overdue_days: number
          _max_overdue_reminders: number
          _pause_on_reply: boolean
          _repeat_every_days: number
          _send_hour: number
        }
        Returns: Json
      }
      admin_users_list: {
        Args: { p_limit?: number; p_offset?: number; p_search?: string }
        Returns: {
          created_at: string
          display_name: string
          email: string
          is_platform_admin: boolean
          last_sign_in_at: string
          onboarding_completed_at: string
          user_id: string
          whatsapp_linked: boolean
        }[]
      }
      admin_v2_assistant_health: { Args: { _days?: number }; Returns: Json }
      admin_v2_audit_list: { Args: { _limit?: number }; Returns: Json }
      admin_v2_client_profile: { Args: { _pseudo_id: string }; Returns: Json }
      admin_v2_clients_identity: {
        Args: { _pseudo_ids: string[] }
        Returns: Json
      }
      admin_v2_clients_identity_masked: {
        Args: { _pseudo_ids: string[] }
        Returns: Json
      }
      admin_v2_clients_list: {
        Args: {
          _financial?: string
          _from?: string
          _lifecycle?: string
          _limit?: number
          _to?: string
          _tz?: string
        }
        Returns: Json
      }
      admin_v2_cockpit: {
        Args: { _from?: string; _to?: string }
        Returns: Json
      }
      admin_v2_contract_health: { Args: never; Returns: Json }
      admin_v2_daily_evolution: {
        Args: { _from: string; _to: string; _tz?: string }
        Returns: Json
      }
      admin_v2_governance_summary: { Args: never; Returns: Json }
      admin_v2_growth_cohorts: { Args: { _weeks?: number }; Returns: Json }
      admin_v2_growth_funnel: { Args: { _days?: number }; Returns: Json }
      admin_v2_growth_summary: {
        Args: { _from: string; _to: string; _tz?: string }
        Returns: Json
      }
      admin_v2_ia_ocr_metrics: { Args: { _days?: number }; Returns: Json }
      admin_v2_message_intelligence: { Args: { _days?: number }; Returns: Json }
      admin_v2_messaging_activity: { Args: { _days?: number }; Returns: Json }
      admin_v2_metrics_audit: { Args: never; Returns: Json }
      admin_v2_metrics_universe: { Args: never; Returns: Json }
      admin_v2_nino_item_trace: { Args: { _item_id: string }; Returns: Json }
      admin_v2_nino_quality_summary: { Args: { _days?: number }; Returns: Json }
      admin_v2_operations_health: { Args: { _hours?: number }; Returns: Json }
      admin_v2_proactive_summary: {
        Args: { _channel?: string; _days?: number; _kind?: string }
        Returns: Json
      }
      admin_v2_product_features: { Args: { _days?: number }; Returns: Json }
      admin_v2_product_opportunities: { Args: never; Returns: Json }
      admin_v2_retry_failed_outbound: {
        Args: { _limit?: number }
        Returns: Json
      }
      admin_v2_revenue_summary: { Args: never; Returns: Json }
      admin_v2_whatsapp_monitor: { Args: { _days?: number }; Returns: Json }
      admin_waha_config_status: { Args: never; Returns: Json }
      admin_waha_resolve_config: { Args: never; Returns: Json }
      admin_waha_save_config: {
        Args: {
          p_api_key: string
          p_session_name?: string
          p_url: string
          p_webhook_secret?: string
        }
        Returns: Json
      }
      admin_whatsapp_inbound_health: { Args: never; Returns: Json }
      agent_compile_prompt: { Args: { p_cfg: Json }; Returns: string }
      agent_execute_confirmation: {
        Args: { p_confirmation_id: string; p_source_message_id?: string }
        Returns: Json
      }
      agent_execute_confirmation_legacy_v1: {
        Args: { p_confirmation_id: string; p_source_message_id?: string }
        Returns: Json
      }
      agent_execute_shared_expense_confirmation: {
        Args: { p_confirmation_id: string; p_source_message_id?: string }
        Returns: Json
      }
      agent_prompt_create_draft: {
        Args: { p_from_id?: string }
        Returns: string
      }
      agent_prompt_list: {
        Args: never
        Returns: {
          created_at: string
          created_by: string
          id: string
          max_steps: number
          model: string
          notes: string
          parent_version_id: string
          published_at: string
          published_by: string
          restored_from_id: string
          status: Database["public"]["Enums"]["prompt_status"]
          structured_config: Json
          temperature: number
          updated_at: string
          version: number
        }[]
      }
      agent_prompt_publish: {
        Args: { p_expected_updated_at: string; p_id: string }
        Returns: string
      }
      agent_prompt_restore: { Args: { p_id: string }; Returns: string }
      agent_prompt_update_draft: {
        Args: {
          p_cfg: Json
          p_expected_updated_at: string
          p_id: string
          p_notes: string
        }
        Returns: Json
      }
      agent_sim_enqueue: {
        Args: { p_from_phone: string; p_text: string; p_user_id: string }
        Returns: Json
      }
      agent_sim_reset: { Args: { p_user_id: string }; Returns: undefined }
      agent_upsert_draft: {
        Args: {
          p_conversation_id: string
          p_kind: string
          p_payload: Json
          p_summary: string
          p_ttl_minutes?: number
          p_user_id: string
        }
        Returns: string
      }
      amount_to_bucket: {
        Args: { _amount: number }
        Returns: Database["public"]["Enums"]["value_bucket"]
      }
      apply_outbound_ack: {
        Args: { p_ack: string; p_provider_message_id: string }
        Returns: {
          id: string
          new_status: string
        }[]
      }
      apply_safe_category_suggestions: { Args: never; Returns: Json }
      apply_split_reminder_policy: {
        Args: { p_expense_id?: string }
        Returns: Json
      }
      approve_credit_card_statement: {
        Args: { p_statement_id: string }
        Returns: Json
      }
      audit_card_reconciliation: {
        Args: { _user_id?: string }
        Returns: {
          competence_month: string
          credit_card_id: string
          items_total: number
          outstanding_amount: number
          reconciled_total: number
          residual: number
          stated_total: number
          statement_status: string
        }[]
      }
      backfill_product_events_from_history: {
        Args: { _days?: number }
        Returns: Json
      }
      cancel_document_import: { Args: { p_document_id: string }; Returns: Json }
      cancel_pending_action: { Args: { p_id: string }; Returns: undefined }
      card_competence_for: {
        Args: { p_card_id: string; p_date: string }
        Returns: string
      }
      card_cycle_for: {
        Args: { p_closing_day: number; p_date: string; p_due_day: number }
        Returns: {
          closing_date: string
          competence_month: string
          due_date: string
          fallback: boolean
          period_end: string
          period_start: string
        }[]
      }
      category_alias_key: { Args: { p_text: string }; Returns: string }
      challenge_progress_add: {
        Args: {
          p_delta: number
          p_slug: string
          p_source_id: string
          p_source_type: string
        }
        Returns: undefined
      }
      claim_outbound_batch: {
        Args: { p_limit?: number }
        Returns: {
          accepted_at: string | null
          artifact_id: string | null
          attempts: number
          body: string
          channel: string
          claimed_at: string | null
          context_id: string | null
          context_type: string | null
          created_at: string
          dead_letter_at: string | null
          delivered_at: string | null
          feature: string | null
          id: string
          idempotency_key: string | null
          inbound_message_id: string | null
          kind: string
          last_ack_at: string | null
          last_error: string | null
          lease_expires_at: string | null
          media_mime: string | null
          media_status: string | null
          media_url: string | null
          metadata: Json
          next_attempt_at: string
          participant_id: string | null
          provider: Database["public"]["Enums"]["messaging_provider"]
          provider_message_id: string | null
          read_at: string | null
          retry_count: number
          sent_at: string | null
          sla_breach_at: string | null
          status: Database["public"]["Enums"]["msg_status"]
          surface: string | null
          to_phone: string
          updated_at: string
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "outbound_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_reminder_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          cancel_reason: string | null
          created_at: string
          deliver_after: string | null
          delivered_at: string | null
          delivery_status: string
          followup_of: string | null
          id: string
          idempotency_key: string | null
          kind: string
          last_error: string | null
          lease_expires_at: string | null
          next_attempt_at: string | null
          outbound_message_id: string | null
          owner_user_id: string
          participant_id: string | null
          policy_version: string | null
          read_at: string | null
          retry_count: number
          scheduled_for: string
          sent_at: string | null
          shared_expense_id: string
          status: Database["public"]["Enums"]["reminder_status"]
          superseded_by: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "reminder_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_reminder_jobs_for_owner: {
        Args: { p_limit?: number; p_owner_user_id: string }
        Returns: {
          attempts: number
          cancel_reason: string | null
          created_at: string
          deliver_after: string | null
          delivered_at: string | null
          delivery_status: string
          followup_of: string | null
          id: string
          idempotency_key: string | null
          kind: string
          last_error: string | null
          lease_expires_at: string | null
          next_attempt_at: string | null
          outbound_message_id: string | null
          owner_user_id: string
          participant_id: string | null
          policy_version: string | null
          read_at: string | null
          retry_count: number
          scheduled_for: string
          sent_at: string | null
          shared_expense_id: string
          status: Database["public"]["Enums"]["reminder_status"]
          superseded_by: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "reminder_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      commit_movement: { Args: { payload: Json }; Returns: Json }
      complete_challenge: {
        Args: { p_slug: string }
        Returns: {
          challenge_id: string | null
          challenge_slug: string | null
          current_progress: number
          finished_at: string | null
          id: string
          progress: number
          started_at: string
          status: Database["public"]["Enums"]["user_challenge_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "user_challenges"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_onboarding: {
        Args: {
          p_display_name: string
          p_frequency: Database["public"]["Enums"]["income_frequency"]
          p_income: number
          p_income_day: number
        }
        Returns: undefined
      }
      confirm_balance_snapshot: {
        Args: { p_snapshot_id: string }
        Returns: Json
      }
      confirm_document_import: {
        Args: {
          p_document_id: string
          p_item_ids: string[]
          p_user_id?: string
        }
        Returns: Json
      }
      confirm_invoice_import_atomic: {
        Args: {
          p_document_id: string
          p_idempotency_key?: string
          p_item_ids: string[]
        }
        Returns: Json
      }
      confirm_pending_action: { Args: { p_id: string }; Returns: Json }
      create_phone_link_code: { Args: never; Returns: string }
      create_transfer: {
        Args: {
          p_amount: number
          p_description: string
          p_from_account: string
          p_occurred_at: string
          p_to_account: string
        }
        Returns: string
      }
      credit_card_competence: {
        Args: { p_closing_day: number; p_purchase: string }
        Returns: string
      }
      current_platform_admin_role: {
        Args: never
        Returns: Database["public"]["Enums"]["platform_role"]
      }
      current_platform_permissions: {
        Args: never
        Returns: {
          action: string
          allowed: boolean
        }[]
      }
      delete_credit_card_statement_item: {
        Args: { p_item_id: string }
        Returns: Json
      }
      delete_financial_report: { Args: { p_report_id: string }; Returns: Json }
      discard_credit_card_statement: {
        Args: { p_statement_id: string }
        Returns: Json
      }
      documents_cleanup_tick: { Args: never; Returns: number }
      ensure_profile: { Args: never; Returns: undefined }
      ensure_pseudonym: { Args: { _user_id: string }; Returns: string }
      finalize_invoice_statement: {
        Args: { p_document_id: string; p_item_ids: string[] }
        Returns: Json
      }
      finance_bridges_backfill_tick: {
        Args: { p_months?: number }
        Returns: number
      }
      financial_reports_monthly_tick: { Args: never; Returns: number }
      financial_reports_tick: {
        Args: { p_report_type: string }
        Returns: number
      }
      financial_reports_weekly_tick: { Args: never; Returns: number }
      force_reconcile_credit_card_statement:
        | {
            Args: { p_justification: string; p_statement_id: string }
            Returns: Json
          }
        | {
            Args: {
              p_evidence?: Json
              p_justification: string
              p_reason_code?: string
              p_statement_id: string
            }
            Returns: Json
          }
      grant_platform_admin: {
        Args: {
          _role: Database["public"]["Enums"]["platform_role"]
          _target: string
        }
        Returns: undefined
      }
      has_platform_permission: { Args: { _action: string }; Returns: boolean }
      has_role:
        | {
            Args: { _role: Database["public"]["Enums"]["app_role"] }
            Returns: boolean
          }
        | {
            Args: {
              _role: Database["public"]["Enums"]["app_role"]
              _user_id: string
            }
            Returns: boolean
          }
      import_legacy_batch: { Args: { p_payload: Json }; Returns: Json }
      import_transactions_batch: {
        Args: { p_account_id: string; p_rows: Json }
        Returns: Json
      }
      insights_generate_tick: { Args: never; Returns: number }
      is_behavioral_consumption: {
        Args: {
          p_movement_kind: string
          p_settles_card_id: string
          p_status: string
          p_transfer_group_id: string
          p_type: string
        }
        Returns: boolean
      }
      is_client_user: { Args: { _user_id: string }; Returns: boolean }
      is_current_user_admin: { Args: never; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_shared_goal_member: {
        Args: { _goal_id: string; _user_id: string }
        Returns: boolean
      }
      is_split_participant: {
        Args: { _expense_id: string; _user_id: string }
        Returns: boolean
      }
      join_challenge: {
        Args: { p_slug: string }
        Returns: {
          challenge_id: string | null
          challenge_slug: string | null
          current_progress: number
          finished_at: string | null
          id: string
          progress: number
          started_at: string
          status: Database["public"]["Enums"]["user_challenge_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "user_challenges"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      learn_transaction_category: {
        Args: { p_category_id: string; p_transaction_id: string }
        Returns: undefined
      }
      link_split_participant: {
        Args: { p_participant_id: string; p_source?: string }
        Returns: Json
      }
      list_my_whatsapp_link: {
        Args: never
        Returns: {
          consent_at: string
          id: string
          last_verified_at: string
          phone_masked: string
          status: Database["public"]["Enums"]["link_status"]
        }[]
      }
      mark_all_notifications_read: { Args: never; Returns: number }
      mark_financial_report_viewed: {
        Args: { p_report_id: string }
        Returns: string
      }
      mark_outbound_sent: {
        Args: { p_id: string; p_provider_message_id: string }
        Returns: undefined
      }
      my_advisor_action_feedback: {
        Args: { _action_key: string; _review_id: string; _status: string }
        Returns: Json
      }
      my_advisor_readiness: { Args: never; Returns: Json }
      my_behavior_hypothesis_feedback: {
        Args: { _feedback?: string; _hypothesis_id: string; _verdict: string }
        Returns: Json
      }
      my_communication_feedback: {
        Args: { _delivery_id: string; _feedback: string }
        Returns: Json
      }
      my_financial_snapshot_v6: {
        Args: { _period_end?: string; _period_start?: string }
        Returns: Json
      }
      my_more_menu_context: { Args: never; Returns: Json }
      my_nino_context: { Args: never; Returns: Json }
      my_nino_diagnosis_context: { Args: never; Returns: Json }
      my_nino_duplicate_decision: {
        Args: { _decision: string; _pair_key: string }
        Returns: Json
      }
      my_nino_duplicate_decision_legacy: {
        Args: { _decision: string; _pair_key: string }
        Returns: Json
      }
      my_nino_home_item: { Args: never; Returns: Json }
      my_nino_intelligence_context: { Args: never; Returns: Json }
      my_nino_item_act: {
        Args: { _item_id: string; _surface?: string }
        Returns: Json
      }
      my_nino_item_feedback: {
        Args: { _feedback: string; _item_id: string; _surface?: string }
        Returns: Json
      }
      my_nino_mark_seen: {
        Args: { _section?: string; _surface: string }
        Returns: Json
      }
      my_nino_memory_delete: { Args: { _memory_id: string }; Returns: boolean }
      my_nino_memory_update: {
        Args: { _expires_at?: string; _memory_id: string; _value: Json }
        Returns: Json
      }
      my_nino_record_exposure: {
        Args: {
          _channel?: string
          _item_id: string
          _rank?: number
          _selection_reason?: string
          _surface: string
        }
        Returns: Json
      }
      my_nino_refresh: { Args: never; Returns: Json }
      my_nino_refresh_legacy: { Args: never; Returns: Json }
      my_nino_situation_feedback: {
        Args: { _feedback: string; _situation_id: string; _surface?: string }
        Returns: Json
      }
      my_proactive_preferences_update: {
        Args: {
          _emotional?: boolean
          _financial?: boolean
          _max_per_day?: number
          _muted?: string[]
          _smart_tips?: boolean
          _whatsapp?: boolean
        }
        Returns: Json
      }
      my_proactive_suggestion: { Args: { _dedup_key: string }; Returns: Json }
      my_proactive_suggestion_feedback: {
        Args: { _dedup_key: string; _feedback: string }
        Returns: undefined
      }
      my_reports_current_context: {
        Args: { _end?: string; _start?: string }
        Returns: Json
      }
      my_tip_feedback: {
        Args: { _feedback: string; _insight_id: string }
        Returns: undefined
      }
      my_whatsapp_channel_health_v1: { Args: never; Returns: Json }
      nino_assemble_diagnosis: {
        Args: { _as_of?: string; _run_mode?: string; _user_id: string }
        Returns: string
      }
      nino_backfill_items: { Args: { _dry_run?: boolean }; Returns: Json }
      nino_backfill_rollback: { Args: never; Returns: Json }
      nino_brl: { Args: { _v: number }; Returns: string }
      nino_build_facts: { Args: { _user_id: string }; Returns: number }
      nino_consolidate_topics: { Args: { _user_id: string }; Returns: number }
      nino_curate_items: { Args: { _user_id: string }; Returns: Json }
      nino_diag_brl: { Args: { _value: number }; Returns: string }
      nino_diag_feedback_suppressed: {
        Args: { _user_id: string }
        Returns: string[]
      }
      nino_diag_pct: { Args: { _value: number }; Returns: string }
      nino_diag_put_situation: {
        Args: {
          _absolute_delta: number
          _action: Json
          _as_of: string
          _baseline_value: number
          _cause: string
          _confidence: number
          _consequence: string
          _current_value: number
          _evaluation: Json
          _evidence: Json
          _forecast: string
          _headline: string
          _impact_amount: number
          _percentage_delta: number
          _period_end: string
          _period_start: string
          _run_id: string
          _run_mode: string
          _severity: string
          _situation_key: string
          _situation_type: string
          _status: string
          _temporal_scope: string
          _user_id: string
          _valid_until: string
        }
        Returns: string
      }
      nino_diag_resolve_conflicts: {
        Args: { _run_mode?: string; _user_id: string }
        Returns: number
      }
      nino_diag_score: {
        Args: {
          _actionable: boolean
          _confidence: number
          _impact: number
          _impact_pct: number
          _positive?: boolean
          _severity: string
          _temporal_scope: string
        }
        Returns: number
      }
      nino_diag_select_action: {
        Args: {
          _evaluation?: Json
          _impact?: number
          _situation_type: string
          _status: string
        }
        Returns: Json
      }
      nino_diagnosis_backtest: {
        Args: {
          _from: string
          _step_days?: number
          _to: string
          _user_id: string
        }
        Returns: Json
      }
      nino_diagnosis_context_for_user: {
        Args: { _user_id: string }
        Returns: Json
      }
      nino_diagnosis_rollback: { Args: never; Returns: Json }
      nino_diagnosis_tick: { Args: never; Returns: Json }
      nino_evaluate_financial_situations: {
        Args: {
          _as_of?: string
          _run_mode?: string
          _source?: string
          _user_id: string
        }
        Returns: Json
      }
      nino_evaluate_future_situations: {
        Args: {
          _as_of: string
          _run_id: string
          _run_mode: string
          _user_id: string
        }
        Returns: number
      }
      nino_expense_sum: {
        Args: { _from: string; _to: string; _user_id: string }
        Returns: number
      }
      nino_fix_money_text: { Args: { _t: string }; Returns: string }
      nino_group_duplicates: { Args: { _user_id: string }; Returns: number }
      nino_intelligence_tick: { Args: never; Returns: Json }
      nino_item_category: {
        Args: { _kind: string; _topic: string }
        Returns: string
      }
      nino_item_json: {
        Args: {
          _row: Database["public"]["Tables"]["nino_intelligence_items"]["Row"]
        }
        Returns: Json
      }
      nino_legacy_intelligence_tick: { Args: never; Returns: Json }
      nino_legacy_rebuild_items: {
        Args: { _created_by?: string; _user_id: string }
        Returns: number
      }
      nino_norm_text: { Args: { _t: string }; Returns: string }
      nino_num: { Args: { _v: number }; Returns: string }
      nino_project_diagnosis: {
        Args: { _snapshot_id: string; _user_id: string }
        Returns: number
      }
      nino_project_diagnosis_communications: {
        Args: { _snapshot_id: string; _user_id: string }
        Returns: number
      }
      nino_rebuild_items: {
        Args: { _created_by?: string; _user_id: string }
        Returns: number
      }
      nino_refresh_diagnosis: {
        Args: {
          _as_of?: string
          _run_mode?: string
          _source?: string
          _user_id: string
        }
        Returns: Json
      }
      nino_score_item: {
        Args: {
          _category: string
          _confidence: number
          _exposures: number
          _group_size: number
          _impact: number
          _impact_pct: number
          _kind: string
          _severity: string
          _valid_from: string
        }
        Returns: number
      }
      nino_semantic_gate: {
        Args: { _kind: string; _text: string }
        Returns: string
      }
      nino_topic_key: {
        Args: {
          _action: Json
          _evidence: Json
          _kind: string
          _period_start: string
          _source: string
          _title: string
        }
        Returns: string
      }
      normalize_br_phone: { Args: { raw: string }; Returns: string }
      normalize_investment_name: { Args: { p_name: string }; Returns: string }
      notifications_mark_interacted: {
        Args: { _action?: string; _notification_id: string }
        Returns: Json
      }
      notify_upsert: {
        Args: {
          p_action_url: string
          p_body: string
          p_dedup_key: string
          p_title: string
          p_type: Database["public"]["Enums"]["notification_type"]
          p_user_id: string
        }
        Returns: string
      }
      product_events_prune: { Args: { _days?: number }; Returns: number }
      prune_product_events: { Args: { _days?: number }; Returns: number }
      recalc_credit_card_statement: {
        Args: { p_statement_id: string }
        Returns: Json
      }
      reconcile_account_from_statement: {
        Args: {
          p_account_id: string
          p_balance: number
          p_balance_date: string
          p_document_id?: string
          p_issued_at?: string
          p_period_end?: string
          p_period_start?: string
          p_source?: string
        }
        Returns: string
      }
      reconcile_agent_memory_categories: { Args: never; Returns: number }
      reconcile_card_competence: {
        Args: { p_card_id: string; p_competence: string }
        Returns: Json
      }
      reconcile_document_balance: {
        Args: { p_account_id: string; p_document_id: string }
        Returns: Json
      }
      reconcile_imported_installment_history: {
        Args: { p_document_id: string }
        Returns: number
      }
      reconcile_split_reminder_jobs: {
        Args: { p_expense_id?: string }
        Returns: Json
      }
      record_admin_reauth: { Args: { _method?: string }; Returns: string }
      record_debt_payment: {
        Args: {
          p_account_id: string
          p_amount: number
          p_debt_id: string
          p_fee_amount?: number
          p_idempotency_key?: string
          p_installments_covered?: number
          p_interest_amount?: number
          p_notes?: string
          p_paid_at: string
        }
        Returns: Json
      }
      record_job_stages: {
        Args: {
          p_error_code?: string
          p_failed?: number
          p_job_key: string
          p_next_run_at?: string
          p_ok?: boolean
          p_processed?: number
          p_stages?: Json
        }
        Returns: undefined
      }
      recover_expired_outbound_leases: { Args: never; Returns: number }
      recurring_confirm: { Args: { p_occurrence_id: string }; Returns: string }
      recurring_generate_due: {
        Args: { p_horizon_days?: number }
        Returns: number
      }
      recurring_skip: { Args: { p_occurrence_id: string }; Returns: undefined }
      refresh_financial_daily_facts: {
        Args: { p_from: string; p_to: string; p_user_id: string }
        Returns: number
      }
      refresh_product_aggregates_full: {
        Args: { _days?: number }
        Returns: undefined
      }
      refresh_product_aggregates_incremental: {
        Args: never
        Returns: undefined
      }
      reprocess_rejected_items: {
        Args: { p_document_id: string; p_reason_codes?: string[] }
        Returns: Json
      }
      reprocess_transaction_behavior_dates: {
        Args: { _batch_size?: number }
        Returns: Json
      }
      require_recent_reauth: {
        Args: { _max_age_seconds?: number }
        Returns: boolean
      }
      resolve_transaction_behavior_date: {
        Args: { _row: Database["public"]["Tables"]["transactions"]["Row"] }
        Returns: {
          behavior_at: string
          behavior_day: string
          confidence: number
          source: string
        }[]
      }
      reverse_credit_card_statement_payment: {
        Args: { p_payment_id: string }
        Returns: Json
      }
      revoke_platform_admin: { Args: { _target: string }; Returns: undefined }
      revoke_whatsapp_link: { Args: never; Returns: undefined }
      rollback_document_import: {
        Args: { p_document_id: string }
        Returns: Json
      }
      schedule_split_due_reminders: {
        Args: { p_expense_id?: string }
        Returns: number
      }
      set_active_prompt_version: { Args: { p_id: string }; Returns: undefined }
      settle_credit_card_statement: {
        Args: {
          p_account_id: string
          p_amount?: number
          p_idempotency_key?: string
          p_paid_at?: string
          p_statement_id: string
        }
        Returns: Json
      }
      shared_goal_accept_invite: { Args: { p_goal_id: string }; Returns: Json }
      shared_goal_add_contribution: {
        Args: {
          p_amount: number
          p_goal_id: string
          p_idempotency_key?: string
          p_note?: string
          p_occurred_at?: string
        }
        Returns: string
      }
      shared_goal_cancel: { Args: { p_goal_id: string }; Returns: Json }
      shared_goal_contribute: {
        Args: {
          p_amount: number
          p_goal_id: string
          p_note?: string
          p_occurred_at?: string
        }
        Returns: string
      }
      shared_goal_create: {
        Args: { p_deadline?: string; p_target_amount: number; p_title: string }
        Returns: string
      }
      shared_goal_decline_invite: { Args: { p_goal_id: string }; Returns: Json }
      shared_goal_invite: {
        Args: { p_goal_id: string; p_phone_e164: string; p_token_hash: string }
        Returns: string
      }
      shared_goal_leave: { Args: { p_goal_id: string }; Returns: Json }
      shared_goal_pending_invites: {
        Args: never
        Returns: {
          created_at: string
          deadline: string
          goal_id: string
          member_id: string
          target_amount: number
          title: string
        }[]
      }
      shared_goal_remove_member: {
        Args: { p_goal_id: string; p_member_id: string }
        Returns: Json
      }
      shared_goal_role: {
        Args: { _goal_id: string; _user_id: string }
        Returns: string
      }
      shared_goal_update: {
        Args: {
          p_deadline?: string
          p_goal_id: string
          p_target_amount?: number
          p_title?: string
        }
        Returns: Json
      }
      split_add_payment: {
        Args: { p_amount: number; p_participant_id: string }
        Returns: undefined
      }
      split_add_payment_v2: {
        Args: { p_amount: number; p_participant_id: string }
        Returns: undefined
      }
      split_assert_financial_source: {
        Args: {
          p_account_id: string
          p_card_id: string
          p_category_id: string
          p_reimbursement_account_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      split_cancel: {
        Args: {
          p_id: string
          p_reason?: string
          p_remove_transaction?: boolean
        }
        Returns: undefined
      }
      split_claim_pending: { Args: never; Returns: number }
      split_create: {
        Args: {
          p_due_date: string
          p_include_owner: boolean
          p_occurred_at: string
          p_owner_amount?: number
          p_participants: Json
          p_pix_key: string
          p_reminder_enabled: boolean
          p_split_mode: Database["public"]["Enums"]["split_mode"]
          p_title: string
          p_total: number
        }
        Returns: string
      }
      split_create_v2: {
        Args: {
          p_category_id?: string
          p_due_date: string
          p_include_owner: boolean
          p_occurred_at: string
          p_owner_amount?: number
          p_participants: Json
          p_pix_key: string
          p_register_transaction?: boolean
          p_reimbursement_account_id?: string
          p_reminder_enabled: boolean
          p_source_account_id?: string
          p_source_credit_card_id?: string
          p_split_mode: Database["public"]["Enums"]["split_mode"]
          p_title: string
          p_total: number
        }
        Returns: string
      }
      split_delete: { Args: { p_id: string }; Returns: undefined }
      split_delivery_diagnosis: {
        Args: { p_expense_id: string }
        Returns: Json
      }
      split_due_timestamp: {
        Args: { p_date: string; p_hour?: number }
        Returns: string
      }
      split_enqueue_message: {
        Args: {
          p_expense_id: string
          p_kind: string
          p_participant_id: string
          p_when?: string
        }
        Returns: string
      }
      split_message_pipeline_tick: { Args: never; Returns: number }
      split_message_status: {
        Args: { p_id: string }
        Returns: {
          attempts: number
          job_id: string
          job_status: string
          kind: string
          last_attempt_at: string
          last_error: string
          outbound_attempts: number
          outbound_status: string
          participant_id: string
          scheduled_for: string
          updated_at: string
        }[]
      }
      split_participant_is_eligible: {
        Args: { p_participant_id: string }
        Returns: boolean
      }
      split_participant_report: {
        Args: { p_action: string; p_participant_id: string }
        Returns: undefined
      }
      split_reverse_payment: {
        Args: { p_participant_id: string }
        Returns: undefined
      }
      split_reverse_payment_v2: {
        Args: { p_participant_id: string }
        Returns: undefined
      }
      split_send_reminders: {
        Args: { p_shared_expense_id: string }
        Returns: number
      }
      split_set_reimbursement_category: {
        Args: { p_category_id: string; p_transaction_id: string }
        Returns: Json
      }
      split_summary: {
        Args: never
        Returns: {
          active_splits: number
          pending_people: number
          total_pending: number
          total_received: number
        }[]
      }
      split_token: { Args: never; Returns: string }
      split_update: {
        Args: {
          p_category_id: string
          p_due_date: string
          p_id: string
          p_occurred_at: string
          p_participants: Json
          p_pix_key: string
          p_register_transaction?: boolean
          p_reimbursement_account_id: string
          p_reminder_enabled: boolean
          p_source_account_id: string
          p_source_credit_card_id: string
          p_split_mode: Database["public"]["Enums"]["split_mode"]
          p_title: string
          p_total: number
        }
        Returns: undefined
      }
      split_upsert_original_transaction: {
        Args: { p_expense_id: string }
        Returns: string
      }
      sweep_orphan_agent_runs: { Args: never; Returns: number }
      sync_installment_absorption: {
        Args: { p_statement_id?: string }
        Returns: undefined
      }
      transaction_delete_direct: {
        Args: { p_expected_version: number; p_id: string; p_scope?: string }
        Returns: Json
      }
      transaction_update_direct: {
        Args: {
          p_expected_version: number
          p_id: string
          p_patch: Json
          p_scope?: string
        }
        Returns: Json
      }
      update_agent_settings: {
        Args: {
          p_max_steps: number
          p_model: string
          p_temperature: number
          p_timeout_ms: number
        }
        Returns: undefined
      }
      update_credit_card_statement_item: {
        Args: {
          p_amount?: number
          p_category_id?: string
          p_description?: string
          p_item_id: string
          p_item_kind?: string
          p_occurred_at?: string
        }
        Returns: Json
      }
      upsert_cash_bridge: { Args: { p_bridge: Json }; Returns: string }
      upsert_net_worth_bridge: { Args: { p_bridge: Json }; Returns: string }
      user_cancel_deletion_request: {
        Args: { p_id: string }
        Returns: undefined
      }
      user_export_data: { Args: never; Returns: Json }
      user_request_deletion: { Args: { p_reason: string }; Returns: string }
      validate_invoice_import: {
        Args: { p_document_id: string; p_item_ids: string[] }
        Returns: Json
      }
      value_events: { Args: never; Returns: string[] }
      whatsapp_ack_watchdog_tick: { Args: never; Returns: number }
      whatsapp_send_dispatch_tick: { Args: never; Returns: number }
    }
    Enums: {
      account_type: "checking" | "savings" | "cash" | "investment" | "other"
      app_role: "admin" | "user"
      category_type: "income" | "expense"
      challenge_kind:
        | "spending_log"
        | "goal_contribution"
        | "emotion_checkin"
        | "pre_spend_review"
        | "custom"
      confirmation_status: "pending" | "confirmed" | "cancelled" | "expired"
      debt_status: "active" | "settled" | "defaulted"
      deletion_status:
        | "pending"
        | "approved"
        | "processing"
        | "completed"
        | "rejected"
        | "cancelled"
      event_source: "live" | "backfill" | "backfill_proxy"
      goal_status: "active" | "paused" | "completed"
      import_batch_status: "pending" | "completed" | "failed"
      income_frequency: "mensal" | "quinzenal" | "semanal" | "variavel"
      link_status: "pending" | "active" | "revoked"
      messaging_provider: "waha" | "meta_cloud"
      msg_direction: "inbound" | "outbound"
      msg_status:
        | "queued"
        | "processing"
        | "sent"
        | "delivered"
        | "read"
        | "failed"
        | "dead"
      nino_item_kind:
        | "change"
        | "risk"
        | "opportunity"
        | "achievement"
        | "data_quality"
        | "pattern"
        | "commitment"
        | "projection"
        | "pending_confirmation"
        | "recommendation"
        | "closed_period_summary"
      nino_item_status:
        | "candidate"
        | "active"
        | "superseded"
        | "expired"
        | "acted"
        | "dismissed"
        | "archived"
      nino_temporal_role: "now" | "historical" | "future" | "closed_period"
      notification_type:
        | "agent_confirmation"
        | "recurrence_due"
        | "goal_reached"
        | "split_reminder"
        | "import_done"
        | "achievement"
        | "system"
        | "goal_invite"
        | "goal_contribution"
        | "goal_milestone"
        | "split_participant_linked"
        | "financial_report"
      occurrence_status: "planned" | "confirmed" | "skipped"
      participant_status:
        | "pending"
        | "notified"
        | "partial"
        | "paid"
        | "waived"
        | "opted_out"
        | "payment_reported"
        | "awaiting_owner_confirmation"
      platform_role: "platform_owner" | "platform_admin" | "support" | "analyst"
      prompt_status: "draft" | "active" | "archived"
      recurring_frequency: "daily" | "weekly" | "monthly" | "yearly"
      recurring_status: "active" | "paused" | "finished"
      reminder_status:
        | "queued"
        | "sent"
        | "failed"
        | "skipped"
        | "processing"
        | "enqueued"
      run_status: "running" | "done" | "error" | "cancelled"
      split_mode: "equal" | "custom"
      split_status: "draft" | "active" | "settled" | "cancelled"
      transaction_status: "confirmed" | "planned"
      transaction_type: "income" | "expense" | "transfer"
      transfer_direction: "debit" | "credit"
      txn_origin: "manual" | "agent" | "import" | "recurring" | "split"
      user_challenge_status: "joined" | "completed" | "abandoned"
      value_bucket: "0_50" | "50_100" | "100_250" | "250_500" | "500_plus"
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
      account_type: ["checking", "savings", "cash", "investment", "other"],
      app_role: ["admin", "user"],
      category_type: ["income", "expense"],
      challenge_kind: [
        "spending_log",
        "goal_contribution",
        "emotion_checkin",
        "pre_spend_review",
        "custom",
      ],
      confirmation_status: ["pending", "confirmed", "cancelled", "expired"],
      debt_status: ["active", "settled", "defaulted"],
      deletion_status: [
        "pending",
        "approved",
        "processing",
        "completed",
        "rejected",
        "cancelled",
      ],
      event_source: ["live", "backfill", "backfill_proxy"],
      goal_status: ["active", "paused", "completed"],
      import_batch_status: ["pending", "completed", "failed"],
      income_frequency: ["mensal", "quinzenal", "semanal", "variavel"],
      link_status: ["pending", "active", "revoked"],
      messaging_provider: ["waha", "meta_cloud"],
      msg_direction: ["inbound", "outbound"],
      msg_status: [
        "queued",
        "processing",
        "sent",
        "delivered",
        "read",
        "failed",
        "dead",
      ],
      nino_item_kind: [
        "change",
        "risk",
        "opportunity",
        "achievement",
        "data_quality",
        "pattern",
        "commitment",
        "projection",
        "pending_confirmation",
        "recommendation",
        "closed_period_summary",
      ],
      nino_item_status: [
        "candidate",
        "active",
        "superseded",
        "expired",
        "acted",
        "dismissed",
        "archived",
      ],
      nino_temporal_role: ["now", "historical", "future", "closed_period"],
      notification_type: [
        "agent_confirmation",
        "recurrence_due",
        "goal_reached",
        "split_reminder",
        "import_done",
        "achievement",
        "system",
        "goal_invite",
        "goal_contribution",
        "goal_milestone",
        "split_participant_linked",
        "financial_report",
      ],
      occurrence_status: ["planned", "confirmed", "skipped"],
      participant_status: [
        "pending",
        "notified",
        "partial",
        "paid",
        "waived",
        "opted_out",
        "payment_reported",
        "awaiting_owner_confirmation",
      ],
      platform_role: ["platform_owner", "platform_admin", "support", "analyst"],
      prompt_status: ["draft", "active", "archived"],
      recurring_frequency: ["daily", "weekly", "monthly", "yearly"],
      recurring_status: ["active", "paused", "finished"],
      reminder_status: [
        "queued",
        "sent",
        "failed",
        "skipped",
        "processing",
        "enqueued",
      ],
      run_status: ["running", "done", "error", "cancelled"],
      split_mode: ["equal", "custom"],
      split_status: ["draft", "active", "settled", "cancelled"],
      transaction_status: ["confirmed", "planned"],
      transaction_type: ["income", "expense", "transfer"],
      transfer_direction: ["debit", "credit"],
      txn_origin: ["manual", "agent", "import", "recurring", "split"],
      user_challenge_status: ["joined", "completed", "abandoned"],
      value_bucket: ["0_50", "50_100", "100_250", "250_500", "500_plus"],
    },
  },
} as const
