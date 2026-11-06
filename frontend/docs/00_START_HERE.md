# AUTONEX Bridge — Current Integration Guide

AUTONEX routes hosted model inference **only through 0G Private Computer**. The
Bridge handles role routing, rate limits, retries, and same-provider fallbacks;
it must never send a prompt to another model provider.

## Configuration

Set `ZG_API_KEY` for the Bridge/PAG runtime. The 0G Router endpoint is
`https://router-api.0g.ai/v1` and can be overridden with `ZG_BASE_URL`. Do not
add alternative model-provider keys or endpoints.

The canonical provider and model configuration is:

- `bridge/config/providers.yaml` — 0G Router URL, API key environment variable,
  and gateway limits.
- `bridge/config/models.yaml` — supported 0G model IDs and role fallback chains.
- `backend/profiles/base.json` — 0G catalogue for the PAG terminal agent.

Every model ID must use the `0g/` prefix and map to the `zg_compute` provider.
Fallbacks may select another configured 0G model but never another provider.

## Run and validate

```bash
npm run check
npm run build
cd bridge
python -m pytest -q
```

For frontend development, use `npm run bridge:mock` and `npm run dev`. Configure
the production Bridge with `ZG_API_KEY` before starting live inference.

## Privacy and rate limits

- The agent requests pass through the local gateway; in Docker mode, only its
  proxy receives `ZG_API_KEY`.
- Unknown or non-0G providers are rejected by the egress trust policy.
- Rate-limit values are conservative configuration, not service guarantees.
  Honor 0G response headers and keep the gateway queue bounded.
- Verify current 0G data-handling terms before sending sensitive project data.

See `ARCHITECTURE.md`, `BRIDGE_SPEC.md`, and
`MODEL_ROUTING_AND_RATE_LIMITS.md` for implementation details. Files under
`reference/` are historical background and do not define current provider
support.
