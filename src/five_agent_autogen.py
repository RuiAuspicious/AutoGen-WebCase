import os
import sys

import autogen
from src.agent_service import AGENT_SPECS, build_llm_config, load_settings


def main() -> None:
    load_settings()
    llm_config = build_llm_config()

    user = autogen.UserProxyAgent(
        name="user",
        system_message="你是项目需求提出者，负责补充目标、约束和优先级信息。",
        human_input_mode="ALWAYS",
        code_execution_config=False,
    )

    assistants = [
        autogen.AssistantAgent(
            name=spec.id,
            system_message=spec.system_message,
            llm_config=llm_config,
        )
        for spec in AGENT_SPECS
    ]

    groupchat = autogen.GroupChat(
        agents=assistants,
        messages=[],
        max_round=20,
        speaker_selection_method="round_robin",
    )

    manager = autogen.GroupChatManager(
        groupchat=groupchat,
        llm_config=llm_config,
        system_message=(
            "你是多 Agent 讨论的协调者，请始终使用中文回答。你负责推动讨论节奏，帮助团队围绕 "
            "MVP 方案持续收敛。"
        ),
    )

    default_task = (
        "我们需要设计一个校园二手交易平台的 MVP 方案。请围绕目标用户、核心功能、系统设计、"
        "实现里程碑和测试计划展开讨论，并且全程使用中文交流。当方案完整且自洽时，由 QA 回复 "
        "APPROVE。"
    )
    task = " ".join(sys.argv[1:]).strip() or default_task

    print("Five-agent AutoGen demo is starting.")
    print("When the user agent is prompted, type your feedback in the terminal.")
    print("Press Ctrl+C if you want to stop early.\n")

    user.initiate_chat(manager, message=task)


if __name__ == "__main__":
    main()
