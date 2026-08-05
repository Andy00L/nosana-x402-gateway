#!/usr/bin/env python3
"""Nosana GPU deployment driver.

  export NOS_KEY=nos_...
  nos.py balance
  nos.py markets                                  # all markets, cheapest first
  nos.py run <market> <minutes> <script.sh> [files...]   # pack, start, poll, print
  nos.py logs <JOB_ADDRESS>                       # re-fetch a job's stdout
  nos.py status <DEPLOYMENT_ID>
  nos.py stop <DEPLOYMENT_ID>

<market> is a key from MARKETS below or a raw market address.
<script.sh> runs with the packed [files...] unpacked into /work (cwd).
"""
import base64, io, json, os, sys, tarfile, time, urllib.error, urllib.request

API = "https://dashboard.k8s.prd.nos.ci/api"
IMAGE = os.environ.get("NOS_IMAGE", "docker.io/nvidia/cuda:12.9.1-devel-ubuntu24.04")
GATEWAYS = ("https://gateway.pinata.cloud/ipfs/", "https://dweb.link/ipfs/",
            "https://w3s.link/ipfs/")

# PREMIUM markets only -- credits are refused on COMMUNITY/OTHER markets.
MARKETS = {
    "5090":  "6Xt8hgVLLL2PSHC9NtJP8E8oTdA5ZJc95hZEnHcdqKqb",   # $0.3636/hr
    "4090":  "97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf",   # $0.2909/hr
    "5080":  "9HnJacS25TnErsKMYJmKqWeCAMYuwY7gzhz9Eqhp5VE7",   # $0.1818/hr
    "a100":  "F3aGGSMb73XHbJbDXVbcXo7iYM9fyevvAZGQfwgrnWtB",   # $0.5545/hr (40GB)
    "a100-80": "GLJHzqRN9fKGBsvsFzmGnaQGknUtLN1dqaFR8n3YdM22", # $0.8181/hr
    "h100":  "Crop49jpc7prcgAcS82WbWyGHwbN5GgDym3uFbxxCTZg",   # $1.3636/hr
    "6000ada": "6eMivCx49anWFYwNgg8KNJQfSJYB5nBdif8CK6z52dem", # $0.6364/hr
}


def key():
    k = os.environ.get("NOS_KEY")
    if not k:
        sys.exit("NOS_KEY is not set")
    return k


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method,
                               headers={"Authorization": "Bearer " + key(),
                                        "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=120) as f:
            raw = f.read().decode()
        return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        return {"_http": e.code, "_body": e.read().decode()[:800]}


def pack(files):
    """gzip+base64 a file list for inlining into the remote command."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        for f in files:
            t.add(f, arcname=os.path.basename(f) if os.path.dirname(f) == "" else f)
    b64 = base64.b64encode(buf.getvalue()).decode()
    return "\n".join(b64[i:i + 76] for i in range(0, len(b64), 76))


def build_cmd(script_path, files):
    body = open(script_path).read()
    head = "mkdir -p /work && cd /work\n"
    if files:
        head += ("cat > _src.b64 <<'NOSEOF'\n" + pack(files) + "\nNOSEOF\n"
                 "base64 -d _src.b64 | tar xzf - && rm -f _src.b64\n")
    return head + body


def fetch_logs(cid, tries=3):
    # IPFS gateways 403 the default Python-urllib User-Agent -- send a curl-like
    # one.  Results can also take a few seconds to propagate, hence the retries.
    for attempt in range(tries):
        for gw in GATEWAYS:
            try:
                r = urllib.request.Request(gw + cid, headers={"User-Agent": "curl/8.5.0"})
                with urllib.request.urlopen(r, timeout=120) as f:
                    return json.loads(f.read().decode(errors="replace"))
            except Exception as e:
                print(f"  [gateway {gw} failed: {e}]", file=sys.stderr)
        if attempt < tries - 1:
            time.sleep(10 * (attempt + 1))
    return None


def print_logs(cid):
    """Job stdout lives ONLY in the raw IPFS result; the REST API strips it."""
    d = fetch_logs(cid)
    if not d:
        return sys.exit("could not fetch result from any IPFS gateway")
    for op in d.get("opStates", []):
        print(f"--- op {op.get('operationId')} exit={op.get('exitCode')} "
              f"{op.get('status')} logs={len(op.get('logs') or [])}")
        for l in (op.get("logs") or []):
            sys.stdout.write(str(l.get("log")))
    if not d.get("opStates"):
        print("opStates is EMPTY -- was the deployment created with "
              '"confidential": false ?')


def cmd_run(market, minutes, script, files, replicas=1, wait=True):
    addr = MARKETS.get(market, market)
    cmd = build_cmd(script, files)
    print(f"payload {len(cmd)/1024:.1f} KB -> market {addr} for {minutes} min "
          f"x{replicas} replica(s)")
    dep = req("POST", "/deployments/create", {
        "name": os.environ.get("NOS_NAME", "nos-run"),
        "market": addr, "timeout": int(minutes), "replicas": int(replicas),
        "strategy": "SIMPLE",
        "confidential": False,          # REQUIRED, else opStates comes back empty
        "job_definition": {
            "version": "0.1", "type": "container", "meta": {"trigger": "api"},
            "ops": [{"type": "container/run", "id": "main",
                     "args": {"gpu": True, "image": IMAGE, "cmd": ["bash", "-c", cmd]}}],
        }})
    if "id" not in dep:
        return sys.exit(f"create failed: {dep}")
    dep_id = dep["id"]
    print("deployment", dep_id, "->", req("POST", f"/deployments/{dep_id}/start", {}))
    if not wait:
        return dep_id

    job = cid = None
    for _ in range(120):
        jobs = req("GET", f"/deployments/{dep_id}/jobs").get("jobs", [])
        if jobs:
            job = jobs[0]["job"]
            info = req("GET", f"/jobs/{job}")
            state = jobs[0]["state"]
            print(f"  {time.strftime('%H:%M:%S')} {state} job={job}")
            if state != "RUNNING":
                cid = info.get("ipfsResult")
                break
        time.sleep(30)
    if not cid:
        return sys.exit(f"timed out; check with: nos.py status {dep_id}")
    print(f"=== result (job {job}) ===")
    print_logs(cid)


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == "balance":
        print(req("GET", "/credits/balance"))
    elif a[0] == "markets":
        for p, t, n, ad in sorted((x.get("usd_reward_per_hour") or 0, x.get("type"),
                                   x["name"], x["address"]) for x in req("GET", "/markets")):
            print(f"{p:7.4f} {t:<9} {n:<44} {ad}")
    elif a[0] == "run":
        # run <market> <minutes> <script> [files...]   env: NOS_REPLICAS, NOS_NOWAIT
        cmd_run(a[1], a[2], a[3], a[4:],
                replicas=int(os.environ.get("NOS_REPLICAS", "1")),
                wait=not os.environ.get("NOS_NOWAIT"))
    elif a[0] == "logs":
        print_logs(req("GET", f"/jobs/{a[1]}").get("ipfsResult"))
    elif a[0] == "status":
        print(json.dumps(req("GET", f"/deployments/{a[1]}"), indent=1))
        print(json.dumps(req("GET", f"/deployments/{a[1]}/jobs"), indent=1))
    elif a[0] == "stop":
        print(req("POST", f"/deployments/{a[1]}/stop", {}))
    else:
        sys.exit(__doc__)
