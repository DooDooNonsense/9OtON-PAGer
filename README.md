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

## Notes
- "Print results" downloads a PDF made on the server. It uses the PDF standard fonts, so emoji and non-Latin characters in item names print as "?".
- Guests only receive the item that is open and the items they have voted on. Results are only sent to guests while "Show results to guests" is on.

## Room menu and results display

- Hosts open the gear icon next to the room title for the codes, copy buttons, "Preview as guest", "Leave room" and Settings.
- **Results display link** (Settings): turn it on to get an address like `/display/<token>` for an OBS Browser Source (a fixed wide banner, 1920x500, on a solid background).
  Pick the mode first. **Blind** shows "Polls are open for ..." and keeps results hidden until you choose "Unblind results". **Transparent** shows votes live and says "closed" afterwards.
  Turning the link off disables the address; turning it on again makes a new one.
- The Add items box takes styled text. Pasting several lines or loading a .txt/.csv adds one item per line.
