# OpenBao server config (ADR-132). No secrets here. Paths/certs supplied out-of-band.
# Staging = single node. Production = 3 nodes (each with a unique node_id + retry_join peers; see README).

ui = false

storage "raft" {
  path    = "/openbao/data"
  node_id = "aptic-openbao-1"
  # Production: add retry_join blocks for the other two nodes to form the quorum:
  # retry_join { leader_api_addr = "https://openbao-2.internal:8200" }
  # retry_join { leader_api_addr = "https://openbao-3.internal:8200" }
}

listener "tcp" {
  address       = "0.0.0.0:8200"           # bound to the private interface at the container/host boundary
  tls_cert_file = "/openbao/tls/server.crt" # provided out-of-band; NOT committed
  tls_key_file  = "/openbao/tls/server.key" # provided out-of-band; NOT committed
  tls_min_version = "tls12"
  # Optional mutual TLS for the API client:
  # tls_require_and_verify_client_cert = true
  # tls_client_ca_file = "/openbao/tls/ca.crt"
}

# Production auto-unseal via a separate transit vault (keeps the unseal key OFF this node).
# Staging may use Shamir (operator unseals). Uncomment + configure for production:
# seal "transit" {
#   address    = "https://unseal-vault.internal:8200"
#   key_name   = "autounseal-aptic"
#   mount_path = "transit/"
#   # token supplied via BAO_TOKEN env at runtime — NEVER committed
# }

api_addr     = "https://127.0.0.1:8200"
cluster_addr = "https://127.0.0.1:8201"

# Audit device — DECLARATIVE (config-based). This OpenBao build (>= 2.6) rejects runtime `bao audit enable`
# ("use declarative, config-based audit device management instead"), so the device MUST be declared here.
# A missing audit device makes OpenBao FAIL requests (fail-closed) — desired. Verified live on OpenBao 2.6.2.
audit "file/" {
  type = "file"
  path = "file/"
  options = {
    file_path = "/openbao/audit/audit.log" # secret values are HMAC-masked, never plaintext
  }
}
