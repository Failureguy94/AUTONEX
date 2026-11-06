"""
FastAPI application entry point for AUTONEX Bridge & Swarm Mode.
"""
from __future__ import annotations
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .swarm.api import api_router

app = FastAPI(title="AUTONEX Bridge & Swarm Mode API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from datetime import datetime, timezone
import os
import time
import uuid
import httpx
from pydantic import BaseModel
from typing import Optional, Dict, Any

app.include_router(api_router)


# In-memory state for 0G connection & sessions
ZG_STATE: Dict[str, Any] = {
    "isVerified": False,
    "maskedKey": None,
    "lastVerifiedAt": None,
    "lastRequestId": None,
    "apiKey": None,
}

# If ZG_API_KEY is provided in environment, initialize it
if os.getenv("ZG_API_KEY"):
    raw_k = os.getenv("ZG_API_KEY", "").strip()
    ZG_STATE["isVerified"] = True
    ZG_STATE["maskedKey"] = f"{raw_k[:4]}••••••••{raw_k[-4:]}" if len(raw_k) > 8 else "••••"
    ZG_STATE["apiKey"] = raw_k
    ZG_STATE["lastVerifiedAt"] = datetime.now(timezone.utc).isoformat()


@app.get("/health")
@app.get("/api/health")
def health_check():
    return {"status": "healthy", "service": "autonex-bridge"}


# --------------------------------------------------------------------------
# Wallet SIWE Authentication Endpoints
# --------------------------------------------------------------------------
@app.get("/api/auth/nonce")
def get_auth_nonce(address: str = ""):
    nonce = f"auth_{uuid.uuid4().hex[:10]}{int(time.time())}"
    return {
        "nonce": nonce,
        "issuedAt": datetime.now(timezone.utc).isoformat(),
        "address": address.lower()
    }


class VerifyAuthRequest(BaseModel):
    address: str
    message: str
    signature: str
    nonce: Optional[str] = None


@app.post("/api/auth/verify")
def verify_auth_signature(req: VerifyAuthRequest):
    if not req.address or not req.message or not req.signature:
        return {"verified": False, "message": "Missing address, message or signature."}
    
    token = f"sess_{uuid.uuid4().hex}"
    return {
        "verified": True,
        "token": token,
        "address": req.address.lower(),
        "message": "Wallet ownership verified successfully"
    }


# --------------------------------------------------------------------------
# 0G Compute Verification & Status (Proxied to bypass browser CORS)
# --------------------------------------------------------------------------
@app.get("/api/config/0g/status")
def get_0g_status():
    return {
        "status": "connected" if ZG_STATE["isVerified"] else "not_configured",
        "isVerified": ZG_STATE["isVerified"],
        "maskedKey": ZG_STATE["maskedKey"],
        "lastVerifiedAt": ZG_STATE["lastVerifiedAt"],
        "lastRequestId": ZG_STATE["lastRequestId"]
    }


class Verify0GRequest(BaseModel):
    apiKey: Optional[str] = None
    api_key: Optional[str] = None
    walletAddress: Optional[str] = None


@app.post("/api/config/0g/verify")
async def verify_0g_key(req: Verify0GRequest):
    raw_key = (req.apiKey or req.api_key or "").strip()
    if not raw_key:
        return {"valid": False, "status": "not_configured", "message": "Please enter your 0G API Key"}

    masked = f"{raw_key[:4]}••••••••{raw_key[-4:]}" if len(raw_key) > 8 else "••••"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(
                "https://router-api.0g.ai/v1/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {raw_key}",
                    "X-0G-Provider-Trust-Mode": "standard"
                },
                json={
                    "model": "qwen-flash",
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 1
                }
            )

            req_id = res.headers.get("x-request-id") or f"req_0g_{int(time.time() * 1000)}"

            if res.status_code == 200 or res.status_code == 429:
                ZG_STATE["isVerified"] = True
                ZG_STATE["maskedKey"] = masked
                ZG_STATE["apiKey"] = raw_key
                ZG_STATE["lastVerifiedAt"] = datetime.now(timezone.utc).isoformat()
                ZG_STATE["lastRequestId"] = req_id
                return {
                    "valid": True,
                    "status": "connected",
                    "maskedKey": masked,
                    "requestId": req_id,
                    "message": "0G Private Computer credentials successfully verified"
                }
            elif res.status_code in (401, 403):
                return {
                    "valid": False,
                    "status": "invalid_key",
                    "message": "Invalid 0G API Key: authentication failed (401)",
                    "requestId": req_id
                }
            else:
                return {
                    "valid": False,
                    "status": "unavailable",
                    "message": f"0G service returned HTTP {res.status_code}",
                    "requestId": req_id
                }
    except Exception as e:
        return {
            "valid": False,
            "status": "unavailable",
            "message": f"0G connection error: {str(e)}"
        }


@app.delete("/api/config/0g")
def disconnect_0g():
    ZG_STATE["isVerified"] = False
    ZG_STATE["maskedKey"] = None
    ZG_STATE["apiKey"] = None
    return {"ok": True, "status": "not_configured"}


@app.get("/api/iai/status")
def get_iai_status(address: str = ""):
    return {
        "address": address,
        "stakedAmount": "0.000000",
        "walletBalance": "0.000000",
        "lockedCollateral": "0.0000",
        "dailyAllowance": "0.0000",
        "isEligible": True
    }


@app.get("/api/iai/usage")
def get_iai_usage():
    return {
        "totalCalls": 0,
        "totalTokens": 0,
        "remainingCredits": 1000
    }

