# Provider smoke deployment gate

The production deploy must fail closed before publishing Edge Functions when the real-provider ConversationBrain smoke rejects the semantic contract.

As of 2026-09-25 the smoke captures `conversation_brain_contract_invalid` reason codes in memory and prints them in CI without writing diagnostic rows to production. This file is intentionally non-executable; its presence also keeps provider-smoke hardening inside the atomic `supabase/functions/**` deployment scope while the workflow path filter is being aligned.

Do not bypass the real-provider smoke to publish a ConversationBrain change. Keep `conversation_brain_v1` disabled until the smoke passes and the deployed functions are verified.
