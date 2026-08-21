# Least-privilege ACL policy for the Aptic Dynamics API (ADR-132).
# Grants ONLY transit envelope operations on the finapp key family — nothing else. No sys/*, no other paths,
# no read of raw key material. This is exactly what the OpenBaoSecretProvider adapter needs.

# Manage/version the finapp transit keys (create on first provision; read metadata for resolve).
path "transit/keys/finapp-*" {
  capabilities = ["create", "read", "update"]
}

# Crypto-erase on destroy: allow deletion + delete the key (adapter sets deletion_allowed then DELETEs).
path "transit/keys/finapp-*/config" {
  capabilities = ["update"]
}
path "transit/keys/finapp-*" {
  capabilities = ["delete"]
}

# Envelope encrypt/decrypt/rewrap on the finapp keys (material never leaves the vault).
path "transit/encrypt/finapp-*" {
  capabilities = ["update"]
}
path "transit/decrypt/finapp-*" {
  capabilities = ["update"]
}
path "transit/rewrap/finapp-*" {
  capabilities = ["update"]
}

# Explicitly DENY everything else of consequence (deny beats allow in OpenBao/Vault).
path "sys/*" {
  capabilities = ["deny"]
}
path "auth/*" {
  capabilities = ["deny"]
}
