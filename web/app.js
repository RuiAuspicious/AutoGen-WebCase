const fallbackAgents = [
  {
    id: "product_manager",
    name: "产品经理",
    role: "需求策划",
    color: "#cf5c36",
    description: "负责整理需求、界定 MVP 范围和验收标准。",
    mockReply(prompt, mode) {
      return [
        `我先从用户价值切入。针对“${prompt}”，建议把第一阶段目标聚焦在最小闭环，而不是一次做全。`,
        mode === "planner_first"
          ? "当前模式是“规划优先”，我建议先冻结 MVP 功能清单，再推进技术设计。"
          : "我建议优先明确核心场景、成功指标和首批用户画像。"
      ].join("\n");
    }
  },
  {
    id: "architect",
    name: "架构师",
    role: "系统设计",
    color: "#1f6c5b",
    description: "负责给出前后端架构、模块边界和接口思路。",
    mockReply(prompt, mode) {
      return [
        `从架构视角看，“${prompt}”更适合采用前后端分离。网页前端负责多智能体展示，后端负责调度 AutoGen。`,
        mode === "fast_review"
          ? "如果要快速验证，可以先做静态 UI + 一个统一会话接口，再逐步拆成多角色流式输出。"
          : "建议把会话编排、消息存储、角色配置拆成独立模块，后续扩展更轻松。"
      ].join("\n");
    }
  },
  {
    id: "engineer",
    name: "开发工程师",
    role: "实现拆解",
    color: "#f0a120",
    description: "负责把方案拆成具体页面、接口和交付步骤。",
    mockReply(prompt, mode) {
      return [
        `工程实现上，我会先做一个可直接打开的网页原型，再补一个接口层去对接“${prompt}”对应的真实后端能力。`,
        mode === "round_robin"
          ? "前端建议至少包含角色列表、消息流、输入区、会话状态和模式切换。"
          : "为了提升可维护性，页面状态建议统一管理，避免消息区和角色区各自维护副本。"
      ].join("\n");
    }
  },
  {
    id: "qa",
    name: "测试工程师",
    role: "质量复核",
    color: "#6b4ce6",
    description: "负责检查边界、可用性和交互上的风险点。",
    mockReply(prompt, mode) {
      return [
        `我会重点检查“${prompt}”在多角色逐条回复时的可读性、滚动行为和异常状态提示。`,
        mode === "fast_review"
          ? "快速模式下也要保留空状态、加载态和接口失败提示，不然用户会误以为系统卡死。"
          : "还需要验证在只选中部分智能体时，消息统计、角色标签和展示顺序是否一致。"
      ].join("\n");
    }
  }
];

const STORAGE_KEY = "agent-studio-session-v2";

const state = {
  agents: [...fallbackAgents],
  selectedAgentIds: new Set(fallbackAgents.map((agent) => agent.id)),
  mode: "round_robin",
  messages: 0,
  promptDraft: "",
  sessionStatusText: "等待用户发起新问题",
  timeline: [],
  activeConversationId: 0
};

const modeLabels = {
  round_robin: "轮询协作",
  planner_first: "规划优先",
  fast_review: "快速复核"
};

const agentList = document.querySelector("#agentList");
const conversationBoard = document.querySelector("#conversationBoard");
const bubbleTemplate = document.querySelector("#bubbleTemplate");
const streamPlaceholderTemplate = document.querySelector("#streamPlaceholderTemplate");
const agentCardTemplate = document.querySelector("#agentCardTemplate");
const promptInput = document.querySelector("#promptInput");
const sendButton = document.querySelector("#sendButton");
const clearButton = document.querySelector("#clearButton");
const seedScenarioButton = document.querySelector("#seedScenarioButton");
const metricAgents = document.querySelector("#metricAgents");
const metricMessages = document.querySelector("#metricMessages");
const metricMode = document.querySelector("#metricMode");
const agentCount = document.querySelector("#agentCount");
const sessionStatus = document.querySelector("#sessionStatus");
const debugStatus = document.querySelector("#debugStatus");
const REQUEST_TIMEOUT_MS = Number(window.REQUEST_TIMEOUT_MS || 120000);
const activeRequestControllers = new Map();

