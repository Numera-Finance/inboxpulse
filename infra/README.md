# CRM GCP Infrastructure Setup

This directory contains shell scripts to provision the full GCP infrastructure for the CRM
platform. The setup creates a secure, private VPC environment where all internal services
communicate privately, only the web frontend and API are publicly reachable, and all secrets
are managed via Secret Manager.

## Architecture Overview

```
Internet
    │
    ▼
┌───────────────────────────────────────────────────────────┐
│  Global HTTPS Load Balancers (Cloud Armor WAF)            │
│  ┌─────────────────┐   ┌─────────────────────────────┐   │
│  │  crm-web-lb     │   │  crm-api-lb                 │   │
│  │  (frontend)     │   │  (REST API)                 │   │
│  └────────┬────────┘   └──────────────┬──────────────┘   │
└───────────┼──────────────────────────┼───────────────────┘
            │                          │
┌───────────▼──────────────────────────▼───────────────────────────┐
│  crm-vpc  (us-central1)                                          │
│  Subnet: 10.0.0.0/20                                             │
│                                                                   │
│  ┌─────────────────┐   ┌─────────────────────────────────────┐  │
│  │  crm-web        │   │  crm-api                            │  │
│  │  (nginx/SPA)    │   │  (Hono REST API)                    │  │
│  │  ingress: LB    │   │  ingress: LB                        │  │
│  └─────────────────┘   └────┬──────┬──────┬──────────────────┘  │
│                              │      │      │                      │
│              ┌───────────────┘      │      └──────────────┐      │
│              ▼                      ▼                      ▼      │
│  ┌──────────────────┐  ┌────────────────────┐  ┌──────────────┐ │
│  │  crm-gmail       │  │  crm-analysis      │  │ crm-notify   │ │
│  │  (Gmail sync)    │  │  (AI analysis)     │  │ (email notif)│ │
│  │  ingress: all    │  │  ingress: internal │  │ ingress: all │ │
│  │  auth: required  │  │  auth: required    │  │ inngest HMAC │ │
│  └──────┬───────────┘  └────────────────────┘  └──────────────┘ │
│         │                                                         │
│         │  ┌──────────────────────────────────┐                  │
│         │  │  Cloud SQL PostgreSQL 15          │                  │
│         │  │  Private IP only (10.1.x.x)      │                  │
│         │  │  High Availability (regional)    │                  │
│         │  └──────────────────────────────────┘                  │
│         │                                                         │
│  Cloud NAT ──────────────────────────────────────────────────►   │
│  (all services egress to internet: LLM APIs, AWS SES, etc.)      │
└──────────────────────────────────────────────────────────────────┘
         ▲
         │ Push (authenticated service account)
┌────────┴────────┐
│  Google Pub/Sub │
│  (Gmail events) │
└─────────────────┘
```

### Service Exposure Matrix

| Service              | Public? | Ingress Setting                    | Auth Required |
|----------------------|---------|------------------------------------|---------------|
| crm-web              | Yes     | internal-and-cloud-load-balancing  | No (SPA)      |
| crm-api              | Yes     | internal-and-cloud-load-balancing  | Session-based |
| crm-gmail            | No*     | all                                | Yes (IAM SA)  |
| crm-analysis         | No      | internal                           | Yes (IAM SA)  |
| crm-notifications    | No*     | all                                | No (Inngest HMAC) |

> **crm-gmail**: Marked public ingress because Pub/Sub originates outside your VPC. Protected by
> mandatory IAM token auth — only the `crm-pubsub-invoker-sa` service account can invoke it.
>
> **crm-notifications**: Inngest cloud calls back to this service. Protected by Inngest's
> HMAC signature verification on every request.

## Prerequisites

- `gcloud` CLI installed and authenticated (`gcloud auth login`)
- Project billing enabled
- You have `Owner` or `Editor` + required service-specific roles on the GCP project
- For the migration step: `pg_dump`, `pg_restore`, and `psql` installed locally

## Execution Order

Run the scripts in numbered order. Each script is **idempotent** — safe to re-run.
After each step, run `verify.sh` to confirm it worked before continuing.

