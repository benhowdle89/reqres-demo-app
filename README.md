# Operations Task Register (ReqRes working example)

This repository contains a working internal task register built on ReqRes. It demonstrates authentication, scoped data access, and create/update/delete flows using a real application model for teams who want an end-to-end example.

```bash
cd demo-app
npm install
npm run dev
```

## Environment setup

Create a free ReqRes project at https://app.reqres.in and add the public + management keys to `.env`.

```bash
cp .env.example .env
```

Required:
- `VITE_REQRES_PROJECT_ID`
- `VITE_REQRES_PUBLIC_KEY`
- `VITE_REQRES_MANAGE_KEY`

Optional:
- `VITE_REQRES_BASE_URL` (defaults to `https://reqres.in`)
- `VITE_REQRES_COLLECTION_SLUG` (defaults to `todos`)

## What this demonstrates

Each signed-in operator only sees their own records.
Session tokens scope requests automatically with no user IDs passed by the client.
The UI runs client-only while ReqRes enforces isolation and persistence.

## Follow the flow

| In the app | ReqRes concept |
| --- | --- |
| Request access | App user creation |
| Confirm identity | Session token |
| Create task | Collection record |
| Refresh list | Scoped query |

## Cloudflare Pages setup

1. Build settings:
   - Build command: `npm run build`
   - Build output: `demo-app/dist`
   - Root directory: `demo-app`
2. Environment variables (set in the Pages project settings):
   - `VITE_REQRES_PROJECT_ID`
   - `VITE_REQRES_PUBLIC_KEY`
   - `VITE_REQRES_MANAGE_KEY`
   - `VITE_REQRES_BASE_URL` (optional, defaults to `https://reqres.in`)
   - `VITE_REQRES_COLLECTION_SLUG` (defaults to `todos`)

> Note: `VITE_` env vars are exposed to the browser. If you need to keep the manage key private, proxy `/api/app-users/verify` through a backend or Cloudflare Pages Function.

## Collection schema

Create a collection in ReqRes (example schema):

```json
{
  "title": "string",
  "notes": "string",
  "completed": "boolean"
}
```

## Why this matters

This replaces the usual backend setup for auth and CRUD when you want to ship a functional app quickly. You can focus on UI and workflows while ReqRes handles sessions, isolation, and persistence.

## Files to peek at

- `src/App.tsx` - auth + todo UI
- `src/api.ts` - ReqRes app-user and collection API client
- `src/config.ts` - env config helper
- `src/index.css` - styling
