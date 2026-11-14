# End-to-end results: Firefox

- Date: 2026-11-14T23:15:51.860Z
- Extension: Taviri 2026.10.2 (Manifest V2), installed as a temporary add-on
- Browser: Firefox/162.0 (headless temporary copy of Firefox Nightly, separate profile), via WebDriver BiDi
- Vault: local Vaultwarden, fake account and fake logins
- Result: **9 of 9 scenarios passed**

| Scenario | Result | Checks |
|---|---|---|
| Ordinary username + password form still fills | pass | ✓ fill accepted<br>✓ username<br>✓ password |
| Multi-field login: custom fields matched to labels (accents, select, checkbox, aria-labelledby, tie) | pass | ✓ "Numero allocataire" → label "Numéro allocataire *"<br>✓ password → Code confidentiel<br>✓ "Date de naissance" (hidden field) → placeholder<br>✓ "Pays" = france → option France<br>✓ "Se souvenir de moi" (boolean) → checkbox<br>✓ "Identifiant client" → aria-labelledby<br>✓ "Code" matches two boxes equally → neither filled |
| Multi-field login through the menu in the field (real mouse clicks) | pass | ✓ menu opened<br>✓ extra field filled<br>✓ password filled |
| Recipe: fiscal number, Continue, wait for the password box, password, Connexion (one page) | pass | ✓ fiscal number typed (field:Numéro fiscal)<br>✓ password typed after the box appeared |
| Recipe across page loads: identifier, shuffled image keypad (reshuffles after each press), TOTP | pass | ✓ identifier typed on page 1<br>✓ code entered on the shuffled keypad (page 2)<br>✓ TOTP code accepted (page 3) |
| Recipe on a game-like screen: shadow DOM, a field that only accepts typed keys, a pointer-only button | pass | ✓ pilot name typed inside the shadow root<br>✓ passcode typed key by key |
| Safety: a recipe whose click leads to another site types nothing there | pass | ✓ the click led to the other site<br>✓ nothing typed on the other site<br>✓ the other site received nothing |
| A recipe that is not valid JSON: a notice, nothing typed | pass | ✓ notice shown<br>✓ nothing typed |
| Taviri item icons: a taviri:icon field picks a pack icon, other items get their type's icon | pass | ✓ Home Wi-Fi (test): field taviri:icon = wifi<br>✓ Relay dev (test): field taviri:icon = relay (the app family's Relay icon)<br>✓ Server notes (test): a note without the field: the note icon<br>✓ App only (test): an app-only login: the phone icon<br>✓ Test card (test): a card: the card icon |
