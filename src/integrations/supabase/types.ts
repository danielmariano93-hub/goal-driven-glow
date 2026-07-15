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
          status: Database["public"]["Enums"]["prompt_status"]
          system_prompt: string
          temperature: number
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          max_steps?: number
          model?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["prompt_status"]
          system_prompt: string
          temperature?: number
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          max_steps?: number
          model?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["prompt_status"]
          system_prompt?: string
          temperature?: number
          version?: number
        }
        Relationships: []
      }
      agent_runs: {
        Row: {
          conversation_id: string | null
          cost_cents: number
          ended_at: string | null
          error_masked: string | null
          error_sanitized: string | null
          id: string
          latency_ms: number | null
          model: string | null
          path: string | null
          prompt_version_id: string | null
          started_at: string
          status: Database["public"]["Enums"]["run_status"]
          steps: number
          tokens_in: number
          tokens_out: number
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          cost_cents?: number
          ended_at?: string | null
          error_masked?: string | null
          error_sanitized?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          path?: string | null
          prompt_version_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          steps?: number
          tokens_in?: number
          tokens_out?: number
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          cost_cents?: number
          ended_at?: string | null
          error_masked?: string | null
          error_sanitized?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          path?: string | null
          prompt_version_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          steps?: number
          tokens_in?: number
          tokens_out?: number
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
        ]
      }
      agent_settings: {
        Row: {
          id: number
          max_steps: number
          model: string
          proactive_enabled: boolean
          temperature: number
          timeout_ms: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: number
          max_steps?: number
          model?: string
          proactive_enabled?: boolean
          temperature?: number
          timeout_ms?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          max_steps?: number
          model?: string
          proactive_enabled?: boolean
          temperature?: number
          timeout_ms?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
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
      categories: {
        Row: {
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
        Relationships: []
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
      conversation_messages: {
        Row: {
          body_masked: string
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["msg_direction"]
          id: string
          user_id: string
        }
        Insert: {
          body_masked: string
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["msg_direction"]
          id?: string
          user_id: string
        }
        Update: {
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
          phone_e164: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          pending_slots?: Json | null
          phone_e164: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          pending_slots?: Json | null
          phone_e164?: string
          user_id?: string
        }
        Relationships: []
      }
      debts: {
        Row: {
          created_at: string
          creditor: string | null
          due_day: number | null
          id: string
          installment_amount: number | null
          interest_rate_pct: number | null
          name: string
          notes: string | null
          original_amount: number
          outstanding_balance: number
          status: Database["public"]["Enums"]["debt_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          creditor?: string | null
          due_day?: number | null
          id?: string
          installment_amount?: number | null
          interest_rate_pct?: number | null
          name: string
          notes?: string | null
          original_amount: number
          outstanding_balance: number
          status?: Database["public"]["Enums"]["debt_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          creditor?: string | null
          due_day?: number | null
          id?: string
          installment_amount?: number | null
          interest_rate_pct?: number | null
          name?: string
          notes?: string | null
          original_amount?: number
          outstanding_balance?: number
          status?: Database["public"]["Enums"]["debt_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      emotional_checkins: {
        Row: {
          created_at: string
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
        ]
      }
      goals: {
        Row: {
          created_at: string
          id: string
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
          id?: string
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
          id?: string
          name?: string
          notes?: string | null
          priority?: number
          status?: Database["public"]["Enums"]["goal_status"]
          target_amount?: number
          target_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
        Relationships: []
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
        ]
      }
      inbound_messages: {
        Row: {
          body: string | null
          from_phone: string
          id: string
          ignored_reason: string | null
          processed_at: string | null
          provider: Database["public"]["Enums"]["messaging_provider"]
          provider_message_id: string
          raw_hash: string | null
          received_at: string
          to_phone: string | null
        }
        Insert: {
          body?: string | null
          from_phone: string
          id?: string
          ignored_reason?: string | null
          processed_at?: string | null
          provider: Database["public"]["Enums"]["messaging_provider"]
          provider_message_id: string
          raw_hash?: string | null
          received_at?: string
          to_phone?: string | null
        }
        Update: {
          body?: string | null
          from_phone?: string
          id?: string
          ignored_reason?: string | null
          processed_at?: string | null
          provider?: Database["public"]["Enums"]["messaging_provider"]
          provider_message_id?: string
          raw_hash?: string | null
          received_at?: string
          to_phone?: string | null
        }
        Relationships: []
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
        ]
      }
      outbound_messages: {
        Row: {
          attempts: number
          body: string
          channel: string
          claimed_at: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          inbound_message_id: string | null
          kind: string
          last_error: string | null
          lease_expires_at: string | null
          next_attempt_at: string
          provider: Database["public"]["Enums"]["messaging_provider"]
          provider_message_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["msg_status"]
          to_phone: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          body: string
          channel?: string
          claimed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          inbound_message_id?: string | null
          kind?: string
          last_error?: string | null
          lease_expires_at?: string | null
          next_attempt_at?: string
          provider?: Database["public"]["Enums"]["messaging_provider"]
          provider_message_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["msg_status"]
          to_phone: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          body?: string
          channel?: string
          claimed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          inbound_message_id?: string | null
          kind?: string
          last_error?: string | null
          lease_expires_at?: string | null
          next_attempt_at?: string
          provider?: Database["public"]["Enums"]["messaging_provider"]
          provider_message_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["msg_status"]
          to_phone?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outbound_messages_inbound_message_id_fkey"
            columns: ["inbound_message_id"]
            isOneToOne: false
            referencedRelation: "inbound_messages"
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
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          currency: string
          display_name: string | null
          id: string
          is_sandbox: boolean
          onboarding_completed_at: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          display_name?: string | null
          id: string
          is_sandbox?: boolean
          onboarding_completed_at?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          display_name?: string | null
          id?: string
          is_sandbox?: boolean
          onboarding_completed_at?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
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
        ]
      }
      transactions: {
        Row: {
          account_id: string
          amount: number
          category_id: string | null
          created_at: string
          description: string | null
          direction: Database["public"]["Enums"]["transfer_direction"] | null
          emotional_trigger: string | null
          id: string
          notes: string | null
          occurred_at: string
          status: Database["public"]["Enums"]["transaction_status"]
          transfer_group_id: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          direction?: Database["public"]["Enums"]["transfer_direction"] | null
          emotional_trigger?: string | null
          id?: string
          notes?: string | null
          occurred_at: string
          status?: Database["public"]["Enums"]["transaction_status"]
          transfer_group_id?: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          direction?: Database["public"]["Enums"]["transfer_direction"] | null
          emotional_trigger?: string | null
          id?: string
          notes?: string | null
          occurred_at?: string
          status?: Database["public"]["Enums"]["transaction_status"]
          transfer_group_id?: string | null
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id?: string
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
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      user_challenges: {
        Row: {
          challenge_id: string
          finished_at: string | null
          id: string
          progress: number
          started_at: string
          status: Database["public"]["Enums"]["user_challenge_status"]
          user_id: string
        }
        Insert: {
          challenge_id: string
          finished_at?: string | null
          id?: string
          progress?: number
          started_at?: string
          status?: Database["public"]["Enums"]["user_challenge_status"]
          user_id: string
        }
        Update: {
          challenge_id?: string
          finished_at?: string | null
          id?: string
          progress?: number
          started_at?: string
          status?: Database["public"]["Enums"]["user_challenge_status"]
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
        ]
      }
      user_financial_settings: {
        Row: {
          approximate_monthly_income: number | null
          created_at: string
          currency: string
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
          income_day?: number | null
          income_frequency?:
            | Database["public"]["Enums"]["income_frequency"]
            | null
          timezone?: string
          updated_at?: string
          user_id?: string
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
          role: Database["public"]["Enums"]["app_role"]
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
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_dashboard_stats: { Args: never; Returns: Json }
      agent_execute_confirmation: {
        Args: { p_confirmation_id: string; p_source_message_id?: string }
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
      cancel_pending_action: { Args: { p_id: string }; Returns: undefined }
      claim_outbound_batch: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          body: string
          channel: string
          claimed_at: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          inbound_message_id: string | null
          kind: string
          last_error: string | null
          lease_expires_at: string | null
          next_attempt_at: string
          provider: Database["public"]["Enums"]["messaging_provider"]
          provider_message_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["msg_status"]
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
      complete_onboarding: {
        Args: {
          p_display_name: string
          p_frequency: Database["public"]["Enums"]["income_frequency"]
          p_income: number
          p_income_day: number
        }
        Returns: undefined
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
      ensure_profile: { Args: never; Returns: undefined }
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
      is_current_user_admin: { Args: never; Returns: boolean }
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
      mark_outbound_sent: {
        Args: { p_id: string; p_provider_message_id: string }
        Returns: undefined
      }
      recover_expired_outbound_leases: { Args: never; Returns: number }
      revoke_whatsapp_link: { Args: never; Returns: undefined }
      set_active_prompt_version: { Args: { p_id: string }; Returns: undefined }
      update_agent_settings: {
        Args: {
          p_max_steps: number
          p_model: string
          p_temperature: number
          p_timeout_ms: number
        }
        Returns: undefined
      }
    }
    Enums: {
      account_type: "checking" | "savings" | "cash" | "investment" | "other"
      app_role: "admin" | "user"
      category_type: "income" | "expense"
      confirmation_status: "pending" | "confirmed" | "cancelled" | "expired"
      debt_status: "active" | "settled" | "defaulted"
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
      prompt_status: "draft" | "active" | "archived"
      recurring_frequency: "daily" | "weekly" | "monthly" | "yearly"
      run_status: "running" | "done" | "error" | "cancelled"
      transaction_status: "confirmed" | "planned"
      transaction_type: "income" | "expense" | "transfer"
      transfer_direction: "debit" | "credit"
      user_challenge_status: "joined" | "completed" | "abandoned"
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
      confirmation_status: ["pending", "confirmed", "cancelled", "expired"],
      debt_status: ["active", "settled", "defaulted"],
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
      prompt_status: ["draft", "active", "archived"],
      recurring_frequency: ["daily", "weekly", "monthly", "yearly"],
      run_status: ["running", "done", "error", "cancelled"],
      transaction_status: ["confirmed", "planned"],
      transaction_type: ["income", "expense", "transfer"],
      transfer_direction: ["debit", "credit"],
      user_challenge_status: ["joined", "completed", "abandoned"],
    },
  },
} as const