function setDebugStatus(message) {
  if (debugStatus) {
    debugStatus.textContent = message;
  }
}

function formatTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}

function toSerializableState() {
  return {
    selectedAgentIds: [...state.selectedAgentIds],
    mode: state.mode,
    messages: state.messages,
    promptDraft: state.promptDraft,
    sessionStatusText: state.sessionStatusText,
    timeline: state.timeline
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSerializableState()));
}

function migrateLegacyConversations(conversations = {}) {
  const timeline = [];
  for (const agent of fallbackAgents) {
    const entries = conversations[agent.id] || [];
    for (const item of entries) {
      const isUser = item.speaker === "用户问题";
      timeline.push({
        id: `${agent.id}-${item.time}-${Math.random().toString(36).slice(2, 8)}`,
        agentId: isUser ? "user" : agent.id,
        speaker: isUser ? "用户" : item.speaker,
        role: isUser ? "用户" : agent.role,
        content: item.content,
        time: item.time,
        type: isUser ? "user" : "agent",
        pending: false
      });
    }
  }
  return timeline;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacyRaw = localStorage.getItem("agent-studio-session-v1");
      if (!legacyRaw) {
        return;
      }
      const legacy = JSON.parse(legacyRaw);
      state.selectedAgentIds = new Set(legacy.selectedAgentIds || fallbackAgents.map((agent) => agent.id));
      state.mode = legacy.mode || "round_robin";
      state.messages = Number(legacy.messages || 0);
      state.promptDraft = legacy.promptDraft || "";
      state.sessionStatusText = legacy.sessionStatusText || "等待用户发起新问题";
      state.timeline = migrateLegacyConversations(legacy.conversations || {});
      ensureSelectedAgents();
      saveState();
      return;
    }

    const saved = JSON.parse(raw);
    state.selectedAgentIds = new Set(saved.selectedAgentIds || fallbackAgents.map((agent) => agent.id));
    state.mode = saved.mode || "round_robin";
    state.messages = Number(saved.messages || 0);
    state.promptDraft = saved.promptDraft || "";
    state.sessionStatusText = saved.sessionStatusText || "等待用户发起新问题";
    state.timeline = Array.isArray(saved.timeline) ? saved.timeline : [];
    ensureSelectedAgents();
  } catch (error) {
    console.warn("Failed to restore saved session.", error);
    setDebugStatus(`恢复本地会话失败：${error.message || error}`);
  }
}

function ensureSelectedAgents() {
  if (state.selectedAgentIds.size > 0) {
    return;
  }
  state.selectedAgentIds = new Set(state.agents.map((agent) => agent.id));
}

function renderMarkdown(container, markdown) {
  const text = String(markdown || "");
  if (!window.marked || !window.DOMPurify) {
    container.textContent = text;
    return;
  }

  marked.setOptions({
    gfm: true,
    breaks: true
  });

  const rawHtml = marked.parse(text);
  const safeHtml = window.DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+\.\-]+(?:[^a-z+\.\-:]|$))/i
  });

  container.innerHTML = safeHtml;
  container.querySelectorAll("table").forEach((table) => {
    const wrapper = document.createElement("div");
    wrapper.className = "table-scroll";
    table.parentNode.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
  container.querySelectorAll("a").forEach((link) => {
    link.target = "_blank";
    link.rel = "noreferrer noopener";
  });
}

function renderAgentCards() {
  agentList.innerHTML = "";
  for (const agent of state.agents) {
    const fragment = agentCardTemplate.content.cloneNode(true);
    const checkbox = fragment.querySelector("input");
    const name = fragment.querySelector(".agent-name");
    const role = fragment.querySelector(".agent-role-tag");
    const description = fragment.querySelector(".agent-description");
    const indicator = fragment.querySelector(".agent-indicator");

    checkbox.checked = state.selectedAgentIds.has(agent.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selectedAgentIds.add(agent.id);
      } else if (state.selectedAgentIds.size > 1) {
        state.selectedAgentIds.delete(agent.id);
      } else {
        checkbox.checked = true;
      }
      renderAgentCards();
      refreshMetrics();
      saveState();
    });

    name.textContent = agent.name;
    role.textContent = agent.role;
    description.textContent = agent.description;
    indicator.style.background = agent.color;
    indicator.style.boxShadow = `0 0 0 6px ${hexToRgba(agent.color, 0.16)}`;
    agentList.appendChild(fragment);
  }
}

