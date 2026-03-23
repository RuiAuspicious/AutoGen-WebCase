from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from dotenv import load_dotenv

import autogen


@dataclass(frozen=True)
class AgentSpec:
    id: str
    name: str
    role: str
    color: str
    description: str
    system_message: str


AGENT_SPECS: tuple[AgentSpec, ...] = (
    AgentSpec(
        id="product_manager",
        name="产品经理",
        role="需求策划",
        color="#cf5c36",
        description="负责整理需求、界定 MVP 范围和验收标准。",
        system_message=(
            "你是产品经理，请始终使用中文回答。你负责澄清用户需求、业务目标、MVP 范围和验收标准，"
            "回答要简洁、清晰、可执行。"
        ),
    ),
    AgentSpec(
        id="architect",
        name="架构师",
        role="系统设计",
        color="#1f6c5b",
        description="负责给出前后端架构、模块边界和接口思路。",
        system_message=(
            "你是系统架构师，请始终使用中文回答。你负责设计系统架构、模块边界、数据流和技术选型，"
            "重点说明实际可落地的方案和取舍。"
        ),
    ),
    AgentSpec(
        id="engineer",
        name="开发工程师",
        role="实现拆解",
        color="#f0a120",
        description="负责把方案拆成具体页面、接口和交付步骤。",
        system_message=(
            "你是开发工程师，请始终使用中文回答。你负责把方案拆解成具体模块、接口、实现步骤和里程碑，"
            "确保执行路径明确。"
        ),
    ),
    AgentSpec(
        id="qa",
        name="测试工程师",
        role="质量复核",
        color="#6b4ce6",
        description="负责检查边界、可用性和交互上的风险点。",
        system_message=(
            "你是测试工程师，请始终使用中文回答。你负责检查风险、边界条件、验证策略和上线准备度；"
            "当方案完整且自洽时，请回复 APPROVE。"
        ),
    ),
)

AGENT_SPEC_MAP = {spec.id: spec for spec in AGENT_SPECS}

MODE_GUIDANCE = {
    "round_robin": "请按照常规协作方式回答，输出完整建议。",
    "planner_first": "请优先强调规划、拆解和阶段性方案，再给出细节建议。",
    "fast_review": "请保持回答紧凑，优先指出关键建议和风险点。",
}


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _optional_env(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return value or None


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name, "").strip()
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def load_settings() -> None:
    load_dotenv()


def build_llm_config() -> dict[str, Any]:
    config = {
        "model": _require_env("OPENAI_MODEL"),
        "api_key": _require_env("OPENAI_API_KEY"),
    }
    base_url = _optional_env("OPENAI_BASE_URL")
    if base_url:
        config["base_url"] = base_url

    return {
        "config_list": [config],
        "temperature": 0.4,
        "timeout": _env_int("OPENAI_TIMEOUT", 120),
    }


def list_agents() -> list[dict[str, str]]:
    return [
        {
            "id": spec.id,
            "name": spec.name,
            "role": spec.role,
            "color": spec.color,
            "description": spec.description,
        }
        for spec in AGENT_SPECS
    ]


def create_assistant_agent(agent_id: str) -> autogen.AssistantAgent:
    spec = AGENT_SPEC_MAP[agent_id]
    return autogen.AssistantAgent(
        name=spec.id,
        system_message=spec.system_message,
        llm_config=build_llm_config(),
    )


def _compose_prompt(prompt: str, mode: str) -> str:
    return (
        "请全程使用中文回答。\n"
        f"用户问题：{prompt}\n"
        f"协作模式要求：{MODE_GUIDANCE.get(mode, MODE_GUIDANCE['round_robin'])}\n"
        "请根据你当前角色的职责，直接给出你的观点和建议。"
    )


def _normalize_reply(reply: Any) -> str:
    if isinstance(reply, str):
        return reply.strip()
    if isinstance(reply, dict):
        content = reply.get("content")
        if isinstance(content, str):
            return content.strip()
    return str(reply).strip()


def generate_agent_reply(prompt: str, agent_id: str, mode: str) -> dict[str, str]:
    spec = AGENT_SPEC_MAP[agent_id]
    agent = create_assistant_agent(agent_id)
    reply = agent.generate_reply(
        messages=[
            {
                "role": "user",
                "content": _compose_prompt(prompt=prompt, mode=mode),
            }
        ]
    )
    content = _normalize_reply(reply)
    return {
        "agent_id": spec.id,
        "name": spec.name,
        "role": spec.role,
        "reply": content,
    }


def generate_agent_replies(prompt: str, agent_ids: list[str], mode: str) -> list[dict[str, str]]:
    return [generate_agent_reply(prompt=prompt, agent_id=agent_id, mode=mode) for agent_id in agent_ids]
