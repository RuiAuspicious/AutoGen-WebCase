from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from src.agent_service import AGENT_SPEC_MAP, generate_agent_replies, generate_agent_reply, list_agents, load_settings


BASE_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = BASE_DIR / "web"

load_settings()

app = FastAPI(title="AutoGen Agent Studio", version="0.1.0")
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


class AgentReplyRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    mode: str = Field(default="round_robin")
    agent_ids: list[str] = Field(..., min_length=1)


class SingleAgentReplyRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    mode: str = Field(default="round_robin")
    agent_id: str = Field(..., min_length=1)


def _normalized_prompt(prompt: str) -> str:
    normalized = prompt.strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="Prompt must not be blank")
    return normalized


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/agents")
async def get_agents() -> dict[str, list[dict[str, str]]]:
    return {"agents": list_agents()}


@app.post("/api/agent-replies")
async def create_agent_replies(payload: AgentReplyRequest) -> dict[str, object]:
    prompt = _normalized_prompt(payload.prompt)
    invalid_agent_ids = [agent_id for agent_id in payload.agent_ids if agent_id not in AGENT_SPEC_MAP]
    if invalid_agent_ids:
        raise HTTPException(status_code=400, detail=f"Unknown agent ids: {', '.join(invalid_agent_ids)}")

    try:
        replies = await run_in_threadpool(
            generate_agent_replies,
            prompt,
            payload.agent_ids,
            payload.mode,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Agent generation failed: {exc}") from exc

    return {
        "mode": payload.mode,
        "prompt": prompt,
        "replies": replies,
    }


@app.post("/api/agent-reply")
async def create_agent_reply(payload: SingleAgentReplyRequest) -> dict[str, object]:
    prompt = _normalized_prompt(payload.prompt)
    if payload.agent_id not in AGENT_SPEC_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown agent id: {payload.agent_id}")

    try:
        reply = await run_in_threadpool(
            generate_agent_reply,
            prompt,
            payload.agent_id,
            payload.mode,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Agent generation failed: {exc}") from exc

    return {
        "mode": payload.mode,
        "prompt": prompt,
        "reply": reply,
    }
