const CDP_ENDPOINT = "http://127.0.0.1:9222";

async function listTargets(endpoint = CDP_ENDPOINT) {
  const response = await fetch(`${endpoint}/json/list`);
  if (!response.ok) throw new Error("ログイン用ブラウザに接続できません。");
  return response.json();
}

class CdpConnection {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      const message = JSON.parse(raw);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || "ブラウザ操作に失敗しました。"));
      else resolve(message.result);
    });
  }

  async request(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function withCdpPage(task, endpoint = CDP_ENDPOINT) {
  const targets = (await listTargets(endpoint)).filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
  const target = targets.find((item) => /coconala\.com/i.test(item.url || "")) || targets[0];
  if (!target) throw new Error("ログイン用ブラウザのタブが見つかりません。専用ブラウザを起動してください。");
  const connection = new CdpConnection(target.webSocketDebuggerUrl);
  try {
    await connection.request("Runtime.enable");
    await connection.request("Page.enable");
    return await task(connection, target);
  } finally {
    connection.close();
  }
}

async function evaluate(connection, expression) {
  const result = await connection.request("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) throw new Error("ログイン後画面の読み取りに失敗しました。");
  return result.result?.value;
}

async function navigate(connection, url) {
  await connection.request("Page.navigate", { url });
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const state = await evaluate(connection, "({href: location.href, ready: document.readyState})");
    if (state?.ready === "complete") return state;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return evaluate(connection, "({href: location.href, ready: document.readyState})");
}

async function waitForNuxtState(connection, expression, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(connection, expression);
    if (value != null) return value;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

export { evaluate, listTargets, navigate, waitForNuxtState, withCdpPage };
