"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// server.ts
var server_exports = {};
module.exports = __toCommonJS(server_exports);
var http = __toESM(require("node:http"));
var vm = __toESM(require("node:vm"));
var cp = __toESM(require("node:child_process"));
var crypto = __toESM(require("node:crypto"));
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var os = __toESM(require("node:os"));

// lib/router.ts
var CODE_RE = /\b(code|function|class|bug|debug|implement|typescript|python|javascript|rust|go|sql|api|refactor|test|error|exception|compile|build|deploy|script|module|import|export|variable|loop|array|object|type|interface|async|await|promise|callback|hook|component)\b/i;
var CODE_SYNTAX_RE = /```|def |const |let |var |import |export |class |function |=>|==|!=|>=|<=|\?\?|\|\||&&/;
var REASONING_RE = /\b(analyze|analyse|reason|explain why|compare|evaluate|critique|pros and cons|trade.?off|hypothesis|prove|derive|calculate|should i|which is better|what if|is it|why does|how does|difference between|versus|vs\.?)\b/i;
var WRITING_RE = /\b(write|draft|email|letter|essay|blog|post|message|summarize|summarise|rewrite|improve|edit|compose|create a.*doc|proposal|report|cover letter|announcement)\b/i;
var RESEARCH_RE = /\b(research|find|search|look up|what is|who is|when did|how does|latest|news|current|recent|tell me about|overview of|history of|explain)\b/i;
function classifyTask(content) {
  const t = content.toLowerCase();
  if (CODE_RE.test(t) || CODE_SYNTAX_RE.test(content)) return "coding";
  if (REASONING_RE.test(t)) return "reasoning";
  if (WRITING_RE.test(t)) return "writing";
  if (RESEARCH_RE.test(t)) return "research";
  const words = content.trim().split(/\s+/).length;
  if (words < 25) return "chat";
  return "general";
}
var ROUTING_TABLE = {
  chat: {
    domain: "conversation",
    localModel: "llama3.2:3b",
    fallbackModel: "qwen2.5:7b",
    cloudModel: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    specialistAgents: ["governance-sentinel"],
    policyDecision: "allow",
    evidenceRequired: true,
    rationale: "Fast conversational exchange \u2014 conductor model for low-latency response."
  },
  coding: {
    domain: "engineering",
    localModel: "qwen2.5-coder:7b",
    fallbackModel: "qwen2.5:7b",
    cloudModel: { provider: "anthropic", model: "claude-sonnet-4-6" },
    specialistAgents: ["coding-agent", "governance-sentinel"],
    policyDecision: "allow",
    evidenceRequired: true,
    rationale: "Code-specialized model for implementation, debugging, and review."
  },
  reasoning: {
    domain: "analysis",
    localModel: "deepseek-r1:8b",
    fallbackModel: "qwen2.5:7b",
    cloudModel: { provider: "anthropic", model: "claude-sonnet-4-6" },
    specialistAgents: ["planning-agent", "analytics-agent", "governance-sentinel"],
    policyDecision: "allow",
    evidenceRequired: true,
    rationale: "Reasoning-specialized model for complex analysis and multi-step problems."
  },
  writing: {
    domain: "communications",
    localModel: "qwen2.5:7b",
    fallbackModel: "llama3.2:3b",
    cloudModel: { provider: "anthropic", model: "claude-sonnet-4-6" },
    specialistAgents: ["writing-agent", "governance-sentinel"],
    policyDecision: "allow",
    evidenceRequired: true,
    rationale: "General-purpose model for writing, drafting, and communication tasks."
  },
  research: {
    domain: "knowledge",
    localModel: "qwen2.5:7b",
    fallbackModel: "llama3.2:3b",
    cloudModel: { provider: "anthropic", model: "claude-sonnet-4-6" },
    specialistAgents: ["research-agent", "governance-sentinel"],
    policyDecision: "allow",
    evidenceRequired: true,
    rationale: "General model with tool use for research and knowledge synthesis."
  },
  general: {
    domain: "general",
    localModel: "qwen2.5:7b",
    fallbackModel: "llama3.2:3b",
    cloudModel: { provider: "anthropic", model: "claude-sonnet-4-6" },
    specialistAgents: ["governance-sentinel"],
    policyDecision: "allow",
    evidenceRequired: true,
    rationale: "General-purpose model for open-ended tasks."
  }
};
function buildRouterDecision(opts) {
  const {
    requestId,
    content,
    ollamaAvailable,
    availableModels,
    hasAnthropicKey,
    hasOpenAIKey,
    explicitModelId
  } = opts;
  const task = classifyTask(content);
  const route = ROUTING_TABLE[task];
  if (explicitModelId) {
    const isOllama = !explicitModelId.startsWith("claude") && !explicitModelId.startsWith("gpt") && !explicitModelId.startsWith("o1") && !explicitModelId.startsWith("o3");
    const isOpenAI = explicitModelId.startsWith("gpt") || explicitModelId.startsWith("o1") || explicitModelId.startsWith("o3") || explicitModelId.startsWith("o4");
    const provider = isOllama ? "ollama" : isOpenAI ? "openai" : "anthropic";
    return {
      requestId,
      conductorId: "noetica-conductor",
      task,
      domain: route.domain,
      selectedRoute: explicitModelId,
      routeType: isOllama ? "local_model" : "hosted_balanced",
      fallbackRoute: route.fallbackModel,
      specialistAgents: route.specialistAgents,
      policyDecision: route.policyDecision,
      rationale: `Explicit model override: ${explicitModelId}`,
      evidenceRef: `evidence:${requestId}`,
      auditRef: `audit:${requestId}`,
      controls: FULL_CONTROLS,
      resolvedModel: explicitModelId,
      resolvedProvider: provider
    };
  }
  if (ollamaAvailable) {
    const primary = route.localModel;
    const fallback = route.fallbackModel;
    const modelToUse = isModelAvailable(primary, availableModels) ? primary : isModelAvailable(fallback, availableModels) ? fallback : primary;
    return {
      requestId,
      conductorId: "noetica-conductor",
      task,
      domain: route.domain,
      selectedRoute: modelToUse,
      routeType: "local_model",
      fallbackRoute: fallback,
      specialistAgents: route.specialistAgents,
      policyDecision: route.policyDecision,
      rationale: route.rationale,
      evidenceRef: `evidence:${requestId}`,
      auditRef: `audit:${requestId}`,
      controls: FULL_CONTROLS,
      resolvedModel: modelToUse,
      resolvedProvider: "ollama"
    };
  }
  if (route.cloudModel) {
    const { provider, model } = route.cloudModel;
    const keyAvailable = provider === "anthropic" ? hasAnthropicKey : hasOpenAIKey;
    if (keyAvailable) {
      return {
        requestId,
        conductorId: "noetica-conductor",
        task,
        domain: route.domain,
        selectedRoute: model,
        routeType: "hosted_balanced",
        fallbackRoute: route.fallbackModel,
        specialistAgents: route.specialistAgents,
        policyDecision: route.policyDecision,
        rationale: `Local Ollama unavailable \u2014 routing to cloud augmentation (${provider}/${model}).`,
        evidenceRef: `evidence:${requestId}`,
        auditRef: `audit:${requestId}`,
        controls: FULL_CONTROLS,
        resolvedModel: model,
        resolvedProvider: provider
      };
    }
  }
  if (hasAnthropicKey) {
    return {
      requestId,
      conductorId: "noetica-conductor",
      task,
      domain: route.domain,
      selectedRoute: "claude-sonnet-4-6",
      routeType: "hosted_balanced",
      fallbackRoute: route.fallbackModel,
      specialistAgents: route.specialistAgents,
      policyDecision: route.policyDecision,
      rationale: "Local Ollama unavailable \u2014 routing to Anthropic Claude.",
      evidenceRef: `evidence:${requestId}`,
      auditRef: `audit:${requestId}`,
      controls: FULL_CONTROLS,
      resolvedModel: "claude-sonnet-4-6",
      resolvedProvider: "anthropic"
    };
  }
  if (hasOpenAIKey) {
    return {
      requestId,
      conductorId: "noetica-conductor",
      task,
      domain: route.domain,
      selectedRoute: "gpt-4o",
      routeType: "hosted_balanced",
      fallbackRoute: route.fallbackModel,
      specialistAgents: route.specialistAgents,
      policyDecision: route.policyDecision,
      rationale: "Local Ollama unavailable \u2014 routing to OpenAI GPT-4o.",
      evidenceRef: `evidence:${requestId}`,
      auditRef: `audit:${requestId}`,
      controls: FULL_CONTROLS,
      resolvedModel: "gpt-4o",
      resolvedProvider: "openai"
    };
  }
  throw new Error("No local Ollama runtime and no cloud API key. Start Ollama or add an API key in Settings.");
}
function isModelAvailable(model, available) {
  const base = model.split(":")[0];
  return available.some((m) => m === model || m.startsWith(base));
}
var FULL_CONTROLS = {
  identity: true,
  policy: true,
  evidence: true,
  attestation: true,
  revocation: true,
  audit: true,
  tenant_isolation: true
};
var LOCAL_MODEL_SUITE = [
  {
    name: "llama3.2:3b",
    role: "conductor",
    description: "Fast conversational model \u2014 handles chat and routing",
    priority: 1,
    // pull first so app is usable immediately
    sizeGb: 2
  },
  {
    name: "qwen2.5:7b",
    role: "general",
    description: "General-purpose workhorse \u2014 writing, research, open-ended tasks",
    priority: 2,
    sizeGb: 4.7
  },
  {
    name: "qwen2.5-coder:7b",
    role: "coding",
    description: "Code-specialized model \u2014 implementation, debugging, review",
    priority: 3,
    sizeGb: 4.7
  },
  {
    name: "deepseek-r1:8b",
    role: "reasoning",
    description: "Reasoning model \u2014 analysis, complex problem solving",
    priority: 4,
    sizeGb: 4.9
  }
];

// lib/ollama.ts
var OLLAMA_BASE = process.env["OLLAMA_HOST"] ?? "http://127.0.0.1:11434";
async function isOllamaRunning() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(2e3)
    });
    return res.ok;
  } catch {
    return false;
  }
}
async function listLocalModels() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(3e3)
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.models?.map((m) => m.name) ?? [];
  } catch {
    return [];
  }
}
async function* streamOllama(params) {
  const body = {
    model: params.model,
    stream: true,
    messages: params.messages
  };
  if (params.tools?.length) {
    body["tools"] = params.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }
    }));
    body["tool_choice"] = "auto";
  }
  const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12e4)
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Ollama ${res.status}: ${detail}`);
  }
  if (!res.body) throw new Error("Ollama response body was empty.");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const toolCallMap = /* @__PURE__ */ new Map();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (raw === "[DONE]") {
        if (toolCallMap.size) {
          const calls = Array.from(toolCallMap.entries()).sort(([a], [b]) => a - b).map(([, tc]) => ({
            id: tc.id,
            name: tc.name,
            input: (() => {
              try {
                return JSON.parse(tc.argsJson);
              } catch {
                return {};
              }
            })()
          }));
          yield { type: "tool_calls", calls };
        }
        return;
      }
      if (!raw) continue;
      const p = JSON.parse(raw);
      const delta = p.choices?.[0]?.delta;
      if (delta?.content) yield { type: "text", text: delta.content };
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const ex = toolCallMap.get(tc.index);
          if (!ex) {
            toolCallMap.set(tc.index, {
              id: tc.id ?? `tc-${tc.index}`,
              name: tc.function?.name ?? "",
              argsJson: tc.function?.arguments ?? ""
            });
          } else {
            if (tc.id) ex.id = tc.id;
            if (tc.function?.name) ex.name += tc.function.name;
            if (tc.function?.arguments) ex.argsJson += tc.function.arguments;
          }
        }
      }
    }
  }
}

