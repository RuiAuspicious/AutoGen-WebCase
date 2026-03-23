# AutoGen Quickstart

这个项目提供了一个基于 `pyautogen==0.2.35` 的最小可运行多 Agent 示例，总共 5 个参与方：

- 用户代理 `user`
- 产品经理 `product_manager`
- 架构师 `architect`
- 开发工程师 `engineer`
- 测试工程师 `qa`

## 1. 初始化环境

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

## 2. 配置模型

复制环境变量模板并填入你的模型配置：

```powershell
Copy-Item .env.example .env
```

至少需要配置：

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

如果你使用兼容 OpenAI 的第三方接口，也可以设置：

- `OPENAI_BASE_URL`
- `OPENAI_TIMEOUT`（单位：秒，默认 `120`）

火山引擎建议的起步配置：

```env
OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
OPENAI_MODEL=你的接入点 ID 或模型名
OPENAI_TIMEOUT=120
```

## 3. 运行示例

```powershell
python .\src\five_agent_autogen.py
```

脚本启动后会先给出一个默认任务，然后由 4 个 AI Agent 在群聊里协作讨论，`user` 作为外部发起者负责输入补充意见。

## 4. FastAPI 网页版

项目额外提供了一个基于 FastAPI 的多智能体网页应用，既负责托管前端页面，也负责提供多角色回复接口：

```powershell
uvicorn src.fastapi_app:app --reload
```

启动后访问：

- `http://127.0.0.1:8000/`：网页界面
- `http://127.0.0.1:8000/api/agents`：角色列表接口
- `http://127.0.0.1:8000/api/agent-replies`：多智能体回复接口

相关文件包括：

- `web/index.html`：页面结构
- `web/styles.css`：视觉样式
- `web/app.js`：前端交互逻辑
- `src/fastapi_app.py`：FastAPI 应用入口
- `src/agent_service.py`：角色定义与 AutoGen 调用封装

当前网页会优先调用 FastAPI 后端；如果后端暂时不可用，前端会自动退回到本地 mock 回复，方便继续演示页面效果。
前端单个智能体请求默认会等待 120 秒后再判定超时，后端模型调用默认也使用 120 秒超时，可按需通过 `OPENAI_TIMEOUT` 调整。
前端消息使用 `marked` + `DOMPurify` 做 Markdown 渲染与安全清洗，支持 GFM 表格等常见语法；若浏览器无法加载 CDN 资源，会自动退回纯文本显示。

## 5. 示例场景

默认任务是“设计一个面向校园二手交易平台的 MVP 方案”。你可以直接修改 `src/five_agent_autogen.py` 里的 `task` 变量，替换成自己的业务问题。
