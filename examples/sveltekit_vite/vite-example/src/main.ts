import "./app.css";

import { Logger } from "../../../../";
import App from "./App.svelte";

const log: Logger<any> = new Logger();
log.silly("I am a silly log.");

const app = new App({
  target: document.getElementById("app"),
});

export default app;
