#!/usr/bin/env node

// src/store/supabase.ts
import { createClient } from "@supabase/supabase-js";
var client = null;
function getSupabaseClient() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key);
  return client;
}
function isSupabaseEnabled() {
  return getSupabaseClient() !== null;
}
var PAGE_SIZE = 500;
async function fetchUpdatedCards(since) {
  const sb = getSupabaseClient();
  if (!sb) return [];
  const all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb.from("fix_cards").select("*").gt("updated_at", since).order("tool").range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}
var traceErrorCount = 0;
function getTraceErrorCount() {
  return traceErrorCount;
}
async function insertTrace(trace) {
  const sb = getSupabaseClient();
  if (!sb) return;
  const traceType = "error" in trace && trace.error ? "failure" : "success";
  const { error } = await sb.from("traces").insert({
    ...trace,
    trace_type: traceType
  });
  if (error) {
    traceErrorCount++;
    if (traceErrorCount % 100 === 0) {
      console.error(`[agent-community] ${traceErrorCount} trace insert failures so far`);
    }
    throw error;
  }
}
async function upsertCards(cards) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const adminClient = createClient(url, key);
  const errors = [];
  let inserted = 0;
  for (const card of cards) {
    const { error } = await adminClient.from("fix_cards").upsert({
      id: card.id,
      tool: card.tool,
      error_signature: card.error_signature,
      context_key: card.context_key,
      title: card.title,
      symptom: card.symptom,
      applies_when: card.applies_when,
      not_this_if: card.not_this_if,
      root_cause: card.root_cause,
      fix_steps: card.fix_steps,
      agent_instruction: card.agent_instruction,
      safety_notes: card.safety_notes,
      fix_type: card.fix_type,
      tags: card.tags,
      severity: card.severity,
      confidence: card.confidence,
      quality_score: card.quality_score,
      source_type: card.source_type,
      verified_on: card.verified_on,
      created: card.created,
      version_notes: card.version_notes
    }, { onConflict: "id" });
    if (error) {
      errors.push(`${card.id}: ${error.message}`);
    } else {
      inserted++;
    }
  }
  return { inserted, errors };
}
async function submitCard(cardData, submittedBy) {
  const sb = getSupabaseClient();
  if (!sb) throw new Error("Supabase is not configured");
  const { data, error } = await sb.from("card_submissions").insert({
    submitted_by: submittedBy ?? "anonymous",
    card_data: cardData,
    status: "pending"
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

export {
  getSupabaseClient,
  isSupabaseEnabled,
  fetchUpdatedCards,
  getTraceErrorCount,
  insertTrace,
  upsertCards,
  submitCard
};
