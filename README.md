# ReqRes Todo App (client-only)

A Vite + React todo app that uses ReqRes app-user auth (magic links + session tokens) and app-scoped collections for per-user CRUD. This version is ready to ship on Cloudflare Pages.

## What it does

- Sends magic links with your **public project key** (`POST /api/app-users/login`)
- Verifies the token with your **manage key** to mint an app-session (`POST /api/app-users/verify`)
- Reads the current app user (`GET /api/app-users/me`)
- Creates/updates/deletes todos in your collection (`/app/collections/:slug/records`)
- Keeps everything client-only (no custom backend required)

## Cloudflare Pages setup

1. Build settings:
   - Build command: `npm run build`
   - Build output: `demo-app/dist`
   - Root directory: `demo-app`
2. Environment variables (set in the Pages project settings):
   - `VITE_REQRES_BASE_URL` (optional, defaults to `https://reqres.in`)
   - `VITE_REQRES_PROJECT_ID`
   - `VITE_REQRES_PUBLIC_KEY`
   - `VITE_REQRES_MANAGE_KEY`
   - `VITE_REQRES_COLLECTION_SLUG` (defaults to `todos`)

> Note: `VITE_` env vars are exposed to the browser. If you need to keep the manage key private, proxy `/api/app-users/verify` through a backend or Cloudflare Pages Function.

## Local dev

```bash
cd demo-app
npm install
npm run dev
```

## Collection schema

Create a collection in ReqRes (example schema):

```json
{
  "title": "string",
  "notes": "string",
  "completed": "boolean"
}
```

## Flow to demo

1. Enter an email and send a magic link.
2. Paste the token to mint an app-session.
3. Create, edit, complete, and delete todos. Each app user only sees their own items.

## Files to peek at

- `src/App.tsx` - auth + todo UI
- `src/api.ts` - ReqRes app-user and collection API client
- `src/config.ts` - env config helper
- `src/index.css` - styling