function renderTimeline() {
  conversationBoard.innerHTML = "";

  if (state.timeline.length === 0) {
    conversationBoard.appendChild(streamPlaceholderTemplate.content.cloneNode(true));
    return;
  }

  for (const item of state.timeline) {
    const fragment = bubbleTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".chat-row");
    const avatar = fragment.querySelector(".chat-avatar");
    const speaker = fragment.querySelector(".bubble-speaker");
    const role = fragment.querySelector(".bubble-role");
    const time = fragment.querySelector(".bubble-time");
    const content = fragment.querySelector(".bubble-content");
    const agent = state.agents.find((entry) => entry.id === item.agentId);

    row.classList.add(item.type);
    if (item.pending) {
      row.classList.add("thinking");
    }

    speaker.textContent = item.speaker;
    role.textContent = item.role;
    time.textContent = item.time;
    renderMarkdown(content, item.content);

    if (item.type === "user") {
      avatar.textContent = "U";
    } else {
      avatar.textContent = item.speaker.slice(0, 1);
      if (agent?.color) {
        avatar.style.background = `linear-gradient(135deg, ${hexToRgba(agent.color, 0.24)}, rgba(255,255,255,0.35))`;
        avatar.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.45), 0 0 0 1px ${hexToRgba(agent.color, 0.1)}`;
      }
    }

    conversationBoard.appendChild(fragment);
  }

  conversationBoard.scrollTop = conversationBoard.scrollHeight;
}

function appendTimelineMessage({ agentId, speaker, role, content, type, pending = false }) {
  const item = {
    id: `${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    speaker,
    role,
    content,
    time: formatTime(),
    type,
    pending
  };
  state.timeline.push(item);
  if (!pending) {
    state.messages += 1;
  }
  renderTimeline();
  refreshMetrics();
  saveState();
  return item.id;
}

function replaceTimelineMessage(messageId, nextData) {
  const index = state.timeline.findIndex((item) => item.id === messageId);
  if (index < 0) {
    return;
  }
  const current = state.timeline[index];
  state.timeline[index] = {
    ...current,
    ...nextData,
    pending: false,
    time: formatTime()
  };
  state.messages += 1;
  renderTimeline();
  refreshMetrics();
  saveState();
}

function refreshMetrics() {
  const onlineCount = state.selectedAgentIds.size;
  metricAgents.textContent = String(onlineCount);
  metricMessages.textContent = String(state.messages);
  metricMode.textContent = modeLabels[state.mode];
  agentCount.textContent = `${onlineCount} 在线`;
  sessionStatus.textContent = state.sessionStatusText;
}

function setMode(nextMode) {
  state.mode = nextMode;
  document.querySelectorAll(".mode-chip").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === nextMode);
  });
  refreshMetrics();
  saveState();
}

