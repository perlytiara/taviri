# End-to-end results

- Date: 2026-11-14T23:03:23.319Z
- Extension: Taviri 2026.10.2 (Manifest V3), loaded unpacked
- Browser: Chrome for Testing (headless), separate profile
- Vault: local Vaultwarden, fake account and fake logins
- Result: **12 of 12 scenarios passed**

| Scenario | Result | Checks |
|---|---|---|
| Ordinary username + password form still fills (regular Bitwarden fill) | pass | ✓ username<br>✓ password<br>✓ no notice |
| Multi-field login: custom fields matched to labels (accents, select, checkbox, aria-labelledby, tie) | pass | ✓ "Numero allocataire" → label "Numéro allocataire *"<br>✓ password → Code confidentiel<br>✓ "Date de naissance" (hidden field) → placeholder<br>✓ "Pays" = france → option France<br>✓ "Se souvenir de moi" (boolean) → checkbox<br>✓ "Identifiant client" → aria-labelledby<br>✓ "Code" matches two boxes equally → neither filled |
| Multi-field login through the inline menu (click the login in the dropdown) | pass | ✓ inline menu opened<br>✓ extra field filled<br>✓ password filled<br>✓ aria-labelledby field filled |
| Recipe: fiscal number, Continue, wait for the password box, password, Connexion (one page) | pass | ✓ fiscal number typed (field:Numéro fiscal)<br>✓ password typed after the box appeared<br>✓ no notice |
| Recipe across page loads: identifier, shuffled image keypad (reshuffles after each press), TOTP | pass | ✓ identifier typed on page 1<br>✓ code entered on the shuffled keypad (page 2)<br>✓ TOTP code accepted (page 3)<br>✓ signed in |
| Recipe on a game-like screen: shadow DOM, a field that only accepts typed keys, a pointer-only button | pass | ✓ pilot name typed inside the shadow root<br>✓ passcode typed key by key |
| Recipe started like the popup's Fill button, running inside an iframe on the login's site | pass | ✓ the sign-in frame loaded<br>✓ the fill was accepted<br>✓ the steps ran inside the frame |
| Safety: a recipe whose click leads to another site types nothing there | pass | ✓ the click led to the other site<br>✓ nothing typed on the other site<br>✓ the other site received nothing |
| Recipe: fill, skip an optional step, press Enter to submit the form | pass | ✓ form submitted by Enter<br>✓ username sent<br>✓ password sent |
| A page-load fill request fills an ordinary login but never runs a recipe | pass | ✓ the ordinary login is filled by a page-load request<br>✓ a page-load fill does pick that login<br>✓ the login with a recipe is left alone<br>✓ its steps did not run<br>✓ no notice |
| A recipe that is not valid JSON: a notice, nothing typed | pass | ✓ notice shown<br>✓ nothing typed<br>✓ the notice goes by the build's name (Taviri)<br>✓ the notice names the login's recipe field |
| Taviri item icons: a taviri:icon field picks a pack icon, other items get their type's icon | pass | ✓ Home Wi-Fi (test): field taviri:icon = wifi<br>✓ Recovery codes (test): field taviri:icon = codes<br>✓ Relay dev (test): field taviri:icon = relay (the app family's Relay icon)<br>✓ Server notes (test): a note without the field: the note icon<br>✓ App only (test): an app-only login: the phone icon<br>✓ No website (test): a login without a website: the account icon<br>✓ Test card (test): a card: the card icon<br>✓ Test identity (test): an identity: the identity icon<br>✓ a login with a website still asks the vault's icon service for the site's icon<br>✓ …and shows it, or the globe tile while it loads or when the site has none |
