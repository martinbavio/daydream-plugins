// mrbavio.css-author's HOST PART: the layout procedures as an MCP
// resource, read from the plugin's own file at request time. The
// `dream-author` prompt — the authoring workflow — is Daydream's own
// (its MCP server registers it; decision #65); this plugin's word
// reaches an agent through its manifest `instructions` section and the
// knowledge tools, which serve the whole corpus while it is enabled.

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { DaydreamHostApi } from "@daydream/plugin-api/host";

import { bodyOf } from "./bridge/body.ts";

export const PROCEDURES_FILE = ["knowledge", "procedures.md"] as const;
export const PROCEDURES_RESOURCE_URI =
  "plugin://mrbavio.css-author/procedures.md";

export default function activate(host: DaydreamHostApi): void {
  const dir = host.plugin.dir;
  const procedures = async (): Promise<string> =>
    bodyOf(await readFile(path.join(dir, ...PROCEDURES_FILE), "utf8"));

  host.registerResource({
    uri: PROCEDURES_RESOURCE_URI,
    name: "procedures",
    title: "Layout procedures",
    description:
      "The css-author plugin's decision procedures — which formatting context, whether a declaration is needed at all, where in the cascade it goes — as text, for a client that reads resources.",
    mimeType: "text/markdown",
    read: procedures,
  });
}
