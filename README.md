# Chatly

Chatly is a real-time chat app built with Node.js, Express, and Socket.IO. Google sign-in reuses the configured Supabase provider (or an optional direct Google Identity Services client), while email/password accounts use server-side bcrypt hashes and HttpOnly sessions.

## Live site

[Open Chatly](https://chatly-1zub.onrender.com)

## Features

- Google sign-in with server-verified identity and HttpOnly sessions
- Public chat rooms, private conversations, and member groups
- Live messages, presence, typing status, and unread counts
- Saved and pinned messages, search, and file sharing
- Conversation list with pinned, unread, and group filters; alphabetized contacts; and global search across accessible messages, people, files, and links
- Local Focus mode to pause notification sounds and alerts, with remembered appearance preferences
- Voice and video calls using WebRTC
- Multiplayer Tic Tac Toe, Snakes and Ladders, Ludo, Chess, and Snake Arena
- Optional Aura assistant using Gemini or OpenAI, with composer actions for chat summaries, translations, reply suggestions, message explanations, text improvements, chat search, and freeform questions. Slash commands (`/ai summarize`, `/ai translate [language]`, `/ai reply`, `/ai explain`, `/ai <question>`) and `@aura` questions remain supported.
- Responsive desktop and mobile navigation, light/dark/system appearance, and an installable app shell

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

3. Set the Supabase values copied from your existing project in `.env`. `SESSION_SECRET` can be set as described below.
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
| `SUPABASE_URL` | Yes for Google sign-in | Existing Supabase project URL; its Google provider handles the OAuth chooser and verifies sign-in. |
| `SUPABASE_ANON_KEY` | Yes for Google sign-in | Existing Supabase anon/publishable key. Never use a service-role key here. |
| `GOOGLE_CLIENT_ID` | No | Optional direct Google Identity Services client ID; if unset, Chatly uses the existing Supabase Google provider. |
| `SESSION_SECRET` | Recommended | Long random secret for signing HttpOnly cookies. If unset, Chatly creates one in `DATA_DIR`; keep that directory persistent. |
| `DATA_DIR` | No | Directory for persistent chat data. Defaults to `./data`. Set to the Render disk mount path when deploying with a disk. |
| `GEMINI_API_KEY` | No | Server-side key for the Aura study helper. |
| `GEMINI_MODEL` | No | Gemini model name; defaults to the value in `.env.example`. |
| `OPENAI_API_KEY` | No | Optional OpenAI fallback key for Aura. |
| `OPENAI_MODEL` | No | OpenAI model name; defaults to `gpt-4.1-mini`. |
| `PORT` | No | Listening port. Render supplies this automatically. |

AI keys stay on the server. Do not add Supabase service-role keys, Google OAuth client secrets, or AI API keys to `public/`, browser JavaScript, or `.env.example`.

## Configure sign-in

Chatly reuses the Supabase URL and anon key already in `.env`. The Google button signs in through the Google provider configured in Supabase; the backend verifies the returned Supabase access token and exchanges it for Chatly's HttpOnly session.

1. In Render Environment settings, carry over the existing `SUPABASE_URL` and `SUPABASE_ANON_KEY` values from your local configuration. Keep the anon key private from source control even though it is designed to be publishable.
2. In Supabase **Authentication → Providers → Google**, make sure Google is enabled and your existing Google OAuth client is configured. If creating a new client, add the Supabase callback URL shown there to Google's **Authorized redirect URIs**.
3. In Supabase **Authentication → URL Configuration**, allow both `http://localhost:3000` and `https://chatly-1zub.onrender.com` as redirect URLs.
4. Attach a persistent Render disk and set `DATA_DIR=/var/data`. Set `SESSION_SECRET` in Render to a long random value so signed cookies remain valid across restarts.
5. If you want direct Google Identity Services instead of Supabase, set `GOOGLE_CLIENT_ID` and add `http://localhost:3000` plus `https://chatly-1zub.onrender.com` as **Authorized JavaScript origins** in Google Cloud Console.

New email/password accounts are stored in `DATA_DIR/auth-users.json` with bcrypt hashes. Existing Supabase email/password accounts are checked with Supabase on their first sign-in and then receive a Chatly session. Cookies are Secure on HTTPS and SameSite=Lax. Requests stay same-origin, so permissive CORS is not needed. Remember me controls whether the cookie persists after the browser closes.

## Deploy to Render

Deploy Chatly as a [Render Web Service](https://render.com/docs/web-services) connected to the Git repository.

1. In Render, create **New â†’ Web Service** and connect the repository.
2. Use these settings:

   | Setting | Value |
   | --- | --- |
   | Runtime | Node |
   | Build command | `npm install` |
   | Start command | `npm start` |

3. In the service's [Environment settings](https://render.com/docs/configure-environment-variables), set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SESSION_SECRET`. Add `DATA_DIR=/var/data` when using a persistent disk. Add `GEMINI_API_KEY` or `OPENAI_API_KEY` only if you want Aura enabled. Do not upload `.env` to the repository.
4. Create the Render service and wait for its first deploy. Copy the service's `https://â€¦.onrender.com` URL.
5. Add `https://chatly-1zub.onrender.com` to Supabase **Authentication â†’ URL Configuration** as the Site URL and an allowed redirect URL. Add the Supabase callback URL to the Google OAuth client's authorized redirect URIs.

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
