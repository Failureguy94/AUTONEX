<!-- Animated header with walking AI agents -->
<p align="center">
  <img src="assets/autonex_header.svg" alt="AUTONEX animated header with walking AI agents" width="100%">
</p>

<p align="center">
  <img src="assets/autonex_banner.jpg" alt="AUTONEX 3D multi-agent engineering workspace" width="100%">
</p>

<p align="center">
  <a href="https://github.com/pritulsingh/AUTONEX"><img src="https://img.shields.io/badge/AUTONEX-3D_Multi--Agent_Engineering-7b2ff7?style=for-the-badge&logo=rocket&logoColor=white" alt="AUTONEX 3D multi-agent engineering"></a>
  <img src="https://img.shields.io/badge/React-18.3-61dafb?style=flat-square&logo=react" alt="React 18.3">
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.6">
  <img src="https://img.shields.io/badge/Three.js-WebGL_3D_Floor-000000?style=flat-square&logo=threedotjs" alt="Three.js">
  <img src="https://img.shields.io/badge/License-MIT-ff7518?style=flat-square" alt="MIT License">
</p>

# AUTONEX

AUTONEX is a developer project that combines an interactive 3D multi-agent
engineering workspace, agent-runner prototypes, a Python swarm orchestration
engine, and a separate terminal coding assistant (PAG). The 3D office is both
a visual interface and a way to inspect task, agent, event, and deliverable
state.

## What is in this repository

| Component | Location | Purpose |
|---|---|---|
| 3D workspace | `frontend/src/` | React, TypeScript, Three.js and Zustand UI for Office and Swarm modes; built-in simulator is the default |
| TypeScript bridge | `frontend/tools/mock-bridge/` | REST/WebSocket server used by the frontend live mode; includes Office and Swarm run paths |
| Python swarm engine | `bridge/autonex_bridge/swarm/` | FastAPI routes and Python components for swarm rounds, admission, privacy/egress, supervision, verification, and persistence |
| Python gateway core | `bridge/autonex_bridge/gateway/` | Provider/model routing, rate/concurrency control, retries, circuit breaking, and token estimation primitives |
| PAG terminal runner | `backend/` | OpenCode-based terminal coding agent, profiles, plugins, and optional Docker sandbox |
| Optional storage integrations | `frontend/src/services/` | Arkiv and Ethereum Swarm operations used by checkpoint and report workflows |

These are related but distinct runtimes. In particular, the TypeScript live
bridge, Python FastAPI app, and PAG terminal runner are not one interchangeable
server. Some documents under `frontend/docs/` describe a broader planned
integration; see their status notes before treating them as implemented APIs.

## Run the frontend

Requirements: Node.js and npm. Install the frontend dependencies from the
repository root:

```powershell
npm run install:frontend
npm run dev
```

Open `http://localhost:5173`. By default, the frontend runs its built-in
simulation and does not require an API key. To use the TypeScript live bridge,
start it in another terminal and set the Vite variables in
`frontend/.env.local`:

```powershell
cd frontend
npm run bridge
```

```dotenv
VITE_USE_MOCK=false
VITE_API_URL=http://localhost:8000
```

Provide `ZG_API_KEY` to the bridge process (or in `frontend/.env`) for live
0G inference. The existing `bridge:mock` npm script is an alias for the same
TypeScript server; despite its name, normal non-test runs use its live runner.
The convenience PowerShell launcher is `.\scripts\start-all.ps1`.

## Run the Python swarm service

This service is separate from the TypeScript server. Python 3.11 or newer is
required.

```powershell
cd bridge
python -m pip install -e ".[dev]"
python -m uvicorn autonex_bridge.main:app --host 127.0.0.1 --port 8001
```

The service provides health/model routes, swarm run and steering routes,
WebSocket events, and checkpoint endpoints. Its model catalogue and limits are
configured under `bridge/config/`. The gateway package contains reusable
routing and resilience logic; it is not exposed as an OpenAI-compatible proxy
by this FastAPI app. For the current implementation details and boundaries,
see [`bridge/README.md`](bridge/README.md).

## Run PAG

PAG is an independent terminal coding runner. On Windows, launch it with:

```powershell
.\backend\bin\pag.ps1 D:\path\to\project assist
```

Native mode is the default. Add `--docker` to use the optional Docker sandbox,
which runs through WSL. See [`backend/README.md`](backend/README.md) for
configuration and profile details.

## Configuration and integrations

- Frontend browser settings and optional Arkiv/Swarm configuration:
  [`frontend/.env.example`](frontend/.env.example).
- TypeScript bridge inference reads `ZG_API_KEY` from its environment or the
  root/frontend `.env` files.
- Python service configuration templates: [`bridge/config/`](bridge/config).
- PAG configuration and model profiles: [`backend/profiles/`](backend/profiles).
- Arkiv and Swarm checkpoint setup: [`docs/ARKIV_SWARM_ARCHITECTURE.md`](docs/ARKIV_SWARM_ARCHITECTURE.md)
  and [`frontend/docs/IAI_0G_INTEGRATION.md`](frontend/docs/IAI_0G_INTEGRATION.md).

Do not commit credentials. Live inference sends prompt/context data to the
configured hosted model service; review the provider's data-handling terms
before using sensitive repositories. The Python app's wallet-authentication
and iAI status/usage routes include demo responses and are not production
identity or billing services.

## Development checks

Run the frontend type-check and tests:

```powershell
npm run check
```

The Vitest suite includes provider/network integration cases; those can time
out or fail when the configured upstream service is unavailable.

Build the frontend:

```powershell
npm run build
```

Run the Python bridge tests:

```powershell
cd bridge
python -m pytest -q
```

The PAG evaluation scripts and context-plugin tests live under `backend/`.
Generated runs and test outputs should be treated as local artifacts; see
`.gitignore` before adding any generated files.

## Repository map

```text
frontend/
  src/                  3D UI, event/state engine, simulation, storage services
  tools/mock-bridge/    TypeScript HTTP/WebSocket server and run executors
  docs/                 Frontend, integration, and target architecture docs
bridge/
  autonex_bridge/       FastAPI app, swarm engine, gateway primitives
  config/               Model, provider, swarm, persona, and triage YAML
  tests/                Python gateway and swarm tests
backend/
  bin/                  Windows PowerShell PAG launchers
  profiles/             PAG model and permission profiles
  plugins/              OpenCode plugins
  scripts/              Setup, utility, and evaluation scripts
scripts/                Root development launch helpers
```

For the full project description and current architecture, see
[`PROJECT_DETAILED_DESCRIPTION.md`](PROJECT_DETAILED_DESCRIPTION.md).
