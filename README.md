# Tier Poll

S-F tier polls with room codes. The host gets a 6-character code and guests join with a 4-character code.

## Run it on your computer
1. Install Node 18 or newer (nodejs.org).
2. In this folder run: `node server.js`
3. Open http://localhost:3000

## Put it online so anyone can join
Upload this folder to any host that runs Node (Render, Railway, Fly.io and similar).
- Start command: `node server.js`
- No install step and no dependencies.
- Rooms are saved to `data.json`. On hosts with a temporary disk, rooms are lost when the app restarts or redeploys. To keep them, attach a persistent disk and set the environment variable `DATA_FILE` to a path on it (for example `/data/rooms.json`).
- Rooms unused for 60 days are deleted.
