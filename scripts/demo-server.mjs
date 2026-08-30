import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "dist");
const port = 4173;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };

const server = createServer((request, response) => {
  const requested = decodeURIComponent((request.url || "/demo.html").split("?")[0]);
  const relative = requested === "/" ? "demo.html" : requested.replace(/^\/+/, "");
  const file = resolve(root, relative);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  createReadStream(file).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`LearnPilot 自测台：http://localhost:${port}/demo.html`);
  console.log("在 VS Code 按 Ctrl+Shift+P，运行 Simple Browser: Show 后粘贴此地址。");
});