async function dispatchConversation(prompt) {
  ensureSelectedAgents();
  if (state.selectedAgentIds.size === 0) {
    state.sessionStatusText = "当前没有可用智能体，请稍后重试";
    refreshMetrics();
    saveState();
    return;
  }

  const conversationId = ++state.activeConversationId;
  setDebugStatus(`已点击发送，准备向 ${state.selectedAgentIds.size} 个智能体发起请求。`);
  state.sessionStatusText = "智能体正在协同分析你的问题";
  refreshMetrics();
  saveState();

  const activeAgents = state.agents.filter((agent) => state.selectedAgentIds.has(agent.id));
  appendTimelineMessage({
    agentId: "user",
    speaker: "用户",
    role: "用户",
    content: prompt,
    type: "user"
  });

  const tasks = activeAgents.map(async (agent, index) => {
    await delay(120 + index * 120);
    if (conversationId !== state.activeConversationId) {
      return;
    }
    setDebugStatus(`正在请求 ${agent.name}...`);
    const pendingId = appendTimelineMessage({
      agentId: agent.id,
      speaker: agent.name,
      role: `${agent.role} · 思考中`,
      content: "正在整理观点，请稍候...",
      type: "agent",
      pending: true
    });

    const reply = await getSingleAgentReply(agent, prompt, conversationId);
    if (!reply || conversationId !== state.activeConversationId) {
      return;
    }
    setDebugStatus(`${agent.name} 已返回结果。`);
    replaceTimelineMessage(pendingId, {
      speaker: reply.name,
      role: reply.role,
      content: reply.reply
    });
  });

  await Promise.all(tasks);
  if (conversationId !== state.activeConversationId) {
    return;
  }
  setDebugStatus("全部智能体请求已完成。");
  state.sessionStatusText = "本轮讨论已完成，可继续追问或切换参与智能体";
  refreshMetrics();
  saveState();
}

async function getSingleAgentReply(agent, prompt, conversationId) {
  if (!window.SINGLE_AGENT_API_ENDPOINT) {
    return {
      agent_id: agent.id,
      name: agent.name,
      role: agent.role,
      reply: agent.mockReply(prompt, state.mode)
    };
  }

  let timeoutId;
  const controller = new AbortController();
  activeRequestControllers.set(agent.id, controller);
  try {
    setDebugStatus(`POST ${window.SINGLE_AGENT_API_ENDPOINT} -> ${agent.name}`);
    timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetch(window.SINGLE_AGENT_API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        prompt,
        mode: state.mode,
        agent_id: agent.id
      })
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const payload = await response.json();
    if (!payload?.reply?.reply || !payload?.reply?.name || !payload?.reply?.role) {
      throw new Error("Invalid response payload");
    }
    setDebugStatus(`${agent.name} 请求成功，已渲染回复。`);
    return payload.reply;
  } catch (error) {
    console.warn("Falling back to mock agent reply.", error);
    const isTimeout = error.name === "AbortError";
    const isCancelledConversation = isTimeout && conversationId !== state.activeConversationId;
    if (isCancelledConversation) {
      setDebugStatus(`${agent.name} 请求已取消。`);
      return null;
    }
    setDebugStatus(
      isTimeout
        ? `${agent.name} 请求超时，已切换到前端降级回复。`
        : `${agent.name} 请求失败：${error.message || error}`
    );
    state.sessionStatusText = isTimeout
      ? `${agent.name} 响应超时，已切换为降级回复`
      : `${agent.name} 的后端调用失败，当前显示的是本地降级回复`;
    refreshMetrics();
    saveState();
    return {
      agent_id: agent.id,
      name: agent.name,
      role: isTimeout ? `${agent.role} · 降级回复` : `${agent.role} · 降级回复`,
      reply: [
        "后端回复失败，当前内容来自前端本地降级结果。",
        `失败原因：${error.message || error}`,
        "",
        agent.mockReply(prompt, state.mode)
      ].join("\n")
    };
  } finally {
    activeRequestControllers.delete(agent.id);
    clearTimeout(timeoutId);
  }
}

function abortInFlightRequests() {
  for (const controller of activeRequestControllers.values()) {
    controller.abort();
  }
  activeRequestControllers.clear();
}

