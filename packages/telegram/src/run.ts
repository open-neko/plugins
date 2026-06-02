import { runPluginEntrypoint } from "@open-neko/plugin-types";
import plugin from "./plugin.js";
import { preferIpv4 } from "./net-prefs.js";

preferIpv4();
await runPluginEntrypoint(plugin);
