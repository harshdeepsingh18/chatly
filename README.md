# Chatly

Chatly is a real-time chat website built with Node.js, Express, and Socket.IO. Sign in with Google through Supabase to access the chat.

## Open the website

Start the app by following the setup steps below, then open [Chatly](http://localhost:3000) in your browser.

> This link opens the locally running app. To let other people visit your website over the internet, deploy the app and replace this link with your deployed URL.

## Features

- Real-time messages and join/leave notifications
- Saved chat history shared with users and restored after server restarts
- Online user list and typing indicators
- Emoji picker
- Google sign-in and sign-up through Supabase Auth
- Unique usernames reserved per account
- Account-specific saved messages
- Light and dark themes
- Responsive layout for mobile and desktop

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

## Saved messages

Chat messages are stored on the server in `data/messages.jsonl`. The file and folder are created automatically when the server starts. Messages are shared with everyone who joins and are kept across restarts. Back up this file if you want to preserve the chat history when moving the app to another server.

Signed-in users can save individual messages with the **Save** button. Bookmarks are private to each Supabase account and stored in `data/saved-messages.json`.

## Supabase Google sign-in and sign-up

1. Create a Supabase project and copy its **Project URL** and **anon/public key** from **Project Settings → API**.
2. In **Authentication → Providers → Google**, enable Google and enter the OAuth client ID and secret from a Google Cloud **Web application** credential. Add the callback URL shown by Supabase to the OAuth client's **Authorized redirect URIs**.
3. In Supabase **Authentication → URL Configuration**, set the Site URL to `http://localhost:3000` and add it to the allowed redirect URLs. Use your deployed site URL when deploying.
4. Copy `.env.example` to `.env`, replace the placeholders with your Supabase Project URL and anon/public key, and restart Chatly:

```powershell
Copy-Item .env.example .env
# Edit .env and enter your actual Supabase values
npm start
```

The **Continue with Google** button uses Supabase OAuth. First-time Google sign-ins create a Supabase user automatically; returning users sign in to the same account. After sign-in, choose a username. Names are unique regardless of capitalization and stay reserved to that account across restarts in `data/usernames.json`. The chat server verifies both the Supabase session and the account's username before accepting a Socket.IO connection. The same session authorizes private saved-message requests. Keep the `data` directory persistent. Never put a Supabase service-role key in the browser or in these environment variables; the anon/public key is intended for client use.
