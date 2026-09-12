# RunPod GPU worker (Linux x86 + NVIDIA)

The serverless GPU worker for the variant farm. The CPU/IO orchestration (Drive polling,
ledger, the sweep) is unchanged; only the upscale step runs on CUDA, behind the
`UpscaleBackend` seam. The image runs **one farm sweep per invocation** and exits — a
schedule (RunPod cron, or your control plane) triggers it; scale-to-zero between bursts.

> **Status: GPU core VALIDATED on an RTX 4090 (2026-06-28); container build + endpoint wiring
> remain.** The Python upscale path was run on a real RunPod 4090
> (runpod/pytorch:2.1.1-cuda12.1.1): the CUDA Real-ESRGAN upscale produces clean 1080×1920
> output (eyeballed — no tile seams) and **the spatial-corruption guard passes on it**
> (`spatial_ok=true`), while a scrambled-tile control is correctly caught (3.5 vs 32–94 clean).
> Two real bugs were fixed in the process (ffmpeg-7 `scale2ref`; the corruption floor, recut
> 60→20). Still NOT run: the actual `docker build`, and the serverless endpoint + Drive wiring.
>
> Findings baked into the Dockerfile from that run: pin **numpy<2** (realesrgan pulls numpy 2,
> incompatible with torch 2.1), use a **static ffmpeg with libvmaf** (distro build lacks it),
> **non-editable** package install (editable didn't register), and **verify the weights
> download size** (a silent partial download failed once).

## Pieces
- `Dockerfile` — CUDA + PyTorch + ffmpeg + Real-ESRGAN, weights baked in.
- `realesrgan_infer.py` — name-preserving Real-ESRGAN CLI (replaces the official
  `inference_realesrgan.py`, whose `--suffix` renaming would break ffmpeg frame reassembly).
  Its argv matches `CudaRealEsrganBackend.argv`.
- `handler.py` — RunPod serverless entry; thin wrapper over `farm.worker.run_job`.

## Build & push (on a GPU host or amd64 builder, NOT the Mac)
```bash
docker build -f deploy/runpod/Dockerfile -t <registry>/variant-farm:latest .
docker push <registry>/variant-farm:latest
```

## RunPod endpoint config
- **Image:** the pushed tag.
- **Secret (service account):** mount the Google service-account JSON as a file; the farm
  config's `auth.service_account_json` must point at that mounted path.
- **Network volume:** mount at `/runpod-volume`. The ledger lives at
  `/runpod-volume/farm-ledger.json` (`VARIANT_FARM_LEDGER`). **This is required** —
  serverless instances are ephemeral, so without a persistent ledger every invocation
  reprocesses everything (idempotency resets).
- **Config:** pass inline in the job input (`{"input": {"config": { ... }}}`) from a control
  plane, or set `VARIANT_FARM_CONFIG` to a path baked/mounted into the image.

Job input shape (`run_job`): `config` (inline dict) | `config_path` | `$VARIANT_FARM_CONFIG`;
optional `ledger_path`, `work_dir`. Returns `{new, done, failed, skipped, corrupt_dropped}`.

## First-deploy smoke-test gate (do this before pointing real clients at it)
1. **Image builds** on amd64+CUDA (watch the basicsr/torchvision patch in the Dockerfile —
   verify it matches the torchvision the base image ships).
2. **CUDA is live:** `python -c "import torch; assert torch.cuda.is_available()"` in the image.
3. **One hq variant end-to-end** on a test clip → confirm the output is sharp and
   **`quality.spatial_ok is True`** (the spatial-corruption guard passed on real NVIDIA
   output — this is the whole point; a garbled upscale must be caught and dropped, not shipped).
4. **Idempotency across invocations:** run the sweep twice; the second reports `skipped` and
   uploads nothing new (proves the volume-backed ledger persists).

## Known unknowns / pitfalls
- **torch/torchvision/basicsr compatibility** is the most likely breakage; pin versions once a
  working combination is found on the GPU host.
- Only the **x4plus (photo)** model architecture is wired in `realesrgan_infer.py`.
- `--fp32` is set by the backend for fidelity; drop it for speed once quality is confirmed.
- GPU-time is billed for the whole invocation, including Drive I/O. If that I/O time becomes a
  cost concern, split the orchestrator onto a CPU endpoint that calls this per-video — an
  optimization, not needed for first deploy.

## Control-plane serverless endpoint (GPU runner)

The control plane runs GPU jobs on a RunPod serverless endpoint using
`deploy/runpod/cp_handler.py` (streams per-variant progress). Steps:

1. **Object storage (Cloudflare R2 recommended — zero egress).**
   Create a bucket and an API token. Note: account endpoint URL, bucket name, access key, secret.
   (AWS S3 or RunPod S3 also work — they are the same S3 API; only the endpoint/creds differ.)

2. **Build + push the worker image** (amd64/NVIDIA — not buildable on macOS):
   ```
   docker build -f deploy/runpod/Dockerfile -t <registry>/variant-cp:latest .
   docker push <registry>/variant-cp:latest
   ```
   Build context is the repo root.

3. **Create the RunPod serverless endpoint** from that image.
   > **IMPORTANT — override the default CMD.** The image's baked `CMD` defaults to the Drive-farm
   > handler (`python /app/deploy/runpod/handler.py`). The control-plane endpoint MUST override the
   > container start command; do NOT rely on the default. Set it to:
   > ```
   > python -u deploy/runpod/cp_handler.py
   > ```
   > (The image already includes `boto3` via the `[serverless]` extra — no extra install needed.)

   Set these endpoint environment variables: `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY`,
   `R2_SECRET_KEY`. Note the endpoint id.

4. **Point the control plane at it** (local or Railway):
   ```
   export RUNPOD_ENDPOINT_ID=<hq-id> RUNPOD_API_KEY=<key>
   export RUNPOD_FAST_ENDPOINT_ID=<fast-cpu-id>   # optional until the CPU endpoint exists
   export R2_ENDPOINT=<url> R2_BUCKET=<bucket> R2_ACCESS_KEY=<ak> R2_SECRET_KEY=<sk>
   export VARIANT_RUNNER=runpod
   variant-server --runner runpod
   ```
   On Railway, set the same vars on the Studio service and restart. See
   [`docs/ops/railway-studio.md`](../../docs/ops/railway-studio.md).

5. **Fast CPU endpoint** (all Fast packs; min workers 0). Image:
   `ghcr.io/snaughtyllc-cell/varimo-live/variant-fast:latest` from
   `Dockerfile.fast` (Live Actions). The older Lab package
   `ghcr.io/snaughtyllc-cell/variant-fast` is still what some endpoints
   are digest-pinned to — do not retarget those until a promote.
   CPU, 8+ cores, same `R2_*`, execution timeout 3600s. Do not point HQ at it.

6. **Rotate the RunPod API key** (it was pasted in chat early in the project).
