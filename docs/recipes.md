# Extra fields and saved entry steps

Both live inside the Bitwarden login itself, as **custom fields** (in the item: *Custom fields → New custom field*). They sync with your vault and stay end-to-end encrypted like the rest of it. The Taviri browser extension, the Taviri Android app (extra fields only) and the author's connector for an AI agent (not public) read the same format.

## 1. Extra fields (multi-field logins)

Add one custom field per extra box the site asks for. Name it like the label on the site; the value is what goes in the box.

| Custom field name | Type | Value | Fills |
|---|---|---|---|
| `Numéro allocataire` | Text | `1234567` | the box labelled "Numéro allocataire" |
| `Date de naissance` | Hidden | `01/02/1990` | the box labelled or placeholdered "Date de naissance" |
| `Pays` | Text | `France` | a drop-down: the option whose text or value matches |
| `Se souvenir de moi` | Boolean | true | a checkbox with that label |

Matching compares the field name with the box's label, `aria-label`, placeholder, `name` and `id`, ignoring case and accents. An exact match wins over a partial one. If two boxes match equally well, neither is filled (better empty than wrong). Extra fields are matched **before** the username, so a labelled "Numéro fiscal" box is never mistaken for the username box. Fields not on the current page are reported, so on a two-page sign-in the second call fills the rest.

## 2. Saved entry steps (`grokbot:recipe`)

For sites the normal fill gets wrong (several pages, buttons to click, on-screen keypads, game-like screens), add a custom field named **`grokbot:recipe`** (type *Hidden* or *Text*) whose value is JSON:

```json
{"steps": [
  {"fill": "username", "into": "#identifiant"},
  {"click": "button[type=submit]"},
  {"wait": "#password"},
  {"fill": "password", "into": "#password"},
  {"fill": "field:Numéro fiscal", "into": "input[name=spi]"},
  {"keypad": "password", "keys": ".keypad button"},
  {"fill": "totp", "into": "#otp", "optional": true},
  {"press": "Enter"}
]}
```

When a login has this field, `bitwarden_fill_login` runs the steps in order instead of guessing (`use_steps: false` skips them).

### Steps

| Step | What it does |
|---|---|
| `{"fill": VALUE, "into": SELECTOR}` | Types VALUE into the field matched by the CSS selector. |
| `{"keypad": VALUE, "keys": SELECTOR}` | Clicks, for each character of VALUE, the on-screen key showing that character. A key's character is read from `data-value`, `data-key`, `data-digit`, `aria-label`, `title`, `value`, its text, or an `img alt` inside it; "Touche 5" counts as 5. Keys are looked up again before every character, so keypads that reshuffle after each press work. |
| `{"click": SELECTOR}` | Clicks the element (a real mouse click), then waits for the page to finish loading. |
| `{"wait": SELECTOR}` or `{"wait": 1500}` | Waits until the element is visible, or for that many milliseconds. |
| `{"press": "Enter"}` | Presses Enter, Tab, Escape or Space. |

### Values

`username`, `password`, `totp` (the current authenticator code), `field:<custom field name>`, or `text:<words>` for a fixed, non-secret text.

### Options on any step

- `"optional": true`: if the element never shows up, skip the step instead of stopping.
- `"timeout": 8000`: how long to wait for the element (ms, default 5000; 10000 for `wait`; at most 30000).
- `"delay": 300` (keypad only): pause between key presses (ms, default 150).

### Selectors

Plain CSS selectors. They also reach into open shadow DOM and same-origin frames. Easiest way to get them: open the sign-in page in the bot's browser and ask the bot to run **`bitwarden_page_fields`**. It lists every field and button with a ready-made selector and spots on-screen keypads.

### Safety rules (enforced)

- Before every `fill` or `keypad` step, the tab must still be on the site saved in the login (same rules as the normal fill). If a click led somewhere else, the steps stop and nothing is typed.
- Values never come back to the bot. Results only say which steps ran, e.g. `{"step": 2, "action": "keypad", "value": "password", "ok": true}`. A keypad failure never says which character was missing.
- At most 40 steps.

## Examples

**Two-page sign-in** (email page, then password page):

```json
{"steps": [
  {"fill": "username", "into": "#email"},
  {"click": "#next"},
  {"wait": "#password"},
  {"fill": "password", "into": "#password"},
  {"click": "#login"}
]}
```

**Bank with a shuffled digit keypad:**

```json
{"steps": [
  {"fill": "username", "into": "#identifiant"},
  {"keypad": "password", "keys": "#clavier button", "delay": 250},
  {"click": "#valider"}
]}
```

**Tax site with a fiscal number and a password:** either just add a custom field `Numéro fiscal` (no steps needed), or:

```json
{"steps": [
  {"fill": "field:Numéro fiscal", "into": "#spi_tmp"},
  {"click": "#btnAction"},
  {"wait": "#pwd_tmp"},
  {"fill": "password", "into": "#pwd_tmp"},
  {"click": "#btnAction"}
]}
```
