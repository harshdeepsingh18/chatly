# Chatly

Chatly is a real-time chat website built with Node.js, Express, and Socket.IO. Join with a username to chat with other people currently connected to the same server.

## Open the website

Start the app by following the setup steps below, then open [Chatly](http://localhost:3000) in your browser.

> This link opens the locally running app. To let other people visit your website over the internet, deploy the app and replace this link with your deployed URL.

## Features

- Real-time messages and join/leave notifications
- Saved chat history shared with users and restored after server restarts
- Online user list and typing indicators
- Emoji picker
- Google sign-in and account-specific saved messages
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

Signed-in users can save individual messages with the **Save** button. Bookmarks are private to each Google account and stored in `data/saved-messages.json`.

## Google sign-in

Create a **Web application** OAuth client in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), enable Google Identity Services for it, and add the app origin (for local development, `http://localhost:3000`) to **Authorized JavaScript origins**. Set the client ID before starting the server:

```powershell
$env:GOOGLE_CLIENT_ID = "your-client-id.apps.googleusercontent.com"
$env:SESSION_SECRET = "a-long-random-secret"
npm start
```

Google sign-in also acts as account creation for new Google users. The server verifies each Google credential and keeps the sign-in session for seven days. Use a long, private `SESSION_SECRET` in deployment and keep the `data` directory persistent.
