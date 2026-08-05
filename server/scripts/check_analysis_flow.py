

import asyncio
import secrets
import sys

import httpx

from app.core.database import connect_db
from app.main import app
from app.services import api_key_service, device_flow, session_service
from app.services.auth_service import ensure_indexes

ok = 0
fail = 0

NEGLECTED = """FROM node
WORKDIR /app
COPY . .
RUN npm install
RUN apt-get update
RUN apt-get install -y curl
EXPOSE 3000
CMD ["node", "server.js"]
"""


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
    for fn in (ensure_indexes, session_service.ensure_indexes,
               api_key_service.ensure_indexes, device_flow.ensure_indexes):
        await fn()

    suffix = secrets.token_hex(4)
    username, email, password = f"anatest{suffix}", f"anatest{suffix}@example.com", "correct horse battery"

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test/api/v1", timeout=180) as c:
        r = await c.post("/auth/signup", json={"username": username, "email": email, "password": password})
        assert r.status_code == 201, r.text
        session = r.json()["data"]
        auth = {"Authorization": f"Bearer {session['token']}"}

        print("\n--- rules-only lint (no AI, no DB) ---")
        r = await c.post(
            "/analyze/rules",
            json={"content": NEGLECTED, "hasDockerignore": False, "bloatCandidates": [".git"]},
            headers=auth,
        )
        check("rules 200", r.status_code == 200, r.text[:300])
        rules = r.json()["data"]
        ids = {f["ruleId"] for f in rules["findings"]}
        check("finds the obvious problems", {"unpinned-base-image", "copy-entire-context",
                                             "missing-dockerignore", "apt-missing-cleanup"} <= ids, str(sorted(ids)))
        check("scores present", 0 <= rules["scores"]["optimizationScore"] <= 100)
        first = rules["findings"][0]
        check("findings carry ranges", first["line"] >= 1 and "fixRange" in first)
        check("hover fields present", all(k in first for k in
              ("problem", "explanation", "securityImpact", "performanceImpact", "docsUrl")))
        check("unauthenticated rules call rejected", (await c.post("/analyze/rules", json={"content": "FROM x"})).status_code == 401)

        print("\n--- full extension analysis (one real AI call) ---")
        r = await c.post(
            "/analyze/extension",
            json={
                "content": NEGLECTED,
                "filename": "Dockerfile",
                "hasDockerignore": False,
                "packageJson": '{"name":"demo","dependencies":{"express":"^4"},"devDependencies":{"jest":"^29"}}',
                "bloatCandidates": [".git", "node_modules"],
                "clientVersion": "1.0.0",
            },
            headers=auth,
        )
        if r.status_code == 429:
            print(f"  SKIP  provider throttled: {r.json().get('detail','')[:140]}")
            analysis = None
        else:
            check("extension analyze 201", r.status_code == 201, r.text[:400])
            analysis = r.json()["data"]
            check("source recorded as vscode", analysis["source"] == "vscode", str(analysis.get("source")))
            check("saved to history", analysis["saved"] is True)
            check("reports which model answered", bool(analysis["modelUsed"]), str(analysis.get("modelUsed")))
            check("returns an optimized dockerfile", len(analysis["optimizedDockerfile"]) > 20)
            check("deterministic scores stored", 0 <= analysis["optimizationScore"] <= 100)
            check("rule findings stored", len(analysis["ruleFindings"]) > 3)
            check("ai insights present", bool(analysis["aiInsights"]))
            check("scheduling info returned", "attempts" in analysis["scheduling"])

        print("\n--- unsaved analysis does not reach history ---")
        before = (await c.get("/analyze/history", headers=auth)).json()["data"]["total"]
        check("history reflects saved analysis", before == (1 if analysis else 0), f"got {before}")

        print("\n--- history query ---")
        r = await c.get("/analyze/history", headers=auth, params={"pageSize": 5})
        check("history 200", r.status_code == 200, r.text[:200])
        page = r.json()["data"]
        check("paginated envelope", all(k in page for k in ("items", "total", "page", "pageSize", "hasMore")))
        if analysis:
            check("list rows omit heavy fields", "ruleFindings" not in page["items"][0])
            check("filter by source=vscode matches",
                  (await c.get("/analyze/history", headers=auth, params={"source": "vscode"})).json()["data"]["total"] == 1)
            check("filter by source=web excludes it",
                  (await c.get("/analyze/history", headers=auth, params={"source": "web"})).json()["data"]["total"] == 0)
            check("search on filename matches",
                  (await c.get("/analyze/history", headers=auth, params={"q": "Dockerfile"})).json()["data"]["total"] == 1)
            check("search for nonsense matches nothing",
                  (await c.get("/analyze/history", headers=auth, params={"q": "zzzznope"})).json()["data"]["total"] == 0)
            # A regex metacharacter must be treated as a literal, not compiled.
            r = await c.get("/analyze/history", headers=auth, params={"q": "c++ (unclosed["})
            check("regex metacharacters in search are escaped", r.status_code == 200, r.text[:200])

            print("\n--- favorites ---")
            aid = analysis["_id"]
            r = await c.patch(f"/analyze/{aid}/favorite", json={"favorite": True}, headers=auth)
            check("mark favorite 200", r.status_code == 200, r.text[:200])
            check("filter favorite=true finds it",
                  (await c.get("/analyze/history", headers=auth, params={"favorite": True})).json()["data"]["total"] == 1)
            check("filter favorite=false excludes it",
                  (await c.get("/analyze/history", headers=auth, params={"favorite": False})).json()["data"]["total"] == 0)
            await c.patch(f"/analyze/{aid}/favorite", json={"favorite": False}, headers=auth)

            print("\n--- single analysis + ownership ---")
            r = await c.get(f"/analyze/{aid}", headers=auth)
            check("fetch by id 200", r.status_code == 200)
            check("full record includes findings", len(r.json()["data"]["ruleFindings"]) > 3)
            check("bad id 400", (await c.get("/analyze/not-an-id", headers=auth)).status_code == 400)
            check("unknown id 404", (await c.get("/analyze/507f1f77bcf86cd799439011", headers=auth)).status_code == 404)

            # Another account must not be able to read or delete it.
            r2 = await c.post("/auth/signup", json={"username": f"other{suffix}", "email": f"other{suffix}@example.com", "password": password})
            other = {"Authorization": f"Bearer {r2.json()['data']['token']}"}
            check("another user cannot read it", (await c.get(f"/analyze/{aid}", headers=other)).status_code == 404)
            check("another user cannot delete it", (await c.delete(f"/analyze/{aid}", headers=other)).status_code == 404)
            check("another user's history is empty",
                  (await c.get("/analyze/history", headers=other)).json()["data"]["total"] == 0)
            await c.post("/account/delete", json={"password": password, "confirmUsername": f"other{suffix}"}, headers=other)

        print("\n--- stats ---")
        r = await c.get("/analyze/stats", headers=auth)
        check("stats 200", r.status_code == 200, r.text[:300])
        stats = r.json()["data"]
        check("stats shape", all(k in stats for k in
              ("total", "bySource", "bytesSaved", "avgOptimizationScore", "lastAnalysisAt")))
        if analysis:
            check("counts the vscode analysis", stats["bySource"]["vscode"] == 1, str(stats["bySource"]))
            check("bytes saved is positive", stats["bytesSaved"] > 0, str(stats["bytesSaved"]))

        if analysis:
            print("\n--- delete ---")
            check("delete 200", (await c.delete(f"/analyze/{analysis['_id']}", headers=auth)).status_code == 200)
            check("history empty after delete",
                  (await c.get("/analyze/history", headers=auth)).json()["data"]["total"] == 0)

        print("\n--- stats on an empty account ---")
        r = await c.get("/analyze/stats", headers=auth)
        check("zeros not an error", r.status_code == 200 and r.json()["data"]["total"] == 0, r.text[:200])

        await c.post("/account/delete", json={"password": password, "confirmUsername": username}, headers=auth)

    print(f"\n{'='*46}\n  {ok} passed, {fail} failed\n{'='*46}")
    return 1 if fail else 0


sys.exit(asyncio.run(main()))
