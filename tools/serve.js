// Dev server for game/ with Range support. usage: node serve.js [port] [root]
const http = require("http");
const fs = require("fs");
const path = require("path");
const port = +process.argv[2] || 8765;
const root = path.resolve(process.argv[3] || path.join(__dirname, "..", "game"));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".webp": "image/webp",
  ".png": "image/png", ".m4a": "audio/mp4", ".mp4": "video/mp4", ".json": "application/json" };

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
    const type = types[path.extname(file).toLowerCase()] || "application/octet-stream";
    const range = req.headers.range;
    const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m[1] ? +m[1] : 0;
      const end = Math.min(m[2] ? +m[2] : st.size - 1, st.size - 1);
      res.writeHead(206, Object.assign(headers, { "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 }));
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, Object.assign(headers, { "Content-Length": st.size }));
      fs.createReadStream(file).pipe(res);
    }
  });
}).listen(port, "127.0.0.1", () => console.log("serving", root, "on", port));
