---
name: nosana-deploy
description: Run GPU workloads on rented Nosana hardware (RTX 5090, 4090, A100, H100) via the Nosana REST API. Create, start, and stop deployments, ship local source to the node, and retrieve stdout. Use when the user says "run this on a 5090", "rent a GPU", "benchmark on better hardware", "nosana", "deploy to Nosana", "run this remotely on a GPU", or needs a GPU the local machine does not have.
---

# Deploying to Nosana

Nosana rents GPUs by the hour, paid from account credits. You POST a container
job definition, a node runs it, and stdout comes back through IPFS.

**Everything below was verified against the live API.** Four things are
non-obvious and each one costs a wasted run if you get it wrong; they are
flagged **GOTCHA**.

## 0. Prerequisites

An API key of the form `nos_...` (dashboard > Account > API Keys). Keep it in an
env var, never in the job payload, never in a committed file:

```bash
export NOS_KEY=nos_your_api_key_here
export NOS_API=https://dashboard.k8s.prd.nos.ci/api
```

Check it works and see the budget:

```bash
curl -s -H "Authorization: Bearer $NOS_KEY" "$NOS_API/credits/balance"
# {"assignedCredits":100,"reservedCredits":0,"settledCredits":10.5}
```

`assignedCredits` is the ceiling, `settledCredits` is what has actually been
consumed, `reservedCredits` is held against jobs currently in flight. Watch
`settledCredits` move to know real spend.

## 1. Pick a market

A "market" is a GPU class. Each has an address you pass as `market`.

```bash
curl -s -H "Authorization: Bearer $NOS_KEY" "$NOS_API/markets" > markets.json
python3 - <<'PY'
import json
m=json.load(open('markets.json'))
rows=[(x.get('usd_reward_per_hour') or 0, x.get('type'), x['name'], x['address']) for x in m]
for p,t,n,a in sorted(rows):
    print(f"{p:7.4f} {t:<9} {n:<44} {a}")
PY
```

> **GOTCHA 1: credits only work on `PREMIUM` markets.** A `COMMUNITY` market
> fails asynchronously with _"Credit-based jobs are only allowed on premium
> markets"_, and you only see it in the dashboard's event log; the API happily
> reports the deployment as `RUNNING` with `active_jobs: 0` forever.

Verified premium market addresses and prices (July 2026):

| GPU          | USD/hr | market address                                 |
| ------------ | ------ | ---------------------------------------------- |
| RTX 5090     | 0.3636 | `6Xt8hgVLLL2PSHC9NtJP8E8oTdA5ZJc95hZEnHcdqKqb` |
| RTX 4090     | 0.2909 | `97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf` |
| RTX 5080     | 0.1818 | `9HnJacS25TnErsKMYJmKqWeCAMYuwY7gzhz9Eqhp5VE7` |
| A100 40GB    | 0.5545 | `F3aGGSMb73XHbJbDXVbcXo7iYM9fyevvAZGQfwgrnWtB` |
| A100 80GB    | 0.8181 | `GLJHzqRN9fKGBsvsFzmGnaQGknUtLN1dqaFR8n3YdM22` |
| H100         | 1.3636 | `Crop49jpc7prcgAcS82WbWyGHwbN5GgDym3uFbxxCTZg` |
| RTX 6000 Ada | 0.6364 | `6eMivCx49anWFYwNgg8KNJQfSJYB5nBdif8CK6z52dem` |

Markets list a `required_images` array. That is a requirement on the _node_
(images it must keep cached), **not** a restriction on what you may run; an
arbitrary image such as `docker.io/nvidia/cuda:12.9.1-devel-ubuntu24.04` works
fine.

## 2. Create, then start

Deployments are created in `DRAFT` and do nothing until started.

> **GOTCHA 2: the create route is `POST /deployments/create`.**
> `POST /deployments` returns 404 (`GET /deployments` works, which makes this
> easy to miss).

> **GOTCHA 3: set `"confidential": false`.** It defaults to true, and a
> confidential run publishes `opStates: []`. You get **no logs at all**, while
> still being billed, and there is no way to recover the output afterwards.

```bash
curl -s -X POST -H "Authorization: Bearer $NOS_KEY" -H 'Content-Type: application/json' \
  "$NOS_API/deployments/create" -d '{
  "name": "my-job",
  "market": "6Xt8hgVLLL2PSHC9NtJP8E8oTdA5ZJc95hZEnHcdqKqb",
  "timeout": 30,
  "replicas": 1,
  "strategy": "SIMPLE",
  "confidential": false,
  "job_definition": {
    "version": "0.1", "type": "container", "meta": {"trigger": "api"},
    "ops": [{ "type": "container/run", "id": "main", "args": {
        "gpu": true,
        "image": "docker.io/nvidia/cuda:12.9.1-devel-ubuntu24.04",
        "cmd": ["bash","-c","nvidia-smi; nvcc --version | tail -2"]
    }}]
  }}'
# -> {"id":"<DEPLOYMENT_ID>", "status":"DRAFT", ...}

curl -s -X POST -H "Authorization: Bearer $NOS_KEY" -H 'Content-Type: application/json' \
  "$NOS_API/deployments/$DEP/start" -d '{}'
```

