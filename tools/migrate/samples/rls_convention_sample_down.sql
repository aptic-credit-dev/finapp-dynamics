-- Reverses rls_convention_sample.sql. The throwaway tables leave no trace (Stage 0 acceptance).
DROP TABLE IF EXISTS rls_sample_child CASCADE;
DROP TABLE IF EXISTS rls_sample_parent CASCADE;
DROP TABLE IF EXISTS rls_sample_tenant CASCADE;
