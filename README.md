# flight-planner

A VFR navigation log that works like a spreadsheet. Laid out like the school's paper navlog; you
type what you worked out yourself, and it does the E6B arithmetic. It never looks up POH data.

Open `index.html` (double-click works) or the GitHub Pages URL.

## What calculates

Blue cells are calculated. Type into one to override it (it turns yellow); clear it to go back.
An overridden Fuel Rem or Dist Rem carries forward to the following legs.

| Cell | From |
|---|---|
| WCA (−L +R), GS Est. | TC, TAS, wind dir (true, FROM) / vel |
| TH, MH, CH | TC + WCA, + Var (−E +W, `7W` or `7E` also work), + Dev (blank = 0) |
| ETE, ETA | Leg dist ÷ GS; Time Off, re-based on each ATA you enter |
| ATE, GS Act. | ATA minus the previous ATA (or Time Off); leg dist ÷ ATE |
| Fuel, Fuel Rem. | ATE (or ETE) × GPH; Total Fuel minus the running burn |
| Dist Rem. | Route total minus the running distance |
| CG | Moment ÷ weight (moments written ÷1000 are detected) |
| Log Time | Hobbs In − Hobbs Out |

Red means: over max weight, distance to clear 50′ longer than the runway, fuel below zero, or a
wind the aircraft can't correct for.

Keys: Enter / ↓ moves down a column, Shift+Enter / ↑ moves up, Ctrl+D fills the selected cell down
to the end of the route.

## ForeFlight routes

Import a `.fpl` (or `.gpx` / `.kml`) — button or drag onto the page. It fills checkpoints, Course
and TC (both true course), distance, and the planned altitude from the file into empty Altitude
cells; add variation yourself. ForeFlight's `.fpl` files are UTF-16; that is handled. Long routes continue onto extra pages automatically.

## Weather log (back of the sheet)

Typed like the paper Weather Log: briefing type, adverse conditions, synopsis, current and forecast
conditions, winds aloft, NOTAMs, personal minimums and the flight plan form. All manual; nothing
there is filled in for you. It prints as the last page.

## Saving

Everything autosaves in this browser. **Clear sheet** starts over. **Save navlog** downloads a `.json` you can open later.
Nothing is uploaded anywhere. Print gives one Letter-landscape sheet per page.

## Development

`node tests.js` (or open `test.html`) checks the math. No build step: plain HTML/CSS/JS, relative
paths, no ES modules, so it runs from `file://` and from a GitHub Pages sub-path alike.
