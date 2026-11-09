# Chatly

Chatly is a real-time chat app built with Node.js, Express, and Socket.IO. It uses Supabase Auth for Google sign-in and supports private chats, groups, file sharing, voice/video calls, games, and an optional AI study helper.

## Live site

[Open Chatly](https://chatly-1zub.onrender.com)

## Features

- Google sign-in through Supabase Auth
- Public chat rooms, private conversations, and member groups
- Live messages, presence, typing status, and unread counts
- Saved and pinned messages, search, and file sharing
- Voice and video calls using WebRTC
- Multiplayer Tic Tac Toe, Snakes and Ladders, Ludo, Chess, and Snake Arena
- Optional `@aura` study helper using Gemini or OpenAI
- Responsive layout and an installable app shell

## Run locally

Requirements: Node.js 18 or newer and npm.

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a local environment file:

   ```sh
   cp .env.example .env
   ```

   On Windows PowerShell, use `Copy-Item .env.example .env` instead.

3. Set the required Supabase values in `.env` as described below.
4. Start Chatly:

   ```sh
   npm start
   ```

5. Open <http://localhost:3000>.

The server uses `PORT` when provided by the host, otherwise it listens on port `3000`.

## Environment variables

Set these values in your local `.env` file or in your hosting provider's environment settings. Never put private API keys in frontend code or commit a real `.env` file.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project URL. |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon/publishable key for Auth. This key is intentionally delivered to the browser; enable appropriate Supabase security policies and never use a service-role key here. |
| `DATA_DIR` | No | Directory for persistent chat data. Defaults to `./data`. Set to the Render disk mount path when deploying with a disk. |
| `GEMINI_API_KEY` | No | Server-side key for the Aura study helper. |
| `GEMINI_MODEL` | No | Gemini model name; defaults to the value in `.env.example`. |
| `OPENAI_API_KEY` | No | Optional OpenAI fallback key for Aura. |
| `OPENAI_MODEL` | No | OpenAI model name; defaults to `gpt-4.1-mini`. |
| `PORT` | No | Listening port. Render supplies this automatically. |

AI keys stay on the server. Do not add Supabase service-role keys, Google OAuth client secrets, or AI API keys to `public/`, browser JavaScript, or `.env.example`.

## Configure Google sign-in

1. Create a Supabase project and copy its Project URL and anon/publishable key from **Project Settings → API**.
2. Add those values to `.env` locally, or configure them as Render environment variables.
3. In Supabase, enable Google under **Authentication → Providers → Google**. Create a Google OAuth web client and add the callback URL supplied by Supabase to the OAuth client's authorized redirect URIs.
4. In Supabase **Authentication → URL Configuration**, set the Site URL to your local URL (`http://localhost:3000`) or deployed Render URL. Add both the local URL and deployed URL to the allowed redirect URLs as needed.

The Supabase OAuth callback and the Google OAuth authorized redirect URI are different URLs: copy the callback URL shown by Supabase into Google Cloud; configure Chatly's site URL in Supabase.

## Deploy to Render

Deploy Chatly as a [Render Web Service](https://render.com/docs/web-services) connected to the Git repository.

1. In Render, create **New → Web Service** and connect the repository.
2. Use these settings:

   | Setting | Value |
   | --- | --- |
   | Runtime | Node |
   | Build command | `npm install` |
   | Start command | `npm start` |

3. In the service's [Environment settings](https://render.com/docs/configure-environment-variables), add `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Add `GEMINI_API_KEY` or `OPENAI_API_KEY` only if you want Aura enabled. Do not upload `.env` to the repository.
4. Create the Render service and wait for its first deploy. Copy the service's `https://….onrender.com` URL.
5. Add `https://chatly-1zub.onrender.com` to Supabase **Authentication → URL Configuration** as the Site URL and an allowed redirect URL. Add the Supabase callback URL to the Google OAuth client's authorized redirect URIs.

### Keep chat data between deploys

Chat history, saved messages, groups, game state, and uploads are written to the local data directory. Render's default filesystem is ephemeral, so these files can disappear after a restart or deploy unless you attach persistent storage.

To keep them, [attach a persistent disk](https://render.com/docs/disks) to the Web Service in Render, set its mount path to `/var/data`, and add this environment variable:

```text
DATA_DIR=/var/data
```

Render's filesystem is ephemeral by default, and persistent disks are available on supported service plans. Without a disk or external database/storage, don't rely on local files being retained. Back up important user data. See Render's [deployment documentation](https://render.com/docs/deploys) for filesystem and deploy behavior.

## Data stored by Chatly

The data directory contains message history, usernames, saved messages, groups, pins, reactions, game state, upload metadata, and uploaded files. Locally, it is `./data/` by default. In production, point `DATA_DIR` at persistent storage.

## Voice and video calls

Calls use peer-to-peer WebRTC with STUN. Browsers require HTTPS for microphone and camera access; Render provides HTTPS. Some restrictive networks may require a TURN relay, which this app does not configure by default.

## Install on a phone

Open the deployed HTTPS site in a mobile browser and choose **Install app** or **Add to Home Screen**. The app shell can be cached for faster loading; sign-in and real-time chat still need an internet connection.

## Security and release checklist

- Keep `.env` local. It is ignored by Git; `.env.example` contains placeholders only.
- Add secrets in Render's Environment settings, not in source files or commit history.
- If a private key was committed or shared, revoke/rotate it in its provider dashboard and update the Render environment value.
- Keep the Supabase service-role key private. Chatly only needs the anon/publishable key in the browser.
- Configure Supabase and Google OAuth redirect URLs for the deployed HTTPS origin.
- Attach persistent storage or choose an external data store before relying on production messages or uploads.
- Review Supabase Auth and database security settings before opening the app to the public.

## License

No license is specified yet. Add a `LICENSE` file before granting others permission to reuse or redistribute this project.
