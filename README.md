# Impollster

Guests vote on which tier each item belongs in. You present the results on a stage screen (ideal for streaming), run live trivia, and keep score. No dependencies; Node 18+.

## Run it
1. In this folder run `node server.js`
2. Open http://localhost:3000

To put it online, upload the folder to any Node host (start command `node server.js`). Rooms are saved to `data.json`; on hosts with a temporary disk set `DATA_FILE` to a path on a persistent disk. Rooms unused for 60 days are deleted.

## Two screens
**Landing** (`/`): one card titled Impollster with two buttons, **Host** and **Join**. Host asks for an optional room name (**Start a New Room** / **Back**; a **Returning?** link reopens a room by host code). Join asks for the 4-letter room code.

**Host** (`/host#CODE`) is the presentation *and* the settings. Capture this window for your stream.
- **Stage:** tiers fill the screen; the next item waits in a card on the left with **Start Poll**. Dots arc around a tile: grey = trivia unanswered, green/red = your right/wrong answer, yellow = text bubble. A thin yellow stroke marks a tile you moved off the room's plurality tier; a green stroke marks an item placed by a tie break.
- **Poll flow:** Start Poll > Close Poll (or the optional poll timer) > Reveal Results? > the item lands on the board. Guests see the line "With N votes, the room placed it in:" with an animated ellipsis, then the tile pops in time with the host's banner.
- **Motion:** nothing just appears. Elements fade and slide up while their neighbours glide to make room; popups fade in and out over a smoothly dimmed backdrop; turning on Reduce Motion in the device replaces the sliding with a plain fade. An unlocked tile (double-click) gets a glowing ring and a gentle pulse until it's dropped or locked again.
- **Tie breaking:** when the top tiers tie, the item shows a gray **Tie** tile and a **Break the Tie!** button named for the chosen method (Continue stays hidden until it is broken): **Average** (mean of the tied tiers; .5 rounds to the higher rank, S+A gives A), **High Card** (highest tier), **Underdog** (lowest tier), **Showdown** (fastest correct answer to a tie-break question; the winner's own vote decides; non-voters may play but do not count) or **Slots** (slot machine on every screen). Showdown questions come from a pool you write in Advanced (max 15). The leaderboard shows a yellow "(+n)" for Showdown wins. **The pool is shared by the whole room: a question is spent the moment it is asked in any showdown.** When none are left, Showdown quietly switches itself off and the tie offers your backup method (Slots or Average) instead; if you never added questions it just uses Average. When the last question ends with nobody right, a short message ("No one got it! And there are no tie-breakers left! ...") appears on every screen before the backup runs. Editing a spent question after polling has started asks whether to put it back in the pool. For Average, High Card and Underdog a soft glow hops between the tied rows and settles on the winner, whose row keeps it (bars and numbers never change); Slots (a single curved reel of the tied tiers' tiles) and Showdown play alone with no glow until the winner is placed. The note under the placement is one line ("Tie broken by Slots"), or two for Showdown ("Tie broken by Showdown:" / "Pat, 1.03 seconds"). The Tie chip's tooltip is two lines: "Tied between S, B." then "Tie broken by Slots" (or "Showdown: Pat, 1.03 seconds").
- **Stage menus** share one look: light teal bar with the item name, a yellow **Stats** square and a red **X** at the right, a left-arrow **Back** square at the left, pill buttons in the body. Stats opens Poll/Trivia panes (**More…** slides in who voted what). An item with nothing to show gets a gray Stats square ("No Data Yet"). The gear menu is unchanged.
- **Trivia prompt:** after an item with trivia is ranked, **Answer trivia question?** with **Yes** / **Not Now** stretched across the menu. Right-click a tile (long-press on touch) to bring it back.
- **Drag a tile** to override its placement (double-click to unlock first).
- **Gear menu** (opens by itself in an empty room): **Customize** (room name, Description, tiers), **Items** (Enter or commas add items; click the Trivia/Text bubble chips to edit), **Room** (Share with Guests, Host, Players), **Advanced** (Polling card: host votes, poll timer (30 s when enabled), hide next item, randomize, Tie Breaking; Trivia card: seconds per question (30), Play Along, Host Score/Stats, tie-break question pool), **Save/Open**.

