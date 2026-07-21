# Migrating to a Company Database & Deploying the App

This app is a single static HTML file with no build step. All persistence goes
through two helper functions (`sbFetch`, `sbFetchAll`) that talk directly to a
Supabase project's REST API (PostgREST). That means both "swap the database"
and "deploy the app" are simpler than they look — but there are a few things
worth doing properly rather than just pasting in new credentials.

---

## Part 1 — Moving to a company/enterprise database

You have three realistic paths, in order of effort.

### Option A — Move to a company-owned Supabase project (least work)
If your company already has (or is willing to create) its own Supabase
organization/project, this is a drop-in swap:

1. In the new Supabase project, create the same table the app expects:
   ```sql
   create table public.feeder_data (
     id bigint generated always as identity primary key,
     dataset_key text not null,
     row_index int not null,
     data jsonb not null default '{}'::jsonb,
     origin_count int default 0,
     created_at timestamptz default now()
   );

   create index feeder_data_dataset_key_idx on public.feeder_data (dataset_key);
   create index feeder_data_dataset_key_row_idx on public.feeder_data (dataset_key, row_index);
   ```
2. **Migrate existing data.** Easiest path: use Supabase's own dashboard
   (Table Editor → Export CSV, or `pg_dump`/`pg_restore` between the two
   Postgres instances). Since every row is just `dataset_key`/`row_index`/`data`/`origin_count`,
   a straight table copy is safe — there's no foreign-key structure to preserve.
   - `pg_dump --data-only -t feeder_data <old_db_url> | psql <new_db_url>` is the cleanest if you have direct Postgres access to both.
   - Otherwise, write a one-off script that pages through the old REST API (`sbFetchAll` logic) and POSTs into the new one.
3. **Lock down access.** The current setup uses Supabase's anonymous (`anon`) key with no Row Level Security, meaning anyone with the URL+key (which is embedded in the client-side JS) has full read/write. For a company deployment you should, at minimum:
   - Enable **Row Level Security** on `feeder_data`.
   - Add policies scoped to authenticated users (via Supabase Auth) rather than `anon`.
   - If you don't want to build a login flow, at minimum put the app behind your company's existing SSO/VPN and treat the anon key as "trusted network only," not public-internet safe.
4. Update two constants near the top of the `<script>` block in `index.html`:
   ```javascript
   const SUPABASE_URL = 'https://<your-project>.supabase.co';
   const SUPABASE_KEY = '<your-anon-or-restricted-key>';
   ```
5. Smoke-test: open the app, confirm the sync status badge shows "connected," add a test row, refresh, confirm it persisted.

### Option B — Self-hosted Postgres behind PostgREST (moderate work)
If the company wants to keep data fully on-prem/in their own cloud account rather than Supabase's hosted service:

