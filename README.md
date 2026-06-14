# SOS POS — Auto Move

**Version:** 17.1 · **Site:** app.sospos.com.au

A floating button that moves **Repairing** tickets between Today and Storage with a single click. Hold the button to settle the entire board — moving all unfinished tickets into Storage in one batch.

---

## How It Works

| Action | Result |
|--------|--------|
| **Click** | Toggles all "Repairing" tickets between Today ↔ Storage |
| **Hold (700ms)** | Settle mode — moves every unfinished ticket off Today into Storage |

- **Click (toggle):** First click moves all Repairing tickets from Today to Storage and saves their positions. Next click moves them back.
- **Hold (settle):** Finds all tickets on Today that are not in a finished state and moves them all to Storage in a single batch operation. State is remembered across page reloads via `sessionStorage`.

---

## Finished Status List

Tickets in these statuses are **never moved** by the settle action:

`paid & collected` · `paid` · `collected` · `no fix - collected` · `warranty` · `enquiry` · `refunded` · `cancelled`

---

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome
2. Click **Raw** on the `.user.js` file in this repo
3. Tampermonkey will prompt to install — click **Install**
4. Open SOS POS — the floating button appears on the board (bottom-right)

---

## Notes

- Button state persists across page reloads within the same browser session (`sessionStorage`)
- Uses the SOS POS batch API — only moves tickets, never creates or deletes them

---

## Using Multiple Scripts

If you are using several of the THVjQ Tampermonkey scripts, check the **Issues** tab — a multi-script addon with live updates across all scripts is in progress.
