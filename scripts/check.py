"""Probe every component in checks.json and update site/data.json.

Runs in GitHub Actions every few minutes, outside Inferra's cloud, so the
page stays honest when the platform is down. Keeps 7 days of raw checks and
90 days of daily uptime; never invents history before the first check.
"""
import json, time, urllib.request, urllib.error, datetime as dt, pathlib, ssl

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "site" / "data.json"
RAW_KEEP = 7 * 24 * 12          # 7 days of 5-minute checks
DAYS_KEEP = 90

def probe(c):
    start = time.monotonic()
    req = urllib.request.Request(c["url"], headers={"User-Agent": "inferra-status/1 (+https://status.inferralab.com)"})
    try:
        with urllib.request.urlopen(req, timeout=15, context=ssl.create_default_context()) as r:
            body = r.read(200_000).decode("utf-8", "replace")
            code = r.status
    except urllib.error.HTTPError as e:
        code, body = e.code, ""
    except Exception as e:  # DNS, TLS, timeout
        return {"ok": False, "ms": None, "why": type(e).__name__}
    ms = round((time.monotonic() - start) * 1000)
    ok = code == c.get("expect", 200) and c.get("contains", "") in body
    return {"ok": ok, "ms": ms, "why": None if ok else f"HTTP {code}"}

def main():
    checks = json.loads((ROOT / "checks.json").read_text())
    data = json.loads(DATA.read_text()) if DATA.exists() else {"components": {}}
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    today = now.date().isoformat()
    for c in checks:
        r = probe(c)
        if not r["ok"]:          # one retry before calling it down
            time.sleep(5)
            r = probe(c)
        comp = data["components"].setdefault(c["id"], {"raw": [], "days": {}, "since": now.isoformat()})
        comp["name"] = c["name"]
        comp["raw"] = (comp["raw"] + [[now.isoformat(), r["ok"], r["ms"]]])[-RAW_KEEP:]
        d = comp["days"].setdefault(today, [0, 0])
        d[0] += 1; d[1] += 1 if r["ok"] else 0
        comp["days"] = dict(sorted(comp["days"].items())[-DAYS_KEEP:])
        comp["status"] = "up" if r["ok"] else "down"
        comp["why"] = r["why"]
    data["updated"] = now.isoformat()
    data["components"] = {c["id"]: data["components"][c["id"]] for c in checks}
    DATA.write_text(json.dumps(data, separators=(",", ":")))
    summary = {"updated": data["updated"], "sites": [{"id": k, "name": v["name"], "status": v["status"]} for k, v in data["components"].items()]}
    (ROOT / "site" / "api").mkdir(exist_ok=True)
    (ROOT / "site" / "api" / "summary.json").write_text(json.dumps(summary))
    print(json.dumps(summary))

if __name__ == "__main__":
    main()
