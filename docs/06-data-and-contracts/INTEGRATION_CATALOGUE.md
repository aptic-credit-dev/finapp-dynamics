# Integration Catalogue

All external integration runs through the approved integration platform (m33–m37): connector SDK + registry,
connection + secret manager, integration runtime (mapping, transformation, retry, idempotency, queues, dead
letters), marketplace, public APIs + developer portal, webhooks + event streaming, and governance/QA/release.

## Initial connectors — honest status
Each connector is classified: Production Certified · Production Ready Pending Credentials · Sandbox Ready ·
Internal Preview · Framework Only · Blocked · Suspended. **In this handover, all are Framework Only / Sandbox
Ready** — none is production-certified until real credentials + a certification pass exist.

| Connector | Purpose | Handover status |
|---|---|---|
| ERPNext | Accounting/ERP | Framework/Sandbox |
| ApticOne | Core lending | Framework/Sandbox |
| Imarisha | Source system | Framework/Sandbox |
| AutoBonds | Bonds status | Framework/Sandbox |
| BimaPro | Insurance | Framework/Sandbox |
| ApticPay | Payments | Framework/Sandbox |
| M-Pesa | Mobile money | Sandbox |
| Email / SMS / WhatsApp | Messaging | Framework/Sandbox |
| Bank statement framework | Statement ingestion | Framework |
| Google Workspace / Microsoft 365 | Productivity/identity | Framework |

## Rules
Secrets are references (no raw secrets stored). Retry + idempotency + dead-letter on every integration. Connector
activation can depend on third-party risk assessment (GRC). No connector reaches production without a
certification pass.
