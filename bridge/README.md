# bridge/ — AUTONEX Bridge Server

**Implemented and tested here:** the **Provider Gateway core** — `autonex_bridge/gateway/` (token-bucket limiter with safety margin, sliding TPM window,
priority queue with aging, per-lane concurrency + global cap, 429/Retry-After handling with AIMD, 5xx retry → fallback chain, context-aware routing,
circuit breaker, auth-dead providers, token estimator, `gate.state` / `llm.call_*` events).
**Specified in documentation:** REST/WS API + tape, triage, planner, scheduler, org, workers, AUTONEX launcher + plugin, privacy gate, and the HTTP/SSE layer + real provider adapters of the Gateway.

```bash
cd bridge
pip install -e ".[dev]"      # or: pip install pytest pytest-asyncio pyyaml
python -m pytest -q          # 16 gateway tests (fake clock + a fake provider that strictly enforces its own rpm)
```
Config templates: `config/{providers,models,departments,triage}.yaml`, `.env.example`.
The numbers in `providers.yaml` are **placeholders**; calibrate (docs/MODEL_ROUTING_AND_RATE_LIMITS.md §9).
