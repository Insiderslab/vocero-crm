#!/usr/bin/env python3
"""Prove public Marine tenant isolation using one synthetic owner account."""
import argparse
import http.cookiejar
import ipaddress
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/opt/bambola-arm")
APP_CONTAINER = "bambola-arm-app-1"
PRIVATE_PORT = 3000
PUBLIC = "https://bambola.heili.cloud"
PRIVATE_HOST = "bambola.heili.cloud"
ACCOUNTS_FILE = ROOT / "runtime" / "accounts.json"
BOOTSTRAP_FILE = ROOT / "evidence" / "bootstrap.json"
EVIDENCE_DIR = ROOT / "evidence"
MAX_RESPONSE = 1_048_576


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, private_url):
        self.private_url = private_url.rstrip("/")
        self.cookies = {}
        self.opener = urllib.request.build_opener(NoRedirect)

    def request(self, path, *, private=False, method="GET", body=None):
        origin = self.private_url if private else PUBLIC
        url = origin + path
        headers = {"Accept": "application/json", "Host": PRIVATE_HOST if private else "bambola.heili.cloud"}
        if self.cookies:
            headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())
        if body is not None:
            headers["Content-Type"] = "application/json"
            headers["Origin"] = PUBLIC
        request = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode("utf-8"), headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=10)
            status, raw, response_headers = response.status, response.read(MAX_RESPONSE + 1), response.headers
        except urllib.error.HTTPError as response:
            status, raw, response_headers = response.code, response.read(MAX_RESPONSE + 1), response.headers
        if len(raw) > MAX_RESPONSE:
            raise RuntimeError("unexpectedly large response")
        for raw_cookie in response_headers.get_all("Set-Cookie", []):
            pair = raw_cookie.split(";", 1)[0]
            key, sep, val = pair.partition("=")
            if sep:
                if val:
                    self.cookies[key] = val
                else:
                    self.cookies.pop(key, None)
        if not raw:
            data = None
        else:
            try:
                data = json.loads(raw)
            except (UnicodeDecodeError, json.JSONDecodeError):
                raise RuntimeError("unexpected response format") from None
        return status, data