```bash
# 0. Set your variables (edit 00-variables.env first!)
source infra/00-variables.env

# 1. Enable all required GCP APIs
bash infra/01-enable-apis.sh
bash infra/verify.sh apis

# 2. Create VPC, subnet, Cloud NAT, firewall rules, Private Service Connect
bash infra/02-vpc-networking.sh
bash infra/verify.sh vpc

# 3. Create Artifact Registry repository
bash infra/03-artifact-registry.sh
bash infra/verify.sh registry

# 4. Create Cloud SQL instance with private IP (takes 5-10 min)
bash infra/04-cloud-sql.sh
bash infra/verify.sh sql

# 5. Create all Secret Manager secrets (interactive — prompts for values)
bash infra/05-secret-manager.sh
bash infra/verify.sh secrets

# 6. Create service accounts and all IAM bindings
bash infra/06-service-accounts.sh
bash infra/verify.sh accounts

# 7. Deploy Cloud Run services with VPC, ingress, and secret config
bash infra/07-cloud-run.sh
bash infra/verify.sh services

# 8. Create Global HTTPS Load Balancers for web and api (+ Cloud Armor)
bash infra/08-load-balancer.sh
bash infra/verify.sh lb
# ↑ SSL certs will show PROVISIONING until DNS is configured — that's normal

# 9. Create Pub/Sub topic and authenticated push subscription for Gmail
bash infra/09-pubsub.sh
bash infra/verify.sh pubsub

# 10. Configure Workload Identity Federation for GitHub Actions CI/CD
bash infra/10-workload-identity.sh
bash infra/verify.sh cicd
# ↑ Add the printed GitHub Secrets to your repo, then push to main to test CI/CD

# 11. Initialize the Cloud SQL database schema
# Run from your local machine with DATABASE_URL set to the Cloud SQL private IP
# (use Cloud SQL Auth Proxy for local access: cloud-sql-proxy PROJECT:REGION:INSTANCE)
pnpm db:push

# 12. Full verification of everything
bash infra/verify.sh all
```

## Gaps & Considerations (Read Before Proceeding)

The following items are **not** handled by these scripts and require your decision:

### 1. Custom Domains (REQUIRED before going live)
The load balancers create static IPs but SSL certificates require domain names.
After `08-load-balancer.sh`, you must:
- Add `A` records pointing your domains to the static IPs printed by the script
- Update `WEB_URL` and `BETTER_AUTH_URL` secrets with the real domain names
- Wait for Google-managed SSL certs to provision (~15-30 min after DNS propagates)

Recommended:
- Frontend: `app.yourdomain.com` → crm-web-lb static IP
- API: `api.yourdomain.com` → crm-api-lb static IP

### 2. Inngest Configuration
`crm-notifications` (and possibly `crm-api`) use Inngest cloud for background job scheduling.
Inngest cloud needs to reach your services. Options:
- **Option A (current):** Keep `crm-notifications` with `--ingress=all` and rely on
  Inngest's HMAC signature verification. Simple, works out of the box.
- **Option B (hardened):** Self-host Inngest on Cloud Run inside the VPC. Requires
  additional setup — see https://www.inngest.com/docs/self-hosting

### 3. Environment Separation (Dev / Staging / Prod)
These scripts create a single environment. For multi-environment setups you should:
- Create separate GCP projects per environment (recommended for isolation)
- Or use separate VPCs / Cloud Run namespaces within one project
- Parameterize `00-variables.env` with an `ENVIRONMENT` variable

### 4. Amazon SES DNS Verification
`crm-notifications` sends email via Amazon SES. SES requires:
- DKIM, SPF, and DMARC DNS records for your sending domain
- SES domain/email verification in the AWS console
- These are DNS changes — not handled here

### 5. Database Connection Pooling
At scale, Cloud Run's auto-scaling can open many simultaneous Postgres connections.
Consider adding **PgBouncer** (transaction pooling) in front of Cloud SQL.
A simple option: deploy PgBouncer as a Cloud Run service in the same VPC.

### 6. Disaster Recovery
- Cloud SQL automated backups are enabled (7-day retention by default)
- Point-in-time recovery is enabled
- Cross-region replication is NOT configured — consider for DR in production

### 7. Multi-Region HA
This setup deploys to `us-central1` only. For global availability:
- Add Cloud Run deployments in additional regions
- Use Global Load Balancer's multi-region backend routing
- Cloud SQL cross-region read replica for lower read latency

### 8. Secret Rotation
Secret Manager secrets are created but rotation is not automated.
Consider enabling automatic rotation for database passwords via Secret Manager +
Cloud Functions rotation handlers.

### 9. Container Vulnerability Scanning
Artifact Registry can be configured with Container Analysis + Binary Authorization
to scan images before deployment. Not enabled by default — see:
https://cloud.google.com/artifact-registry/docs/analysis

### 10. Cost Estimate (approximate, us-central1)
| Component              | Spec                          | ~Monthly Cost |
|------------------------|-------------------------------|---------------|
| Cloud SQL              | db-custom-2-7680, HA, 50GB    | ~$150         |
| Cloud Run (5 services) | ~medium traffic               | ~$20-100      |
| Load Balancers (2)     | Global HTTPS                  | ~$40          |
| Artifact Registry      | 10GB storage                  | ~$1           |
| Cloud NAT              | per-core + data               | ~$5-20        |
| Secret Manager         | <10 secrets                   | <$1           |
| Cloud Monitoring       | Basic                         | Free tier     |
| **Total (estimate)**   |                               | **~$220-320** |
