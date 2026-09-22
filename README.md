# Hand & Foot

Online Hand and Foot (solo scoring, no partnerships) for a small group of friends.
Everyone opens one web address, types a name and a four-letter table code, and plays.
No accounts, no downloads, no app.

---

## Your house rules, as coded

| Rule | Setting |
|---|---|
| Decks | players + 2 (so 5 decks for 3 players) |
| Deal | 11 to the hand, 11 to the foot |
| Draw piles | the stock is split into **4 piles** |
| Drawing two | one card from each of **two different piles** |
| Taking the discard pile | 2 naturals in hand matching the top card; you take that card **plus the 6 behind it** |
| Going down | **At least** 50 / 90 / 120 / 150 across four rounds, totalled over every meld you lay in that turn |
| Book | 7 cards. **Red book** = all naturals (500). **Black book** = contains wilds (300) |
| Wilds in a book | up to 3 — naturals must outnumber wilds |
| Threes | never meld. Black three on top freezes the pile. Red three lays off at −100 |
| Going out | in your foot, 1 red book + 1 black book, discard your last card. +100 |

Everything above lives in one place: `engine.js`, in the `DEFAULTS` object.
Change a number there and the whole game follows — the server, the interface, and the tests.

### Two rules I had to decide myself

1. **When only one draw pile has cards left**, the two-different-piles rule relaxes and both
   cards come from the last pile. Otherwise the final turns of a round would have no legal draw.
2. **Red threes** are worth −100 each and lay off automatically when drawn.

If your table plays either differently, change `distinctDrawPiles` / `redThreeValue` in
`engine.js`, or ask and I'll change it.

---

## Running it on your own computer first

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

Open <http://localhost:3000>. To try it with a second "player", open a private/incognito
window to the same address — each browser profile is a separate seat.

Run the tests any time with:

```bash
npm test
```

That runs 52 rules tests (including 1,200 randomly played complete games) and 28 server
tests that play a full game over real websockets.

---

## Putting it online so your friends can join

Any host that runs Node and supports websockets will do. Render's free tier is the
least fiddly, so here it is step by step.

### Render (free)

1. Put these files in a **GitHub** repository — no command line needed.
   - Sign up at <https://github.com> if you don't have an account.
   - Go to <https://github.com/new>, name it `handfoot`, and click **Create repository**.
   - On the next page click **uploading an existing file**.
   - Select every file in this folder at once and drop them in. Do **not** include
     `node_modules` if you see it.
   - Click **Commit changes**.
2. Go to <https://dashboard.render.com> and sign up (GitHub login is easiest).
3. **New → Web Service**, connect the repo.
4. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
5. Create. In a couple of minutes you get an address like
   `https://handfoot-xyz.onrender.com`. That is the link you send everyone.

**The one catch with the free tier:** the service goes to sleep after about 15 minutes with
nobody on it, and the first person to open it waits roughly 50 seconds while it wakes up.
Once it is awake it stays fast for the whole game night. Open the link yourself a minute
before everyone else and nobody else will notice. Render's cheapest paid tier removes the
sleeping if it ever becomes annoying.

### Fly.io (free allowance, no sleeping)

```bash
# install flyctl from https://fly.io/docs/flyctl/install/
fly launch --now        # accept the Dockerfile it finds
```

Fly reads the included `Dockerfile`. You get a `.fly.dev` address. Fly does not sleep
services the way Render's free tier does.

### Any VPS you already have

```bash
npm install
PORT=8080 node server.js
```

Put it behind nginx or Caddy with websocket upgrade forwarding. Use `pm2` or a systemd
unit to keep it running.

---

## How a game goes

1. One person clicks **Create table**, picks the number of seats, and gets a four-letter code.
2. Everyone else opens the same address, types the code and their name, and clicks **Sit down**.
   The **Copy invite** button gives a link with the code already in it.
3. When everyone is in, anyone clicks **Deal the first round**. Seats nobody took are dropped.
4. On your turn: click **two different draw piles** and press Draw, or select two matching
   naturals and press **Take pile**. Then select cards to meld, click one of your books to
   add to it, and finish by selecting one card and pressing Discard.
5. Illegal plays are refused with the reason, so nobody has to remember the rule.

**Practice table** deals three seats on your own device, one at a time, so you can check the
rules match your group's before anyone else is involved.

---

## Things worth knowing

- **Your cards are actually private.** The server holds the game and sends each player only
  their own hand; everyone else is a card count. Opening dev tools shows you nothing about
  anyone else's cards, because your browser was never sent them.
- **Refreshing is safe.** Your browser remembers who you are, and you drop back into your
  seat with your hand intact. Closing the tab and coming back later works too.
- **A dropped connection reconnects itself** and the table shows who is currently offline.
- **Tables survive a restart.** Games are written to `tables.json` and reloaded on boot, so a
  redeploy or a host restart mid-game doesn't lose the night. Tables are forgotten after 12
  quiet hours.
- **No database, no accounts, nothing to maintain.**

## Layout

Every file sits in this one folder, so there is nothing to arrange.

```
server.js         the server: rooms, seats, and keeping hands private
engine.js         cards, values, meld legality, your house-rule settings
game.js           turn logic: draw, meld, discard, foot, going out, scoring
index.html        the page
app.js            the interface
style.css         the look
rules.test.js     52 rules tests
server.test.js    28 end-to-end tests over real websockets
package.json      what to install and how to start
Dockerfile        only needed for Fly.io
```

Browsers can only ever fetch `index.html`, `app.js`, `style.css` and a display-only slice of
`engine.js`. `game.js` and `server.js` are never sent to anyone — that is what keeps the
cards honest.

`engine.js` and `game.js` have no dependencies and know nothing about the web, so the rules
are testable and portable on their own.
