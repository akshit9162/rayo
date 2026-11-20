// A stand-in for the Anthropic client that runs each request through `claude -p` on the
// caller's own Claude Code login, so probes can run without an API key. Each call runs in an
// empty folder with only project settings, no tools and no MCP servers, and the site's
// instructions replace the system prompt. Only what probe.mjs uses is implemented.

import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = execFile("claude", args, { cwd, timeout: 300_000, maxBuffer: 16 << 20 }, (err, stdout) => {
      if (err && !stdout) return reject(err);
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error(`claude -p gave no JSON: ${String(stdout).slice(0, 200)}`)); }
    });
    child.stdin.end();
  });
}

export function claudeCliClient({ bin = run } = {}) {
  const create = async ({ model, system, messages, output_config }) => {
    const schema = output_config?.format?.schema;
    const args = ["-p", messages.map((m) => m.content).join("\n\n"), "--model", model, "--system-prompt", system ?? "",
      "--tools", "", "--setting-sources", "project", "--strict-mcp-config", "--no-session-persistence", "--output-format", "json"];
    if (schema) args.push("--json-schema", JSON.stringify(schema));
    const dir = mkdtempSync(join(tmpdir(), "rayo-probe-"));
    try {
      const out = await bin(args, dir);
      if (out.is_error) throw new Error(`claude -p failed: ${out.subtype} ${out.api_error_status ?? ""}`.trim());
      const text = schema && out.structured_output ? JSON.stringify(out.structured_output) : String(out.result ?? "");
      return { content: [{ type: "text", text }], stop_reason: out.stop_reason === "refusal" ? "refusal" : "end_turn" };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  return { beta: { messages: { create: ({ betas, fallbacks, cache_control, max_tokens, ...rest }) => create(rest) } } };
}