// server.ts
var PORT = parseInt(process.env["NOETICA_AM_PORT"] ?? "8080", 10);
var VERSION = "0.4.7";
var BUILTIN_TOOLS = [
  {
    name: "web_search",
    description: "Search the web for current information. Returns a ranked list of results with titles, URLs, and snippets.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" }
      },
      required: ["query"]
    }
  },
  {
    name: "generate_image",
    description: "Generate an image from a text description using DALL-E 3. Returns a markdown image tag with the URL.",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Detailed description of the image to generate" }
      },
      required: ["prompt"]
    }
  },
  {
    name: "code_execute",
    description: "Execute Python or JavaScript code. Python sessions are persistent \u2014 variables and imports persist between calls. matplotlib charts are auto-saved. Returns stdout, exit_code, and any generated files as base64.",
    input_schema: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["python", "javascript"] },
        code: { type: "string", description: "The code to execute" },
        session_id: { type: "string", description: "Optional session ID for persistent Python state" }
      },
      required: ["language", "code"]
    }
  },
  {
    name: "read_file",
    description: "Read a local file as text (\u2264 2 MB). Returns the file content.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or home-relative (~) path to the file" }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Write text content to a local file. Creates parent directories as needed.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or home-relative (~) path" },
        content: { type: "string", description: "Text content to write" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "list_directory",
    description: "List files and subdirectories at a path. Returns names, sizes, and types.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path (absolute or ~-relative)" }
      },
      required: ["path"]
    }
  }
];
function sse(res, event, data) {
  res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
}
function setCORSHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
}
async function executeTool(name, input, keys) {
  switch (name) {
    case "web_search": {
      const query = String(input["query"] ?? "");
      return webSearch(query, keys.serper ?? process.env["SERPER_API_KEY"]);
    }
    case "generate_image": {
      const prompt = String(input["prompt"] ?? "");
      const openaiKey = keys.openai ?? process.env["OPENAI_API_KEY"];
      if (!openaiKey) return "Error: No OpenAI API key \u2014 cannot generate image.";
      return generateImage(prompt, openaiKey);
    }
    case "code_execute": {
      const language = String(input["language"] ?? "javascript");
      const code = String(input["code"] ?? "");
      const sessionId = input["session_id"] ? String(input["session_id"]) : void 0;
      return executeCode(language, code, sessionId);
    }
    case "read_file": {
      const rawPath = String(input["path"] ?? "");
      const resolved = rawPath.startsWith("~") ? path.join(os.homedir(), rawPath.slice(1)) : rawPath;
      try {
        const stat = fs.statSync(resolved);
        if (stat.size > 2 * 1024 * 1024) return `Error: File too large (${stat.size} bytes). Max 2 MB.`;
        return fs.readFileSync(resolved, "utf-8");
      } catch (e) {
        return `Error reading file: ${e.message}`;
      }
    }
    case "write_file": {
      const rawPath = String(input["path"] ?? "");
      const content = String(input["content"] ?? "");
      const resolved = rawPath.startsWith("~") ? path.join(os.homedir(), rawPath.slice(1)) : rawPath;
      try {
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, content, "utf-8");
        return `Written ${content.length} characters to ${resolved}`;
      } catch (e) {
        return `Error writing file: ${e.message}`;
      }
    }
    case "list_directory": {
      const rawPath = String(input["path"] ?? ".");
      const resolved = rawPath.startsWith("~") ? path.join(os.homedir(), rawPath.slice(1)) : rawPath;
      try {
        const entries = fs.readdirSync(resolved).map((name2) => {
          const stat = fs.statSync(path.join(resolved, name2));
          return `${stat.isDirectory() ? "d" : "f"}  ${name2}${stat.isDirectory() ? "/" : `  (${stat.size}B)`}`;
        });
        return entries.join("\n") || "(empty directory)";
      } catch (e) {
        return `Error listing directory: ${e.message}`;
      }
    }
    default:
      return `Unknown built-in tool: ${name}`;
  }
}
async function webSearch(query, serperKey) {
  if (serperKey?.trim()) {
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "content-type": "application/json" },
        body: JSON.stringify({ q: query, num: 6 })
      });
      if (res.ok) {
        const data = await res.json();
        const hits = (data.organic ?? []).slice(0, 6);
        if (hits.length) {
          return hits.map((r) => `- [${r.title}](${r.link}): ${r.snippet}`).join("\n");
        }
      }
    } catch {
    }
  }
  try {
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (res.ok) {
      const data = await res.json();
      const parts = [];
      if (data.AbstractText?.trim()) {
        parts.push(`${data.AbstractText} \u2014 ${data.AbstractURL ?? ""}`);
      }
      for (const r of (data.RelatedTopics ?? []).slice(0, 5)) {
        if (r.Text && r.FirstURL) parts.push(`- [${r.Text}](${r.FirstURL})`);
      }
      if (parts.length) return parts.join("\n");
    }
  } catch {
  }
  return `No results found for: "${query}"`;
}
async function generateImage(prompt, openaiKey) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${openaiKey}`
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
      response_format: "url"
    })
  });
  if (!res.ok) {
    const text = await res.text();
    return `Image generation failed (${res.status}): ${text}`;
  }
  const data = await res.json();
  const img = data.data?.[0];
  if (!img?.url) return "Image generation returned no URL.";
  const caption = img.revised_prompt ? `