function clearConversation({ abortRequests = true } = {}) {
  if (abortRequests) {
    state.activeConversationId += 1;
    abortInFlightRequests();
  }
  state.messages = 0;
  state.timeline = [];
  state.sessionStatusText = "等待用户发起新问题";
  renderTimeline();
  refreshMetrics();
  saveState();
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const bigint = parseInt(value, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function syncSidebarMenus() {
  const menus = document.querySelectorAll(".panel-menu");
  menus.forEach((menu) => {
    if (!menu.dataset.initialized) {
      menu.open = false;
      menu.dataset.initialized = "true";
    }
  });
}

document.querySelectorAll(".mode-chip").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

document.querySelectorAll(".suggestion-chip").forEach((button) => {
  button.addEventListener("click", () => {
    promptInput.value = button.textContent;
    state.promptDraft = promptInput.value;
    saveState();
    setDebugStatus("已填入示例问题。");
    promptInput.focus();
  });
});

sendButton.addEventListener("click", async () => {
  setDebugStatus("点击了“发起多智能体讨论”按钮。");
  const prompt = promptInput.value.trim();
  if (!prompt) {
    promptInput.focus();
    setDebugStatus("发送失败：输入框为空。");
    state.sessionStatusText = "请先输入一个问题，再发起讨论";
    refreshMetrics();
    saveState();
    return;
  }

  sendButton.disabled = true;
  sendButton.textContent = "讨论中...";
  try {
    clearConversation();
    await dispatchConversation(prompt);
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = "发起多智能体讨论";
  }
});

clearButton.addEventListener("click", () => {
  clearConversation();
  promptInput.value = "";
  state.promptDraft = "";
  saveState();
  setDebugStatus("已清空会话。");
});

seedScenarioButton.addEventListener("click", () => {
  promptInput.value = "请为一个支持多智能体协作的网页应用设计前端结构、后端接口和上线计划。";
  state.promptDraft = promptInput.value;
  saveState();
  setDebugStatus("已填入预设示例问题。");
  promptInput.focus();
});

promptInput.addEventListener("input", () => {
  state.promptDraft = promptInput.value;
  saveState();
});

window.addEventListener("error", (event) => {
  setDebugStatus(`前端脚本报错：${event.message}`);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason?.message || String(event.reason);
  setDebugStatus(`异步请求异常：${reason}`);
});

loadState();
promptInput.value = state.promptDraft;
renderAgentCards();
renderTimeline();
setMode(state.mode);
refreshMetrics();
syncSidebarMenus();
setDebugStatus("页面初始化完成，等待用户输入。");

async function bootstrapAgents() {
  if (!window.AGENT_LIST_ENDPOINT) {
    return;
  }

  try {
    const response = await fetch(window.AGENT_LIST_ENDPOINT);
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload.agents) || payload.agents.length === 0) {
      return;
    }

    state.agents = payload.agents.map((agent) => {
      const fallback = fallbackAgents.find((item) => item.id === agent.id);
      return {
        ...fallback,
        ...agent,
        mockReply: fallback?.mockReply || (() => "该智能体暂未配置本地模拟回复。")
      };
    });

    const validIds = new Set(state.agents.map((agent) => agent.id));
    const restoredIds = [...state.selectedAgentIds].filter((agentId) => validIds.has(agentId));
    state.selectedAgentIds = new Set(restoredIds.length > 0 ? restoredIds : state.agents.map((agent) => agent.id));
    renderAgentCards();
    renderTimeline();
    refreshMetrics();
    saveState();
  } catch (error) {
    console.warn("Failed to load agents from backend, using fallback agents.", error);
    setDebugStatus(`加载智能体列表失败，已回退到本地配置：${error.message || error}`);
  }
}

bootstrapAgents();
window.addEventListener("resize", syncSidebarMenus);