- `timeout` is in **minutes** and is a ceiling, not a reservation: the job ends
  when the container exits, and the deployment auto-stops.
- `cmd` is a list, executed as the container's command. Use
  `["bash","-c","<script>"]` for anything non-trivial.
- Read back what was actually stored with
  `GET /deployments/{id}/revisions` (the `job_definition` field) before blaming
  the node.

## 3. Poll for completion

```bash
curl -s -H "Authorization: Bearer $NOS_KEY" "$NOS_API/deployments/$DEP/jobs"
# jobs[].state: RUNNING -> COMPLETED ; jobs[].job is the JOB ADDRESS
curl -s -H "Authorization: Bearer $NOS_KEY" "$NOS_API/jobs/$JOB"
# -> jobStatus: success|failed, ipfsResult: <CID>
```

A job typically takes 60 to 90 seconds to schedule and pull the image before
your script starts. Budget for that.

## 4. Get the output

> **GOTCHA 4: logs are only in the raw IPFS result.** `GET /jobs/{addr}`
> returns `jobResult.opStates[].logs` as an **empty array**; the API strips
> them. Fetch the `ipfsResult` CID from a gateway instead.

```bash
curl -sL "https://gateway.pinata.cloud/ipfs/$CID" -o result.json
python3 - <<'PY'
import json,sys
d=json.load(open('result.json'))
for op in d.get('opStates',[]):
    print(f"--- op {op.get('operationId')} exit={op.get('exitCode')} {op.get('status')}")
    for l in (op.get('logs') or []): sys.stdout.write(str(l.get('log')))
PY
```

`https://gateway.pinata.cloud/ipfs/` and `https://dweb.link/ipfs/` both work;
`ipfs.io` and `nosana.mypinata.cloud` returned 403, so keep a fallback list.

**The gateways 403 the default `Python-urllib/3.x` User-Agent.** `curl` works,
`urllib.request.urlopen(url)` does not, and the failure looks identical to
rate-limiting. Always send a UA:

```python
r = urllib.request.Request(gw + cid, headers={"User-Agent": "curl/8.5.0"})
```

Results can also take a few seconds to propagate after the job completes, so
retry once or twice before concluding the output is lost.

An op that exits 0 in under a second with no logs means your command never ran;
check `exitCode` and `diagnostics.state` in the same JSON.

## 5. Shipping local source to the node

There is no volume mount. For anything under about 100 KB, inline a gzipped
tarball as base64 in the command (55 KB of source was fine):

```python
import base64, io, tarfile
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w:gz") as t:
    for f in FILES: t.add(f, arcname=f)
b64 = base64.b64encode(buf.getvalue()).decode()
wrapped = "\n".join(b64[i:i+76] for i in range(0, len(b64), 76))
cmd = ("mkdir -p /work && cd /work\n"
       "cat > src.b64 <<'KSEOF'\n" + wrapped + "\nKSEOF\n"
       "base64 -d src.b64 | tar xzf - && rm -f src.b64\n" + your_script)
```

For larger payloads, push a Docker image or fetch from a public URL in the
script instead.

## 6. Cleaning up

**Never bulk-stop by status.** `GET /deployments` returns _every_ deployment on
the account, including long-running ones the user cares about. Filter by the
exact names you created:

```python
MINE = {"my-job"}                      # names YOU created, this session
for d in req("GET", "/deployments")["deployments"]:
    if d["status"] in ("RUNNING", "STARTING") and d["name"] in MINE:
        req("POST", f"/deployments/{d['id']}/stop", {})
```

Jobs that run to completion stop themselves, so cleanup is usually only needed
for jobs you want to abort early.

## Driver script

`scripts/nos.py` in this skill wraps all of the above:

```bash
export NOS_KEY=nos_your_api_key_here
python3 scripts/nos.py markets                       # list markets by price
python3 scripts/nos.py balance
python3 scripts/nos.py run 5090 30 job.sh file1.c file2.h   # pack, create, start, poll, print logs
python3 scripts/nos.py logs <JOB_ADDRESS>            # re-fetch output
python3 scripts/nos.py stop <DEPLOYMENT_ID>
```

## Reference: image choice

- `docker.io/nvidia/cuda:<ver>-devel-ubuntu24.04` has `nvcc`, `gcc`, and
  `cuobjdump`. Verified working. No `python3`, no `/usr/bin/time`; install with
  `apt-get` if you need them, or avoid them.
- Match the CUDA version to the target arch: **sm_120 (RTX 50-series) needs CUDA
  >= 12.8**; sm_90 (H100) needs >= 12.0.
- Write scripts defensively: no `set -e` around optional tools, echo section
  markers, and print exit codes. You get one shot at the logs per run.

## Cost sanity

A short build-and-benchmark job on a 5090 (image pull, a few nvcc builds, a
benchmark sweep, under 10 minutes wall) settles at a fraction of a credit, and
a handful of such runs stays around one credit total. Check `settledCredits`
before and after a run if you need an exact figure.
