
import asyncio
import secrets
import sys

import httpx

from app.core.database import connect_db, get_db
from app.main import app
from app.services import api_key_service, device_flow, session_service
from app.services.auth_service import ensure_indexes

ok = 0
fail = 0


def check(label, condition, extra=""):
    global ok, fail
    if condition:
        ok += 1
        print(f"  PASS  {label}")
    else:
        fail += 1
        print(f"  FAIL  {label} {extra}")


async def main():
    await connect_db()
    await ensure_indexes()
    await session_service.ensure_indexes()
    await api_key_service.ensure_indexes()
    await device_flow.ensure_indexes()

    suffix = secrets.token_hex(4)
    username = f"flowtest{suffix}"
    email = f"flowtest{suffix}@example.com"
    password = "correct horse battery"

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test/api/v1") as c:
        print("\n--- signup ---")
        r = await c.post("/auth/signup", json={"username": username, "email": email, "password": password})
        check("signup 201", r.status_code == 201, r.text[:300])
        data = r.json()["data"]
        access, refresh = data["token"], data["refreshToken"]
        check("returns access token", bool(access))
        check("returns refresh token", bool(refresh))
        check("returns sessionId", bool(data["sessionId"]))

        auth = {"Authorization": f"Bearer {access}"}

        print("\n--- authenticated read ---")
        r = await c.get("/auth/me", headers=auth)
        check("/auth/me 200", r.status_code == 200, r.text[:200])
        check("username echoed", r.json()["data"]["username"] == username)

        print("\n--- rejects garbage ---")
        r = await c.get("/auth/me", headers={"Authorization": "Bearer nonsense"})
        check("bad token 401", r.status_code == 401)
        r = await c.get("/auth/me")
        check("no token 401", r.status_code == 401)

        print("\n--- refresh rotation ---")
        r = await c.post("/auth/refresh", json={"refreshToken": refresh})
        check("refresh 200", r.status_code == 200, r.text[:300])
        rotated = r.json()["data"]
        check("new refresh token differs", rotated["refreshToken"] != refresh)
        check("new access token issued", bool(rotated["token"]))
        new_refresh = rotated["refreshToken"]

        print("\n--- refresh token reuse is detected ---")
        r = await c.post("/auth/refresh", json={"refreshToken": refresh})
        check("replayed token 401", r.status_code == 401, r.text[:200])
        check("explains reuse", "reuse" in r.text.lower(), r.text[:200])
        r = await c.post("/auth/refresh", json={"refreshToken": new_refresh})
        check("session burned after reuse", r.status_code == 401, r.text[:200])

        print("\n--- sign in again ---")
        r = await c.post("/auth/login", json={"identifier": username, "password": password})
        check("login 200", r.status_code == 200, r.text[:200])
        session = r.json()["data"]
        auth = {"Authorization": f"Bearer {session['token']}"}
        r = await c.post("/auth/login", json={"identifier": email, "password": "wrong"})
        check("wrong password 401", r.status_code == 401)

        print("\n--- device flow ---")
        r = await c.post(
            "/auth/device/start",
            json={"clientName": "VS Code", "clientVersion": "1.95.0", "platform": "linux"},
        )
        check("device start 201", r.status_code == 201, r.text[:300])
        dev = r.json()["data"]
        check("user code formatted XXXX-XXXX", len(dev["userCode"]) == 9 and dev["userCode"][4] == "-", dev.get("userCode"))
        check("verification uri complete", dev["userCode"] in dev["verificationUriComplete"])

        r = await c.post("/auth/device/token", json={"deviceCode": dev["deviceCode"]})
        check("poll before approval 202", r.status_code == 202, f"got {r.status_code}")

        r = await c.post("/auth/device/token", json={"deviceCode": dev["deviceCode"]})
        check("polling too fast 429", r.status_code == 429, f"got {r.status_code}")

        r = await c.get(f"/auth/device/pending?userCode={dev['userCode']}", headers=auth)
        check("pending describes client", r.status_code == 200 and r.json()["data"]["client"]["name"] == "VS Code", r.text[:200])

        r = await c.post("/auth/device/approve", json={"userCode": dev["userCode"]}, headers=auth)
        check("approve 200", r.status_code == 200, r.text[:300])

        r = await c.post("/auth/device/token", json={"deviceCode": dev["deviceCode"]})
        check("poll after approval 200", r.status_code == 200, r.text[:300])
        ext = r.json()["data"]
        check("extension got its own session", ext["sessionId"] != session["sessionId"])
        ext_auth = {"Authorization": f"Bearer {ext['token']}"}

        r = await c.post("/auth/device/token", json={"deviceCode": dev["deviceCode"]})
        check("device code is single use", r.status_code == 400, f"got {r.status_code}")

        print("\n--- connected devices ---")
        r = await c.get("/account/sessions", headers=auth)
        check("lists sessions 200", r.status_code == 200, r.text[:200])
        sessions = r.json()["data"]
        check("browser + extension listed", len(sessions) >= 2, f"got {len(sessions)}")
        current = [s for s in sessions if s["isCurrent"]]
        check("exactly one marked current", len(current) == 1, f"got {len(current)}")
        kinds = {s["client"]["kind"] for s in sessions}
        check("extension identified as vscode", "vscode" in kinds, str(kinds))

        print("\n--- revocation actually revokes ---")
        r = await c.get("/auth/me", headers=ext_auth)
        check("extension token works before revoke", r.status_code == 200)
        r = await c.delete(f"/account/sessions/{ext['sessionId']}", headers=auth)
        check("revoke 200", r.status_code == 200, r.text[:200])
        r = await c.get("/auth/me", headers=ext_auth)
        check("extension token dead immediately after revoke", r.status_code == 401, f"got {r.status_code}")
        r = await c.post("/auth/refresh", json={"refreshToken": ext["refreshToken"]})
        check("revoked session cannot refresh", r.status_code == 401, f"got {r.status_code}")

        print("\n--- api keys ---")
        r = await c.post("/account/api-keys", json={"name": "CI"}, headers=auth)
        check("create key 201", r.status_code == 201, r.text[:200])
        key = r.json()["data"]["key"]
        check("key is prefixed", key.startswith("isk_"), key[:12])
        r = await c.get("/auth/me", headers={"Authorization": f"Bearer {key}"})
        check("api key authenticates", r.status_code == 200, r.text[:200])
        r = await c.post("/auth/device/approve", json={"userCode": "AAAA-BBBB"}, headers={"Authorization": f"Bearer {key}"})
        check("api key cannot approve devices", r.status_code == 403, f"got {r.status_code}")
        keys = (await c.get("/account/api-keys", headers=auth)).json()["data"]
        check("key list hides the secret", all("key" not in k for k in keys), str(keys))
        r = await c.delete(f"/account/api-keys/{keys[0]['id']}", headers=auth)
        check("revoke key 200", r.status_code == 200)
        r = await c.get("/auth/me", headers={"Authorization": f"Bearer {key}"})
        check("revoked key rejected", r.status_code == 401, f"got {r.status_code}")

        print("\n--- avatar validation ---")
        png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
        r = await c.put("/account/avatar", json={"avatar": png}, headers=auth)
        check("valid png accepted", r.status_code == 200, r.text[:200])
        r = await c.put("/account/avatar", json={"avatar": "data:image/png;base64,PHN2Zz48L3N2Zz4="}, headers=auth)
        check("svg mislabelled as png rejected", r.status_code == 400, f"got {r.status_code}: {r.text[:150]}")
        r = await c.put("/account/avatar", json={"avatar": "data:text/html;base64,PGI+"}, headers=auth)
        check("disallowed type rejected", r.status_code == 400, f"got {r.status_code}")

        print("\n--- account deletion ---")
        r = await c.post("/account/delete", json={"password": password, "confirmUsername": "wrong"}, headers=auth)
        check("mismatched confirmation rejected", r.status_code == 400, f"got {r.status_code}")
        r = await c.post("/account/delete", json={"password": "nope", "confirmUsername": username}, headers=auth)
        check("wrong password rejected", r.status_code == 401, f"got {r.status_code}")
        r = await c.post("/account/delete", json={"password": password, "confirmUsername": username}, headers=auth)
        check("delete 200", r.status_code == 200, r.text[:200])
        r = await c.get("/auth/me", headers=auth)
        check("token dead after deletion", r.status_code == 401, f"got {r.status_code}")

        db = get_db()
        check("user row gone", await db["users"].count_documents({"usernameLower": username.lower()}) == 0)
        check("sessions gone", await db["sessions"].count_documents({"userId": session["user"]["id"]}) == 0)

    print(f"\n{'='*46}\n  {ok} passed, {fail} failed\n{'='*46}")
    return 1 if fail else 0


sys.exit(asyncio.run(main()))
