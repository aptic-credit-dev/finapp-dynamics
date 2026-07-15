# Enterprise AI Foundation (m24)

## Purpose
The central, governed AI layer serving every module: gateway, provider abstraction, model + prompt registries,
RAG/vector services, confidence scoring, human review, DLP, residency, retention, and audit. 21 reference tables.

## Components
AI gateway (provider-agnostic routing; local-LLM + cloud readiness); model registry + prompt registry (versioned
prompts); vector database + embeddings + RAG; knowledge bases; usage + cost + quality/evaluation; AI audit logs;
AI governance controls.

## Governance principles
AI must cite source evidence where required, show confidence where relevant, not fabricate authoritative records,
not approve or post controlled actions, not expose unauthorized data, not submit restricted data to unapproved
providers, and preserve human accountability. Every AI output is audited; DLP applies to AI requests + outputs.

## Shared services
Auth/RBAC (m02), audit (m03), workflow (m06), documents (m09), security/DLP (m41). Consumed by all module-level
AI (m25–m28) and governed by m29.

## MVP
Gateway + registries + a small set of governed summaries/classifications, human-reviewed, behind flags. Approved-
provider routing per data classification is confirmed before any restricted data is processed.