1. Stand up Postgres (RDS, Azure Database for PostgreSQL, on-prem, etc.) with the same `feeder_data` table shown above.
2. Run [PostgREST](https://postgrest.org) in front of it (a lightweight open-source binary/Docker container — this is literally what Supabase's REST layer is built on). Point it at your Postgres instance and expose it over HTTPS.
3. Because PostgREST's query syntax (`?column=eq.value`, `Range` header for pagination, `Prefer: return=representation` for insert responses) is what this app is already written against, **no JS changes are required** beyond pointing `SUPABASE_URL` at your PostgREST endpoint and removing/adjusting the `apikey`/`Authorization` headers to match however you're securing PostgREST (JWT, API gateway, etc.).
4. Put an API gateway or reverse proxy (nginx, Kong, company API gateway) in front of PostgREST for TLS termination, auth, and rate limiting.

### Option C — A different database engine entirely (e.g., SQL Server, Oracle, a custom internal API)
This is the only path that requires real code changes, because the app's data
layer assumes PostgREST's query conventions. If the company's standard is a
different database:

1. Someone will need to build a thin REST API in front of that database exposing four operations the app relies on:
   - `GET /feeder_data?dataset_key=eq.<key>&order=row_index.asc` → list rows for a dataset
   - `POST /feeder_data` (bulk insert, array body) → returns inserted rows with generated `id`s
   - `DELETE /feeder_data?dataset_key=eq.<key>` → clear a dataset before rewriting it
   - Range-header based pagination for `sbFetchAll` (or just remove pagination if you cap dataset size)
2. Replace `sbFetch`/`sbFetchAll` in the JS with equivalent calls to your new API. Everything else in the app (rendering, import, history, etc.) only calls those two functions, so this is a contained change — expect to touch ~2 functions, not the whole file.
3. Re-test import, export, history, and compare flows end-to-end since they all round-trip through the data layer.

**Recommendation:** unless there's a hard mandate against Supabase/Postgres, Option A or B will get you "big company database" (managed backups, proper access control, your own cloud account/VPC) with the least engineering risk, since the app was built against PostgREST's contract from day one.

---

## Part 2 — Deploying the app

Since this is a single self-contained HTML file (no bundler, no `node_modules`, no build step), "deployment" just means putting the file somewhere reachable over HTTPS and making sure the browser can reach your database's REST endpoint.

### Simplest: internal web server
Drop `index.html` into the web root of whatever your company already runs:
- **nginx**: copy to `/usr/share/nginx/html/` (or a subpath), reload nginx.
- **IIS**: copy to the site's physical path.
- **Apache**: copy to `DocumentRoot`.

No special config needed beyond normal HTTPS/TLS termination, since the app makes no server-side calls of its own — everything happens in the user's browser directly against Supabase/PostgREST.

### Static hosting platforms (fastest to set up, good for small teams)
Any static host works since there's nothing to build:
- **Netlify / Vercel**: push the file to a Git repo, connect the repo, set build command to *none* / output directory to the repo root, deploy. You get HTTPS and a URL automatically.
- **AWS S3 + CloudFront**: upload `index.html` to an S3 bucket configured for static website hosting, put CloudFront in front for HTTPS and caching.
- **Azure Static Web Apps / GitHub Pages**: same idea — no build step, just publish the file.

### Company intranet
If your organization already has an internal portal (SharePoint, Confluence, an internal tools dashboard), you can often embed or link directly to the hosted HTML file rather than building new infrastructure.

### Things to check after deploying
1. **CORS/network egress**: the browser needs outbound HTTPS access to your Supabase/PostgREST domain from wherever users are (office network, VPN, etc.). If the company has an outbound allowlist/firewall, add that domain.
2. **CORS on the database side**: Supabase's REST API allows cross-origin requests by default; if you're running your own PostgREST/gateway, make sure CORS headers permit your app's deployed origin.
3. **Secrets aren't really secret**: the Supabase URL and key are visible to anyone who views the page source, since this is a pure client-side app. Security has to come from Row Level Security / auth on the database side, not from hiding the key. Don't rely on obscuring `SUPABASE_KEY` as your access control.
4. **HTTPS everywhere**: serve the app over HTTPS (most static hosts do this by default) so the Supabase/PostgREST calls aren't mixed-content-blocked and credentials aren't sent in the clear.
5. **Multiple environments**: if you want separate dev/staging/prod datasets, the cleanest approach is separate Supabase projects (or separate `dataset_key` prefixes in one project) with separate deployed copies of `index.html` pointing at each.

---

## Quick checklist

- [ ] New database table created with the same `feeder_data` schema
- [ ] Existing data migrated and spot-checked
- [ ] Row Level Security / auth configured (don't ship with a wide-open anon key)
- [ ] `SUPABASE_URL` / `SUPABASE_KEY` updated in `index.html`
- [ ] File hosted somewhere reachable over HTTPS
- [ ] Outbound network access to the database's REST endpoint confirmed from users' network
- [ ] End-to-end smoke test: import a file, edit a cell, save history, export, compare