**Saving with gaps:** if a trivia question or text bubble is missing something, Save asks "You have not entered ... Continue?" (Continue / Go Back). Continuing saves it and the chip reads e.g. "Trivia · 1 Question (1 Incomplete)". The tie-break pool works the same way.

**Guest** (`/play#CODE`): name, vote, trivia with **Lock in**. Cards anchor content at the top. Text bubbles always appear with the results (under the placement, last). Between items the lobby shows **Polls open soon for…** and **Latest results**. **My History** has two views. *My Board* shows your own votes in tier rows, with trivia capsules and "i" marks, plus a "Didn't Vote" row for missed items; tap a trivia chip for a review of the questions you saw. *Final Board* shows the room's placements; tap a chip for the poll results, where Tie and Override chips explain themselves on hover or tap. The description box has a bar to minimize it (remembered on that device). Guest popups share the teal bar with a red X, and tapping outside closes them. Scores show in green; Showdown bonuses show "(+n)".

## Trivia
Right-click a tile > Answer trivia question? > 3-2-1 > timer > guests select an answer and press Lock in (a selected answer counts if time runs out) > the card shows a pie countdown, then the question, answer pills and a timer bar; guests press Lock In Answer > host sees "Everyone's locked in" > Reveal Answer? > the Lock In button stays, pressed, reading "Locked In" > Reveal Answer? > Worldle-style reveal: the correct answer turns green; if you were wrong or didn't answer, your pick turns red and the correct answer also gets a red outline > **More…** (host only; reveals the follow-up to guests with a fade) > Next Question

## Joining during trivia
- When you press Yes, the countdown waits (**Holding for Joining Players**, with a small **Proceed** link) while anyone is still on the name screen.
- Once the countdown starts, anyone who arrives or reconnects (including after a page refresh) lands on a hold screen: "There is a timed question currently happening…" with the live seconds left, **Proceed?** and **I'll Wait**. Proceed joins the question; if time runs out they are marked wrong. I'll Wait (or the timer ending first) shows "Waiting to join room…" with the description, and they join when the host moves to the next question or back to the board. They never see the reveal.
- The timer ends by itself once everyone who can answer has locked in (the host too, when Play Along is on). You still press Reveal Answer.

## Notes
- All buttons share one flat pill style (solid color, darker bottom edge, sinks when pressed). The poll-results Continue button sits bottom-right.
- Resetting an item and re-polling it shows the full Reveal Results flow again.
- Starting an item's poll again (or resetting it) clears its votes and trivia answers.
- Name filter blocks cursing, slurs and hate speech and may occasionally block innocent names.
- "Print results" PDFs use standard fonts, so emoji and non-Latin characters print as "?".

## Round 8 notes
- **Names:** a name is unique per room, compared ignoring capitalization, spaces, punctuation and accents ("pat", "P a t" and "P.a-t" all clash). The host's name counts as taken, guests who left stay reserved (removing a player frees the name), a returning guest on the same device keeps their own name, and renaming (guest or host) goes through the same check. Rejection message: "That name is already taken. Please try another." (the old automatic "alex2" numbering is gone).
- **Long names** show an ellipsis and open in place on hover (tap on touch); the HOST badge stays 10px away and vertically centred.
- **Item tiles** scale their text with the circle (re-fit on resize), share a size cap so short names don't balloon, wrap before shrinking and only break mid-word as a last resort.
- **Dragging an item (Override):** after double-clicking a tile to unlock it, the floating copy follows the cursor exactly (no lag), fades in as it lifts, and on release glides into its new spot (or back home if dropped on nothing or in the same place).
- **Phone layouts:** the host board no longer collapses on narrow screens, the settings menu tabs stay on one scrolling row, settings rows wrap instead of squeezing, the big item name never breaks mid-word, and bad or oversized requests get a clean 400/413 instead of a server error.
- **Item names in circles never clip:** on the board, the guest tile and the host question circle, a name stays on one line and scales down to fit. Only when one line would make it much smaller does it break at the spaces (balanced, never mid-word) if that keeps it clearly larger. One very long name only shrinks itself. The full name is in the tile tooltip.
- **The two big circles match:** the guest's tile and the host's big circle share the same drop shadow, weight, colour, padding and text-to-circle ratio, so a name looks the same on both screens.
