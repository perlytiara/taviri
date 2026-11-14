// Where the tests find things. Everything throwaway (fake account, the CLI's data, the browser
// profile) lives in the test Vaultwarden's folder, which stays out of any cloud sync.
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The bitwarden/clients checkout (branch smartfill); its node_modules provide Playwright. */
export const CLIENTS_DIR =
  process.env.SMARTFILL_CLIENTS_DIR || path.join(here, "..", "..", "upstream");
/** The unpacked extension under test. */
export const EXTENSION_DIR =
  process.env.SMARTFILL_EXTENSION_DIR || path.join(here, "..", "build", "chrome-mv3");
/** The throwaway Vaultwarden build (binary, TLS certificate, data). */
export const VAULT_DIR =
  process.env.SMARTFILL_VW_DIR || path.join(os.homedir(), "vaultwarden-test");
/** Fake account, Bitwarden CLI data and the test browser profile. */
export const STATE_DIR = path.join(VAULT_DIR, "smartfill-state");
export const ACCOUNT_FILE = path.join(STATE_DIR, "test-account.json");
export const BW_CLI_DATA_DIR = path.join(STATE_DIR, "bwcli");
export const PROFILE_DIR = path.join(STATE_DIR, "profile");
