# Deployment TODO

## Pending: Load Balancer + Custom Domain Setup
**Status:** Waiting on customer domain confirmation
**Proposed domains:** `emailsentiment.mystartupcfo.com` (web), `emailsentiment-api.mystartupcfo.com` (API)

### 1. Create Load Balancer Infrastructure
- [ ] Reserve global static external IP
- [ ] Create Google-managed SSL certificates for both domains
- [ ] Create Serverless NEGs for `crm-web` and `crm-api`
- [ ] Create backend services with the NEGs
- [ ] Create URL map with host-based routing:
  - `emailsentiment.mystartupcfo.com` → crm-web
  - `emailsentiment-api.mystartupcfo.com` → crm-api
- [ ] Create HTTPS target proxy with SSL certs
- [ ] Create global forwarding rule (binds IP + proxy)

### 2. DNS Records (customer adds these)
- [ ] A record: `emailsentiment.mystartupcfo.com` → LB static IP
- [ ] A record: `emailsentiment-api.mystartupcfo.com` → same LB static IP

### 3. Update Environment Variables
- [ ] crm-web: `VITE_API_URL=https://emailsentiment-api.mystartupcfo.com`
- [ ] crm-api: `WEB_URL=https://emailsentiment.mystartupcfo.com`
- [ ] crm-api: `BETTER_AUTH_URL=https://emailsentiment-api.mystartupcfo.com`
- [ ] crm-api: `SERVICE_API_URL=https://emailsentiment-api.mystartupcfo.com`
- [ ] crm-api: `APP_URL=https://emailsentiment.mystartupcfo.com`
- [ ] Update `deploy.yml` CRM_API_URL / CRM_WEB_URL constants to match new domains

### 4. Update Google OAuth Console
- [ ] Authorized redirect URI: `https://emailsentiment-api.mystartupcfo.com/api/auth/callback/google`
- [ ] Authorized JavaScript origin: `https://emailsentiment.mystartupcfo.com`
- [ ] Remove old `*.run.app` redirect URIs (if any)

### 5. Lock Down Cloud Run Ingress
- [ ] Set all Cloud Run services to `--ingress internal-and-cloud-load-balancing`
- [ ] Update `deploy.yml` ingress settings to match
- [ ] Verify services are no longer accessible via `*.run.app` URLs directly

### 6. Google OAuth Consent Screen
- [ ] Publish app (move out of testing mode) if not already done
- [ ] Verify external users (rtzen.ai, numerafinance.com) can sign in

## Pending: SSL Certificate-Based Connectivity to Cloud SQL
- [ ] Configure SSL/TLS for Cloud SQL connections
- [ ] Update DATABASE_URL connection strings with SSL cert params
- [ ] Verify all services connect via SSL

## Completed
- [x] Set `VITE_API_URL` on crm-web Cloud Run service (immediate fix)
- [x] Add `--set-env-vars` to all deploy jobs in `deploy.yml`
- [x] Fix crm-api ingress to `--ingress all` in workflow
- [x] Switch Google OAuth consent screen from Internal to External
- [x] Add `rtzen.ai` to tenant domains (then removed along with `rtzen.com`)
- [x] Seed users (Manish Balsara, Vignesh Mohan) with correct tenant
- [x] Remove public IP from Cloud SQL instance
