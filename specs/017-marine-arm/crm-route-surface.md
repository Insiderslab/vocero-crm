# Planned route surface for CRM recovery

This is a design inventory, not an activated gateway. Keep original gateway.Caddyfile.template untouched. New gateway.crm.Caddyfile.template must preserve peer trust, Host/proto, headers and default404.

Pages GET/HEAD: /login, /dashboard, /contacts, /inbox, /pipeline, /agent, /automations, /lab, /settings, /settings/whatsapp, /settings/branding, /settings/templates, /settings/team, /settings/api-keys, /settings/site, /settings/listening, /tours, /nautica, /pasajero. Existing beauty pages are not in marine navigation or gateway. Global /admin and public/register remain excluded.

Assets GET/HEAD: /_next/static/*, /favicon.ico, /api/branding/favicon, /nautica/manifest.webmanifest and exact /marine/icon-192.png, /marine/icon-512.png (generated generic monogram, no external imagery). Manifest is scoped /nautica, start_url=/nautica.

Auth GET: /api/auth/get-session. POST: /api/auth/sign-in/email, /api/auth/sign-out, /api/auth/organization/set-active. No other auth routes.

CRM API routes: enumerate each concrete router file/method from source; dynamic IDs use anchored single-segment regex, not /api/* wildcard. Required families: contacts, conversations, dashboard/summary, pipeline, agent/profile, kb, automations, tags, templates, lab, my-orgs, events, settings branding/team/listening/WhatsApp/webhook/botkeys/exportkeys/site; media GET only. API wrappers enforce marine-profile role. /api/marine and /api/public/marine retain own separate methods/guards. Exclude /api/seed, /api/admin, /api/bot, /api/export, /api/dev, provider webhooks, public beauty booking, /_next/image and all unknown routes.

Retain32KiB body ceiling including chunked requests. Exclude multipart conversation media POST and favicon upload PUT from this increment; expose a clear marine pilot notice in shell that file uploads/provider sends are not enabled. Public branding favicon GET remains allowed. Existing key/config screens may display inactive/missing provider state; no keys or network egress added. Local provider mocks only in explicitly synthetic local test instance, never online. Tagging/contacts/config drafts can be tested locally with synthetic records. Every allowlist regex must have negative path/method/bypass tests. Settings connections appearing in menu does not assert the provider is connected.

## Exact API inventory

Dynamic brackets mean one nonempty ID path segment; they are not subtree wildcards. Verbs not listed deny. Headers/body ceilings apply before application processing.

| Path | Methods | Guard |
|---|---|---|
| `/api/marine` | GET, POST | Existing session owner/admin/member and role projection/commands; not CRM wrapper |
| `/api/public/marine` | GET, POST | Existing per-passenger bearer registration token, throttling and bounded input |
| `/api/agent/profile` | GET, PUT | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/automations/[id]` | PATCH, DELETE | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/automations/[id]/runs` | GET | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/automations` | GET, POST | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/contacts/[id]` | GET, PATCH | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/contacts/[id]/start-conversation` | POST | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/contacts/[id]/tags` | PUT | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/contacts` | GET, POST | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/conversations/[id]/messages` | GET | Marine CRM owner/admin; preserve stricter existing guard |
| `/api/conversations/[id]` | PATCH | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/conversations` | GET | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/dashboard/summary` | GET | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/events` | GET | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/kb/[id]` | PATCH, DELETE | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/kb` | GET, POST | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/kb/size` | GET | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/lab/runs/[id]` | GET | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/lab/runs` | GET | Marine CRM owner/admin; preserve stricter existing guard |
| `/api/lab/suggestions/apply` | POST | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/media/[assetId]` | GET | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/my-orgs` | GET | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/pipeline/board` | GET | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/pipeline/leads/[id]` | PATCH | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/pipeline/stages/[id]` | PATCH, DELETE | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/pipeline/stages` | GET, POST | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/settings/bot-keys/[id]` | DELETE | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/settings/bot-keys` | GET, POST | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/settings/branding` | GET, PUT | Public branding GET; owner PUT |
| `/api/settings/export-keys/[id]` | DELETE | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/settings/export-keys` | GET, POST | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/settings/listening` | GET, PUT | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/settings/site/key` | POST, DELETE | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/settings/site` | GET, PUT | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/settings/team` | GET, POST | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/settings/webhook` | GET | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/settings/whatsapp/embedded-signup` | GET | Marine CRM owner/admin; preserve stricter existing guard |
| `/api/settings/whatsapp/route-check` | GET | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/settings/whatsapp` | GET | Marine CRM owner/admin; preserve stricter existing guard |
| `/api/settings/whatsapp/status` | GET | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/settings/whatsapp/wapi-key` | GET | Marine CRM owner/admin; preserve stricter existing guard |
| `/api/tags/[id]` | DELETE | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/tags` | GET, POST | Marine CRM owner/admin; preserve any stricter existing guard |
| `/api/templates` | GET | Marine CRM owner/admin; preserve stricter existing guard |

## Provider actions denied in this pilot

Before any proxy allowlist, return503 JSON code pilot_provider_disabled for POST conversation messages, messages/template, messages/media, agent-retry; POST automations/run, lab/runs, templates, templates/sync, settings/whatsapp/test and embedded-signup; PUT settings/whatsapp and PUT/DELETE settings/whatsapp/wapi-key. These are denied for owner/admin too; public browser tests assert no application/provider invocation. Existing configuration GET screens remain visible and show a clear pilot notice. The rest of the inventory is local state/read only; the production app retains internal networks without WAN and no provider credentials. Keep the original standard-profile application behavior for other deployments. This is a gateway restriction on the synthetic pilot, not a claim that the original CRM lacks these functions.

Marine positive gateway tests must cover all four GET/POST path pairs; PUT/PATCH/DELETE/HEAD and extra subpaths deny. Existing per-route16KiB parser bound remains below edge32KiB.
