import { createApp } from "./app.js";
import { loadConfig } from "./config/index.js";

const config = loadConfig();
const app = createApp({ config });

app.listen(config.PORT, () => {
  console.log(`fundip api listening on :${config.PORT}`);
});
