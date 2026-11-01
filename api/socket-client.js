const fs = require("node:fs");
const socketClientPath = require.resolve("socket.io/client-dist/socket.io.js");

module.exports = (_req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  const stream = fs.createReadStream(socketClientPath);
  stream.on("error", (error) => {
    console.error("Could not read the Socket.IO browser client:", error);
    if (res.headersSent) res.destroy(error);
    else {
      res.statusCode = 500;
      res.end("Socket.IO client unavailable.");
    }
  });
  stream.pipe(res);
};