def validate_app_ip(value):
    address = ipaddress.ip_address(value)
    if address.version != 4 or not address.is_private:
        raise ValueError("private app address must be a private IPv4 address")
    try:
        result = subprocess.run(["docker", "inspect", APP_CONTAINER], check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        inspected_app = json.loads(result.stdout)[0]
        networks = inspected_app["NetworkSettings"]["Networks"]
        image_id = inspected_app["Image"]
    except Exception:
        raise RuntimeError("could not verify the fixed Bambola app container") from None
    if not isinstance(image_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise RuntimeError("fixed app image ID is invalid")
    candidates = [
        name for name, network in networks.items()
        if name.endswith("_bambola_edge")
        and network.get("IPAddress") == str(address)
        and "bambola-arm-private-app" in network.get("Aliases", [])
    ]
    matches = []
    for name in candidates:
        try:
            inspected = subprocess.run(["docker", "network", "inspect", name], check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            network_info = json.loads(inspected.stdout)[0]
        except Exception:
            raise RuntimeError("could not verify the Bambola app edge network") from None
        if network_info.get("Internal") is True:
            matches.append(name)
    if len(matches) != 1:
        raise RuntimeError("address is not the inspected Bambola app edge address")
    return str(address), image_id


def check_status(result, expected):
    status, data = result
    if status != expected:
        raise RuntimeError("unexpected HTTP result")
    return data


def new_result_path(evidence=EVIDENCE_DIR):
    evidence.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(evidence, 0o700)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    return Path(evidence) / f"tenant-proof-{timestamp}.json"


def prove(private_ip, accounts_file=ACCOUNTS_FILE, bootstrap_file=BOOTSTRAP_FILE, result_path=None):
    result_path = Path(result_path) if result_path else new_result_path()
    report = {
        "version": 1, "ok": False, "base": PUBLIC, "sourceAppImageId": None,
        "completedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "checks": {"readIsolation": False, "writeIsolation": False, "sessionRestored": False, "logout": False},
        "originalOrganizationId": None, "sampleTourId": None,
    }
    client = None
    primary_error = None
    original_org = None
    trip_id = None
    try:
        private_ip, image_id = validate_app_ip(private_ip)
        report["sourceAppImageId"] = image_id
        accounts_data = json.loads(Path(accounts_file).read_text(encoding="utf-8"))
        bootstrap = json.loads(Path(bootstrap_file).read_text(encoding="utf-8"))
        owners = [account for account in accounts_data.get("accounts", []) if account.get("role") == "owner"]
        trip_id = bootstrap.get("sampleTourId")
        if len(owners) != 1 or not isinstance(owners[0].get("email"), str) or not isinstance(owners[0].get("password"), str):
            raise RuntimeError("owner account manifest is invalid")
        if not isinstance(trip_id, str) or not trip_id or len(trip_id) > 100:
            raise RuntimeError("bootstrap sample tour reference is invalid")
        report["sampleTourId"] = trip_id
        client = Client(f"http://{private_ip}:{PRIVATE_PORT}")
        owner = owners[0]
        check_status(client.request("/api/auth/sign-in/email", private=True, method="POST", body={"email": owner["email"], "password": owner["password"]}), 200)
        session = check_status(client.request("/api/auth/get-session", private=True), 200)
        original_org = session.get("session", {}).get("activeOrganizationId")
        if not isinstance(original_org, str) or not original_org:
            raise RuntimeError("owner active organization is missing")
        report["originalOrganizationId"] = original_org
        baseline = check_status(client.request("/api/marine?" + urllib.parse.urlencode({"tripId": trip_id}), private=False), 200)
        if baseline.get("role") != "owner" or baseline.get("organizationId") != original_org or baseline.get("trip", {}).get("id") != trip_id:
            raise RuntimeError("public owner baseline did not expose its own synthetic trip")

        org_slug = "bambola-prueba-" + uuid.uuid4().hex[:16]
        created = check_status(client.request("/api/auth/organization/create", private=True, method="POST", body={"name": "Organización aislada PRUEBA", "slug": org_slug, "metadata": {"label": "PRUEBA"}, "keepCurrentActiveOrganization": True}), 200)
        other_org = created.get("id")
        if not isinstance(other_org, str) or not other_org or other_org == original_org:
            raise RuntimeError("synthetic secondary organization was not created")
        check_status(client.request("/api/auth/organization/set-active", private=True, method="POST", body={"organizationId": other_org}), 200)
        active = check_status(client.request("/api/auth/get-session", private=True), 200)
        if active.get("session", {}).get("activeOrganizationId") != other_org:
            raise RuntimeError("secondary organization did not become active")

        query = urllib.parse.urlencode({"tripId": trip_id})
        isolated = check_status(client.request("/api/marine?" + query), 200)
        serialized = json.dumps(isolated, ensure_ascii=False)
        if isolated.get("organizationId") != other_org or isolated.get("trip") is not None or trip_id in serialized or baseline["trip"].get("title", "") in serialized:
            raise RuntimeError("public read exposed another organization's trip")
        report["checks"]["readIsolation"] = True
        denied = client.request("/api/marine", method="POST", body={"action": "addIncident", "tripId": trip_id, "requestId": str(uuid.uuid4()), "text": "Control de aislamiento PRUEBA"})
        if denied[0] != 404:
            raise RuntimeError("cross-organization mutation was not hidden as not found")
        report["checks"]["writeIsolation"] = True
    except Exception as error:
        primary_error = error
    finally:
        if client is not None:
            try:
                if isinstance(original_org, str) and original_org:
                    check_status(client.request("/api/auth/organization/set-active", private=True, method="POST", body={"organizationId": original_org}), 200)
                    restored_session = check_status(client.request("/api/auth/get-session", private=True), 200)
                    session_restored = restored_session.get("session", {}).get("activeOrganizationId") == original_org
                    public_restore = check_status(client.request("/api/marine?" + urllib.parse.urlencode({"tripId": trip_id})), 200)
                    session_restored = session_restored and public_restore.get("role") == "owner" and public_restore.get("organizationId") == original_org and public_restore.get("trip", {}).get("id") == trip_id
                    report["checks"]["sessionRestored"] = session_restored
            except Exception:
                pass
            try:
                if client.cookies:
                    logout = client.request("/api/auth/sign-out", private=True, method="POST", body={})
                    report["checks"]["logout"] = logout[0] == 200
            except Exception:
                pass
        report["ok"] = all(report["checks"].values()) and primary_error is None
        report["completedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        with Path(result_path).open("x", encoding="utf-8") as output:
            os.chmod(result_path, 0o600)
            json.dump(report, output, separators=(",", ":"))
            output.write("\n")
    if primary_error is not None:
        raise RuntimeError("tenant isolation proof failed") from None
    if not report["ok"]:
        raise RuntimeError("tenant isolation proof incomplete")
    return result_path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private-app-ip", required=True)
    args = parser.parse_args(argv)
    result_path = new_result_path()
    try:
        prove(args.private_app_ip, result_path=result_path)
    except Exception:
        print(result_path)
        return 1
    print(result_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
