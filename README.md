# Chatly

Chatly is a real-time chat website built with Node.js, Express, and Socket.IO. Sign in with Google through Supabase to access the chat.

## Open the website

Start the app by following the setup steps below, then open [Chatly](http://localhost:3000) in your browser.

> This link opens the locally running app. To let other people visit your website over the internet, deploy the app and replace this link with your deployed URL.

## Features

- Real-time messages and join/leave notifications
- Profile photos and online indicators
- Saved chat history shared with users and restored after server restarts
- Online user list and typing indicators
- Separate `#general`, `#doubts`, and `#notes` rooms
- Private one-to-one chats from the online list
- Voice and video calls in direct chats
- Games hub with multiplayer Tic Tac Toe, Snakes and Ladders, Ludo, Chess, and Snake Arena
- Image and document sharing
- Search and pinned messages per conversation
- `@aura` study helper powered by Gemini's free tier (OpenAI optional)
- Message sounds and unread counts in the browser tab title
- Emoji picker
- Google sign-in and sign-up through Supabase Auth
- Unique usernames reserved per account
- Account-specific saved messages
- Light and dark themes
- Responsive layout for mobile and desktop
- Installable phone app with an offline-cached app shell

## Setup

1. Install [Node.js](https://nodejs.org/).
2. In a terminal, go to the project folder and install dependencies:

   ```bash
   npm install
   ```

3. Start the server:

   ```bash
   npm start
   ```

4. Open [http://localhost:3000](http://localhost:3000).

The server uses port `3000` by default. Set the `PORT` environment variable to use a different port.

## Install Chatly on a phone

Open the site in your phone's browser and use its **Install app** or **Add to Home Screen** option. The app opens in a standalone window with the Chatly icon. Installation requires HTTPS on a deployed site; `localhost` works for local development. The app shell is cached for faster loading, while sign-in and live chat need an internet connection.

## Saved messages

Chat messages are stored on the server in `data/messages.jsonl`. The file and folder are created automatically when the server starts. Messages are shared with everyone who joins and are kept across restarts. Back up this file if you want to preserve the chat history when moving the app to another server.

Signed-in users can save individual messages with the **Save** button. Bookmarks are private to each Supabase account and stored in `data/saved-messages.json`.

## Supabase Google sign-in and sign-up

1. Create a Supabase project and copy its **Project URL** and **anon/public key** from **Project Settings → API**.
2. In **Authentication → Providers → Google**, enable Google and enter the OAuth client ID and secret from a Google Cloud **Web application** credential. Add the callback URL shown by Supabase to the OAuth client's **Authorized redirect URIs**.
3. In Supabase **Authentication → URL Configuration**, set the Site URL to `http://localhost:3000` and add it to the allowed redirect URLs. Use your deployed site URL when deploying.
4. Copy `.env.example` to `.env`, enter the Supabase Project URL and anon/public key, and restart Chatly:

```powershell
Copy-Item .env.example .env
# Edit .env and enter your actual Supabase values
npm start
```

The **Continue with Google** button uses Supabase OAuth. First-time Google sign-ins create a Supabase user automatically; returning users sign in to the same account. Choose a unique username after the first sign-in; it stays reserved to that account across restarts in `data/usernames.json`, and returning users go straight to chat. Open **Profile** in the app to view the Google account email, change the username, or sign out. The chat server verifies both the Supabase session and the account's username before accepting a Socket.IO connection. The same session authorizes private saved-message requests. Keep the `data` directory persistent.

## Rooms, direct messages, and files

Chat history is separated into `#general`, `#doubts`, and `#notes`. Create member groups from the sidebar, invite registered Chatly members, and add more members later from the group details panel. Group membership and messages persist in `data/groups.json` and `data/messages.jsonl`. Click an online username to open a private one-to-one conversation. Upload images, PDFs, text files, and DOCX notes up to 12 MB; shared photos and files appear in the conversation details panel. Uploads, message history, saved messages, groups, and pins are stored in `data/`; keep this folder persistent and backed up.

Use the search field to filter the open conversation. Pin messages to keep them at the top of that conversation. Delete messages with the three-dot menu; the chat shows who deleted them, and deleting a message with an attachment also deletes its uploaded file. Message sounds play for new messages, and unread messages update the browser tab title.

## Voice and video calls

Open a direct chat and choose **Call** or **Video**. Both people need to allow microphone access; video calls also need camera access. Browsers require HTTPS for camera and microphone access, with `localhost` allowed for development. Calls use peer-to-peer WebRTC with STUN; some restrictive networks may also require a TURN relay server.

## Games

Open **Games** from the sidebar, then choose an online friend or open a direct chat. Pick a game to send an invitation; multiplayer games are played in real time.

## Aura study helper

For free-tier Aura, create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey) and add it to the server's `.env` file:

```env
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3.5-flash-lite
```

Restart Chatly, then type `@aura explain photosynthesis` in a room or direct conversation. Chatly uses Gemini when `GEMINI_API_KEY` is set; OpenAI remains an optional fallback if no Gemini key is configured. Keys stay on the server and are not sent to browsers. Google offers free use with limited models and quotas in available regions; free-tier prompts may be used to improve Google's products, so don't send sensitive information. See [Gemini API pricing and free-tier details](https://ai.google.dev/gemini-api/docs/pricing).
