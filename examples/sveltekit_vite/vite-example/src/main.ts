import "./app.css";
import App from "./App.svelte";

import { Logger } from "../../../../";
const log: Logger<any> = new Logger();
log.silly("I am a silly log.");

const app = new App({
  target: document.getElementById("app"),
});

export default app;
