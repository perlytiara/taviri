# Security policy

Taviri handles passwords, so security reports are welcome and taken seriously.

## Reporting a vulnerability

Please report privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability** (GitHub private vulnerability reporting). Do not open a public issue,
pull request or discussion for a security problem.

A useful report says which part is affected (browser extension, desktop app, Android app, server
stack, build scripts), the patch or file, how to reproduce it, and what an attacker gains.

This is a one-person project. What you can expect:

- an acknowledgement within 7 days;
- an assessment, and a fix or a mitigation plan, within 30 days for serious issues;
- public disclosure, coordinated with you, once a fix is available or 90 days after your report,
  whichever comes first. If an issue is being exploited, it may be disclosed sooner with a
  workaround;
- credit in the advisory and the changelog, if you want it. There is no bug bounty.

## Scope

In scope: everything this repository adds or changes.

- the patch series in `clients/patches/` and `android/patches/` (autofill of extra fields and
  saved entry steps, item icons, the separate identity of each app, the desktop browser bridge,
  the Android server handling);
- the server stack in `server/` (firewall, Caddy and container configuration, `vaultctl`,
  backups, restore, updates, the health page, the rebranding step);
- build, signing and test scripts.

Out of scope here, please report upstream instead:

- vulnerabilities in unmodified Bitwarden code: Bitwarden's program on HackerOne,
  <https://hackerone.com/bitwarden/>;
- vulnerabilities in Vaultwarden itself: see
  <https://github.com/dani-garcia/vaultwarden/blob/main/SECURITY.md>.

If you are unsure whether an issue comes from Taviri's changes or from upstream, report it here
and it will be forwarded upstream with your permission.

## Supported versions

Only the latest state of the `main` branch is supported. Each patch series applies to one pinned
upstream version (see `clients/UPSTREAM.txt` and `android/UPSTREAM.txt`); security fixes are made on the
current series and, when upstream ships a security release, the series is moved onto it.
No binary builds are published at this time.

## Safe harbour

Research done in good faith, on your own installations and test data, will not lead to any
complaint or legal action from this project. Please do not test against servers or accounts that
are not yours, do not access or keep other people's data, and avoid denial of service.
