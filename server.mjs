import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStrategy, extractProfile, fetchPage, fetchPageViaBrowser } from "./coconala-analyzer.mjs";
import { collectLoggedInAnalytics } from "./logged-in-analytics.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT || 4173);

function send(res, status, body, contentType) {
  res.writeHead(status, {
    "content-type": `${contentType}; charset=utf-8`,
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, JSON.stringify(body), "application/json");
}

function isCoconalaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)coconala\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml"
};

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/api/analyze") {
      const target = requestUrl.searchParams.get("url");
      if (!target || !isCoconalaUrl(target)) {
        sendJson(res, 400, { error: "https://coconala.com/ のURLを指定してください。" });
        return;
      }
      let html;
      try {
        html = await fetchPage(target);
      } catch (directError) {
        try {
          html = await fetchPageViaBrowser(target);
        } catch {
          throw new Error("ココナラ側が直接取得を制限しています。起動.cmd で開いた専用ブラウザを起動したまま、もう一度お試しください。");
        }
      }
      const data = extractProfile(html, target);
      data.strategy = buildStrategy(data);
      sendJson(res, 200, data);
      return;
    }

    if (requestUrl.pathname === "/api/login-analyze" && req.method === "POST") {
      const analysis = await collectLoggedInAnalytics();
      sendJson(res, 200, analysis);
      return;
    }

    const requestedPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
    const safePath = resolve(root, `.${requestedPath}`);
    if (!safePath.startsWith(root)) {
      send(res, 403, "Forbidden", "text/plain");
      return;
    }
    const content = await readFile(safePath);
    send(res, 200, content, mime[extname(safePath)] || "application/octet-stream");
  } catch (error) {
    const status = error.name === "AbortError" ? 504 : 500;
    sendJson(res, status, { error: error.message || "分析中にエラーが発生しました。" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ココナラ分析ツール: http://127.0.0.1:${port}`);
});
