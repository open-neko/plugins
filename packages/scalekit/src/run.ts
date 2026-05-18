import { runPluginEntrypoint } from "@open-neko/plugin-types";
import plugin from "./plugin.js";

await runPluginEntrypoint(plugin);