*${img.revised_prompt}*` : "";
  return `![Generated image](${img.url})${caption}`;
}
var AM_SESSION_DIRS = /* @__PURE__ */ new Map();
function getAmSessionDir(sessionId) {
  if (AM_SESSION_DIRS.has(sessionId)) return AM_SESSION_DIRS.get(sessionId);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `noetica-am-${sessionId.slice(0, 8)}-`));
  AM_SESSION_DIRS.set(sessionId, dir);
  return dir;
}
function executeCode(language, code, sessionId) {
  const TIMEOUT_MS = 3e4;
  const MAX_OUTPUT = 1e5;
  if (language === "javascript") {
    return new Promise((resolve) => {
      const logs = [];
      const consoleMock = {
        log: (...args) => logs.push(args.map(String).join(" ")),
        error: (...args) => logs.push("ERROR: " + args.map(String).join(" ")),
        warn: (...args) => logs.push("WARN: " + args.map(String).join(" ")),
        info: (...args) => logs.push("INFO: " + args.map(String).join(" "))
      };
      const sandbox = {
        console: consoleMock,
        Math,
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Date,
        Error,
        Map,
        Set,
        Promise,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURIComponent,
        decodeURIComponent,
        setTimeout: void 0,
        // blocked in sandbox
        setInterval: void 0,
        fetch: void 0
        // blocked — use web_search for HTTP
      };
      try {
        vm.createContext(sandbox);
        const result = vm.runInContext(code, sandbox, { timeout: TIMEOUT_MS });
        const out = logs.join("\n");
        const resultLine = result !== void 0 && result !== null ? `
