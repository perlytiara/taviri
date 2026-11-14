#!/usr/bin/env python3
"""A tiny vault client for test instances: proves that data really round-trips.

FOR THROW-AWAY TEST VAULTS ONLY (the rehearsal VM). It registers a test account, stores
one item, and later logs in again and decrypts that item, which is the real proof that a
restored backup is usable. Never point it at the real vault or give it a real password.

    e2e_client.py register --url https://localhost:8443 --creds FILE [--cacert root.crt]
    e2e_client.py add      --url ... --creds FILE --name "second item"
    e2e_client.py verify   --url ... --creds FILE --expect "first item" [--absent "second item"]

FILE holds two lines: email=... and password=...   (test values only)
Uses only the Python standard library plus the `openssl` command.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

ITERATIONS = 600000
DEVICE = str(uuid.uuid5(uuid.NAMESPACE_DNS, os.environ.get("E2E_DEVICE", "pi-vault-e2e-test")))


def b64(data):
    return base64.b64encode(data).decode()


def openssl(args, data):
    return subprocess.run(["openssl"] + args, input=data, capture_output=True, check=True).stdout


def aes(data, key, iv, decrypt=False):
    return openssl(["enc", "-aes-256-cbc", "-d" if decrypt else "-e", "-K", key.hex(), "-iv", iv.hex()], data)


def seal(plain, enc_key, mac_key):
    """Bitwarden 'type 2' encrypted string: AES-256-CBC + HMAC-SHA256."""
    iv = os.urandom(16)
    cipher = aes(plain, enc_key, iv)
    mac = hmac.new(mac_key, iv + cipher, hashlib.sha256).digest()
    return f"2.{b64(iv)}|{b64(cipher)}|{b64(mac)}"


def unseal(text, enc_key, mac_key):
    kind, rest = text.split(".", 1)
    if kind != "2":
        raise SystemExit(f"unexpected encryption type {kind}")
    iv, cipher, mac = (base64.b64decode(part) for part in rest.split("|"))
    if not hmac.compare_digest(mac, hmac.new(mac_key, iv + cipher, hashlib.sha256).digest()):
        raise SystemExit("decryption failed: wrong key or damaged data")
    return aes(cipher, enc_key, iv, decrypt=True)


def master_keys(email, password):
    master = hashlib.pbkdf2_hmac("sha256", password.encode(), email.lower().encode(), ITERATIONS, 32)
    login_hash = b64(hashlib.pbkdf2_hmac("sha256", master, password.encode(), 1, 32))
    enc = hmac.new(master, b"enc\x01", hashlib.sha256).digest()
    mac = hmac.new(master, b"mac\x01", hashlib.sha256).digest()
    return login_hash, enc, mac


class Client:
    def __init__(self, url, cacert, insecure):
        self.url = url.rstrip("/")
        if insecure:
            self.tls = ssl._create_unverified_context()
        else:
            self.tls = ssl.create_default_context(cafile=cacert)
        self.token = None

    def call(self, method, path, body=None, form=None):
        headers = {"Accept": "application/json", "Bitwarden-Client-Name": "web", "Bitwarden-Client-Version": "2026.10.1"}
        data = None
        if form is not None:
            data = urllib.parse.urlencode(form).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        elif body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        request = urllib.request.Request(self.url + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, context=self.tls, timeout=30) as reply:
                text = reply.read().decode()
        except urllib.error.HTTPError as error:
            raise SystemExit(f"{method} {path} -> {error.code}: {error.read().decode()[:300]}")
        return json.loads(text) if text else None

    def login(self, email, password):
        login_hash, enc, mac = master_keys(email, password)
        reply = self.call("POST", "/identity/connect/token", form={
            "grant_type": "password", "username": email, "password": login_hash,
            "scope": "api offline_access", "client_id": "web",
            "deviceType": "10", "deviceIdentifier": DEVICE, "deviceName": "pi-vault e2e test",
        })
        self.token = reply["access_token"]
        user_key = unseal(reply.get("Key") or reply["key"], enc, mac)
        return user_key[:32], user_key[32:]


def read_creds(path):
    values = dict(line.strip().split("=", 1) for line in open(path, encoding="utf8") if "=" in line)
    return values["email"], values["password"]


def add_item(client, keys, name):
    enc, mac = keys
    def field(text):
        return seal(text.encode(), enc, mac)
    user_id = client.call("GET", "/api/accounts/profile")["id"]
    client.call("POST", "/api/ciphers", body={
        "encryptedFor": user_id,
        "type": 1, "name": field(name), "notes": field("written by the pi-vault restore test"),
        "favorite": False, "reprompt": 0, "folderId": None, "organizationId": None,
        "login": {"username": field("test-user"), "password": field("not-a-real-secret"),
                  "uris": [{"uri": field("https://example.test"), "match": None}]},
    })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["register", "add", "verify"])
    parser.add_argument("--url", required=True)
    parser.add_argument("--creds", required=True)
    parser.add_argument("--cacert")
    parser.add_argument("--insecure", action="store_true")
    parser.add_argument("--name", default="first item")
    parser.add_argument("--expect", action="append", default=[])
    parser.add_argument("--absent", action="append", default=[])
    args = parser.parse_args()

    host = urllib.parse.urlparse(args.url).hostname or ""
    if not (host in ("localhost", "127.0.0.1") or host.endswith(".test") or os.environ.get("E2E_ALLOW_HOST") == host):
        raise SystemExit("e2e_client: test instances only (localhost); refusing to touch " + host)

    email, password = read_creds(args.creds)
    client = Client(args.url, args.cacert, args.insecure)

    if args.command == "register":
        login_hash, enc, mac = master_keys(email, password)
        user_key = os.urandom(64)
        private_pem = openssl(["genrsa", "2048"], b"")
        private_der = openssl(["pkcs8", "-topk8", "-nocrypt", "-outform", "DER"], private_pem)
        public_der = openssl(["rsa", "-pubout", "-outform", "DER"], private_pem)
        token = client.call("POST", "/identity/accounts/register/send-verification-email",
                            body={"email": email, "name": "Restore Test", "receiveMarketingEmails": False})
        client.call("POST", "/identity/accounts/register/finish", body={
            "email": email, "emailVerificationToken": token,
            "masterPasswordHash": login_hash, "masterPasswordHint": None,
            "userSymmetricKey": seal(user_key, enc, mac),
            "userAsymmetricKeys": {"publicKey": b64(public_der),
                                   "encryptedPrivateKey": seal(private_der, user_key[:32], user_key[32:])},
            "kdf": 0, "kdfIterations": ITERATIONS,
        })
        keys = client.login(email, password)
        add_item(client, keys, args.name)
        print(f"registered {email} and stored '{args.name}'")
    elif args.command == "add":
        keys = client.login(email, password)
        add_item(client, keys, args.name)
        print(f"stored '{args.name}'")
    else:
        keys = client.login(email, password)
        sync = client.call("GET", "/api/sync?excludeDomains=true")
        names = sorted(unseal(item["name"], *keys).decode() for item in sync.get("ciphers", []))
        print("items after login and decryption:", names)
        missing = [name for name in args.expect if name not in names]
        unexpected = [name for name in args.absent if name in names]
        if missing or unexpected:
            raise SystemExit(f"verify FAILED: missing {missing}, unexpected {unexpected}")
        print("verify ok")


if __name__ == "__main__":
    sys.exit(main())
