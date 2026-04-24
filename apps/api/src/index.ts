import express from "express";
import { loadConfig } from "./config/index.js";

const config = loadConfig();
const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", env: config.NODE_ENV });
});

app.listen(config.PORT, () => {
  console.log(`fundip api listening on :${config.PORT}`);
});