Result: ${typeof result === "object" ? JSON.stringify(result, null, 2) : String(result)}` : "";
        const combined = (out + resultLine).trim();
        resolve(combined.slice(0, MAX_OUTPUT) || "(no output)");
      } catch (err) {
        resolve(
          `RuntimeError: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    });
  }
  const sessionDir = sessionId ? getAmSessionDir(sessionId) : os.tmpdir();
  const preamble = `
import sys, os
os.chdir(${JSON.stringify(sessionDir)})
try:
  import matplotlib
  matplotlib.use('Agg')
  import matplotlib.pyplot as plt
  _orig_show = plt.show
  def _patched_show(*a, **kw):
    import datetime
    fname = 'plot_' + datetime.datetime.now().strftime('%H%M%S%f') + '.png'
    plt.savefig(fname, dpi=150, bbox_inches='tight')
    print(f'[chart:{fname}]')
    plt.clf()
  plt.show = _patched_show
except ImportError:
  pass
`;
  const fullCode = preamble + "\n" + code;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const proc = cp.spawn("python3", ["-c", fullCode], {
      cwd: sessionDir,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", MPLBACKEND: "Agg" }
    });
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, TIMEOUT_MS);
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT) proc.kill("SIGPIPE");
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code2) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve("TimeoutError: Python execution exceeded 15 seconds.");
        return;
      }
      const out = stdout.slice(0, MAX_OUTPUT).trimEnd();
      const err = stderr.slice(0, 4e3).trimEnd();
      const parts = [out, err ? `Stderr:
${err}` : ""].filter(Boolean);
      resolve(parts.join("\n\n").trim() || `(exit code ${code2 ?? 0}, no output)`);
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve(`SpawnError: ${e.message} (is python3 installed?)`);
    });
  });
}
async function* streamAnthropic(params) {
  const body = {
    model: params.model,
    max_tokens: params.thinkingBudget ? params.thinkingBudget + 8192 : 8192,
    stream: true,
    messages: params.messages
  };
  if (params.system) body["system"] = params.system;
  if (params.tools?.length) {
    body["tools"] = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema
    }));
  }
  if (params.thinkingBudget) {
    body["thinking"] = { type: "enabled", budget_tokens: params.thinkingBudget };
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
      ...params.thinkingBudget ? { "anthropic-beta": "interleaved-thinking-2025-05-14" } : {}
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Anthropic ${res.status}: ${detail}`);
  }
  if (!res.body) throw new Error("Anthropic response body was empty.");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let inThinking = false;
  let isToolUse = false;
  let currentIdx = -1;
  const toolBlocks = /* @__PURE__ */ new Map();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      const p = JSON.parse(raw);
      if (p.type === "content_block_start") {
        currentIdx = p.index ?? -1;
        inThinking = p.content_block?.type === "thinking";
        isToolUse = p.content_block?.type === "tool_use";
        if (isToolUse && p.content_block?.id && p.content_block?.name) {
          toolBlocks.set(currentIdx, {
            id: p.content_block.id,
            name: p.content_block.name,
            inputJson: ""
          });
        }
      }
      if (p.type === "content_block_stop") {
        inThinking = false;
        isToolUse = false;
      }
      if (p.type === "content_block_delta") {
        if (inThinking && p.delta?.thinking) {
          yield { type: "thinking", text: p.delta.thinking };
        } else if (!inThinking && !isToolUse && p.delta?.text) {
          yield { type: "text", text: p.delta.text };
        } else if (isToolUse && p.delta?.partial_json) {
          const b = toolBlocks.get(currentIdx);
          if (b) b.inputJson += p.delta.partial_json;
        }
      }
      if (p.type === "message_delta" && p.message?.stop_reason === "tool_use") {
        const calls = Array.from(toolBlocks.values()).map((b) => ({
          id: b.id,
          name: b.name,
          input: (() => {
            try {
              return JSON.parse(b.inputJson);
            } catch {
              return {};
            }
          })()
        }));
        if (calls.length) yield { type: "tool_calls", calls };
      }
    }
  }
}
async function* streamOpenAI(params) {
  const body = {
    model: params.model,
    stream: true,
    messages: params.messages
  };
  if (params.tools?.length) {
    body["tools"] = params.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }
    }));
    body["tool_choice"] = "auto";
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenAI ${res.status}: ${detail}`);
  }
  if (!res.body) throw new Error("OpenAI response body was empty.");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const toolCallMap = /* @__PURE__ */ new Map();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (raw === "[DONE]") {
        if (toolCallMap.size) {
          const calls = Array.from(toolCallMap.entries()).sort(([a], [b]) => a - b).map(([, tc]) => ({
            id: tc.id,
            name: tc.name,
            input: (() => {
              try {
                return JSON.parse(tc.argsJson);
              } catch {
                return {};
              }
            })()
          }));
          yield { type: "tool_calls", calls };
        }
        return;
      }
      if (!raw) continue;
      const p = JSON.parse(raw);
      const delta = p.choices?.[0]?.delta;
      if (delta?.content) yield { type: "text", text: delta.content };
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const ex = toolCallMap.get(tc.index);
          if (!ex) {
            toolCallMap.set(tc.index, {
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
              argsJson: tc.function?.arguments ?? ""
            });
          } else {
            if (tc.id) ex.id = tc.id;
            if (tc.function?.name) ex.name += tc.function.name;
            if (tc.function?.arguments) ex.argsJson += tc.function.arguments;
          }
        }
      }
    }
  }
}
async function handleChat(body, res) {
  const keys = body.provider_keys ?? {};
  const anthropicKey = keys.anthropic?.trim() || process.env["ANTHROPIC_API_KEY"] || "";
  const openaiKey = keys.openai?.trim() || process.env["OPENAI_API_KEY"] || "";
  const ollamaUp = await isOllamaRunning();
  const availableModels = ollamaUp ? await listLocalModels() : [];
  const latestUserContent = [...body.messages ?? []].filter((m) => m.role === "user").at(-1)?.content ?? "";
  let routing;
  try {
    routing = buildRouterDecision({
      requestId: crypto.randomUUID(),
      content: latestUserContent,
      ollamaAvailable: ollamaUp,
      availableModels,
      hasAnthropicKey: Boolean(anthropicKey),
      hasOpenAIKey: Boolean(openaiKey),
      explicitModelId: body.model_id
    });
  } catch (err) {
    sse(res, "error", { error: err instanceof Error ? err.message : String(err) });
    return;
  }
  const { resolvedModel: model, resolvedProvider: provider, ...routerDecision } = routing;
  const apiKey = provider === "openai" ? openaiKey : anthropicKey;
  const run_id = crypto.randomUUID();
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const started = Date.now();
  sse(res, "meta", {
    governance: {
      run_id,
      model_routed: model,
      provider,
      policy_admitted: true,
      memory_written: false,
      timestamp,
      agent_machine: true,
      agent_machine_version: VERSION
    }
  });
  const allTools = [...BUILTIN_TOOLS];
  for (const t of body.tools ?? []) {
    if (!allTools.some((b) => b.name === t.name)) allTools.push(t);
  }
  const incomingMessages = (body.messages ?? []).filter(
    (m) => m.role === "user" || m.role === "assistant"
  );
  const MAX_TURNS = 10;
  let fullContent = "";
  let lastToolCalls;
  try {
    if (provider === "ollama") {
      const ollamaMessages = [];
      if (body.system_prompt) {
        ollamaMessages.push({ role: "system", content: body.system_prompt });
      }
      for (const m of incomingMessages) {
        if (m.role === "user") ollamaMessages.push({ role: "user", content: m.content });
        else if (m.role === "assistant") ollamaMessages.push({ role: "assistant", content: m.content });
      }
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        let turnContent = "";
        let turnToolCalls;
        for await (const event of streamOllama({
          model,
          messages: ollamaMessages,
          tools: allTools
        })) {
          if (event.type === "text") {
            turnContent += event.text;
            sse(res, "delta", { delta: event.text });
          } else if (event.type === "tool_calls") {
            turnToolCalls = event.calls;
          }
        }
        fullContent += turnContent;
        if (!turnToolCalls?.length) break;
        sse(res, "tool_calls", { tool_calls: turnToolCalls });
        lastToolCalls = turnToolCalls;
        const toolResults = await Promise.all(
          turnToolCalls.map(async (tc) => ({
            toolCallId: tc.id,
            name: tc.name,
            result: await executeTool(tc.name, tc.input, {
              anthropic: anthropicKey,
              openai: openaiKey,
              serper: keys.serper
            })
          }))
        );
        ollamaMessages.push({
          role: "assistant",
          content: turnContent || null,
          tool_calls: turnToolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.input) }
          }))
        });
        for (const r of toolResults) {
          ollamaMessages.push({
            role: "tool",
            content: r.result,
            tool_call_id: r.toolCallId
          });
        }
      }
    } else if (provider === "anthropic") {
      const anthropicMessages = incomingMessages.map((m) => ({
        role: m.role,
        content: m.content
      }));
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        let turnContent = "";
        let turnToolCalls;
        for await (const event of streamAnthropic({
          model,
          messages: anthropicMessages,
          system: body.system_prompt,
          tools: allTools,
          apiKey,
          thinkingBudget: body.thinking_budget
        })) {
          if (event.type === "text") {
            turnContent += event.text;
            sse(res, "delta", { delta: event.text });
          } else if (event.type === "thinking") {
            sse(res, "thinking_delta", { delta: event.text });
          } else if (event.type === "tool_calls") {
            turnToolCalls = event.calls;
          }
        }
        fullContent += turnContent;
        if (!turnToolCalls?.length) break;
        sse(res, "tool_calls", { tool_calls: turnToolCalls });
        lastToolCalls = turnToolCalls;
        const toolResults = await Promise.all(
          turnToolCalls.map(async (tc) => ({
            toolUseId: tc.id,
            name: tc.name,
            result: await executeTool(tc.name, tc.input, {
              anthropic: anthropicKey,
              openai: openaiKey,
              serper: keys.serper
            })
          }))
        );
        const assistantBlocks = [
          ...turnContent.trim() ? [{ type: "text", text: turnContent }] : [],
          ...turnToolCalls.map((tc) => ({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.input
          }))
        ];
        const resultBlocks = toolResults.map((r) => ({
          type: "tool_result",
          tool_use_id: r.toolUseId,
          content: r.result
        }));
        anthropicMessages.push({ role: "assistant", content: assistantBlocks });
        anthropicMessages.push({ role: "user", content: resultBlocks });
      }
    } else {
      const oaiMessages = [];
      if (body.system_prompt) {
        oaiMessages.push({ role: "system", content: body.system_prompt });
      }
      for (const m of incomingMessages) {
        if (m.role === "user") oaiMessages.push({ role: "user", content: m.content });
        else if (m.role === "assistant") oaiMessages.push({ role: "assistant", content: m.content });
      }
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        let turnContent = "";
        let turnToolCalls;
        for await (const event of streamOpenAI({
          model,
          messages: oaiMessages,
          tools: allTools,
          apiKey
        })) {
          if (event.type === "text") {
            turnContent += event.text;
            sse(res, "delta", { delta: event.text });
          } else if (event.type === "tool_calls") {
            turnToolCalls = event.calls;
          }
        }
        fullContent += turnContent;
        if (!turnToolCalls?.length) break;
        sse(res, "tool_calls", { tool_calls: turnToolCalls });
        lastToolCalls = turnToolCalls;
        const toolResults = await Promise.all(
          turnToolCalls.map(async (tc) => ({
            toolCallId: tc.id,
            name: tc.name,
            result: await executeTool(tc.name, tc.input, {
              anthropic: anthropicKey,
              openai: openaiKey,
              serper: keys.serper
            })
          }))
        );
        oaiMessages.push({
          role: "assistant",
          content: turnContent || null,
          tool_calls: turnToolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.input) }
          }))
        });
        for (const r of toolResults) {
          oaiMessages.push({
            role: "tool",
            content: r.result,
            tool_call_id: r.toolCallId
          });
        }
      }
    }
    sse(res, "done", {
      result: {
        run_id,
        content: fullContent,
        model_routed: model,
        provider,
        policy_admitted: true,
        memory_written: false,
        tool_calls: lastToolCalls,
        stop_reason: "end_turn",
        timestamp,
        latency_ms: Date.now() - started,
        agent_machine: true,
        agent_machine_version: VERSION
      }
    });
  } catch (err) {
    sse(res, "error", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
var server = http.createServer((req, res) => {
  setCORSHeaders(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (req.method === "GET" && url.pathname === "/api/status") {
    void (async () => {
      const ollamaUp = await isOllamaRunning();
      const localModels = ollamaUp ? await listLocalModels() : [];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          version: VERSION,
          description: "Noetica Agent Machine \u2014 local-first agentic runtime",
          localFirst: true,
          ollama: { running: ollamaUp, models: localModels },
          modelSuite: LOCAL_MODEL_SUITE,
          tools: BUILTIN_TOOLS.map((t) => t.name),
          mode: "agent-machine",
          capabilities: ["streaming", "tool_use", "vision", "code_execute", "web_search", "generate_image"]
        })
      );
    })();
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/models") {
    void (async () => {
      const ollamaUp = await isOllamaRunning();
      const pulledModels = ollamaUp ? await listLocalModels() : [];
      const suite = LOCAL_MODEL_SUITE.map((m) => ({
        ...m,
        pulled: pulledModels.some((p) => p === m.name || p.startsWith(m.name.split(":")[0])),
        ollamaRunning: ollamaUp
      }));
      const allPulled = suite.every((m) => m.pulled);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ollamaRunning: ollamaUp, allPulled, models: suite }));
    })();
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/chat") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_json" }));
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive"
      });
      handleChat(parsed, res).catch((err) => {
        try {
          sse(res, "error", { error: err instanceof Error ? err.message : String(err) });
        } catch {
        }
      }).finally(() => {
        try {
          res.end();
        } catch {
        }
      });
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found", path: url.pathname }));
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[noetica-am] Agent Machine v${VERSION} listening on http://127.0.0.1:${PORT}`);
  console.log(`[noetica-am] Status: http://127.0.0.1:${PORT}/api/status`);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[noetica-am] Port ${PORT} is already in use. Set NOETICA_AM_PORT to use a different port.`);
  } else {
    console.error(`[noetica-am] Server error:`, err);
  }
  process.exit(1);
});
