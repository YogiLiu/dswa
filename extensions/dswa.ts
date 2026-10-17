import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createFetchTool } from "../src/fetch.ts";
import { createSearchTool } from "../src/search.ts";

/** Register the DeepSeek Web Access tools with Pi. */
export default function dswa(pi: ExtensionAPI): void {
  pi.registerTool(createSearchTool());
  pi.registerTool(createFetchTool());
}
