import { Platform } from "obsidian";

/*
 * Runs Claude Code (`claude -p`) on the user's subscription, without an API key.
 * Node modules are loaded only when called, because they don't exist on mobile.
 */

type NodeModules = {
  childProcess: typeof import("child_process");
  fs: typeof import("fs");
  os: typeof import("os");
  path: typeof import("path");
};

function node(): NodeModules {
  return {
    childProcess: require("child_process"),
    fs: require("fs"),
    os: require("os"),
    path: require("path"),
  };
}

export function claudeAvailable(): boolean {
  return Platform.isDesktopApp;
}

/** Models to choose from; "" means whatever Claude Code is set to. */
export const CLAUDE_MODELS: [string, string][] = [
  ["", "Claude Code default"],
  ["opus", "Opus — best picks, slowest"],
  ["sonnet", "Sonnet — good and faster"],
  ["haiku", "Haiku — fastest"],
];

export function findClaude(): string {
  const { fs, os, path } = node();
  const candidates = [
    path.join(os.homedir(), ".local/bin/claude"),
    path.join(os.homedir(), ".claude/local/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? "claude";
}

/** Obsidian launched from the Dock doesn't know the shell's PATH. */
function environment(binary: string): NodeJS.ProcessEnv {
  const { os, path } = node();
  const PATH = [
    path.dirname(binary),
    path.join(os.homedir(), ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH ?? "",
  ].join(":");
  return { ...process.env, PATH };
}

export interface ClaudeRun {
  result: Promise<string>;
  abort: () => void;
}

/**
 * A single request with no tools and no saved session: all context goes in the prompt.
 * Resolves with the answer text; on error, rejects with a description.
 */
export function askClaude(binary: string, cwd: string, prompt: string, model: string): ClaudeRun {
  const { childProcess } = node();
  const args = ["-p", "--output-format", "json", "--tools", "", "--no-session-persistence", "--strict-mcp-config"];
  if (model) args.push("--model", model);
  const proc = childProcess.spawn(binary, args, { cwd, env: environment(binary) });
  let aborted = false;

  const result = new Promise<string>((resolve, reject) => {
    let out = "";
    let err = "";
    proc.stdout?.on("data", (d: Buffer) => (out += d.toString("utf8")));
    proc.stderr?.on("data", (d: Buffer) => (err += d.toString("utf8")));
    proc.on("error", (e) =>
      reject(new Error(`Could not start Claude Code (${binary}): ${e.message}. Check the path in settings.`))
    );
    proc.on("close", () => {
      if (aborted) return reject(new Error("Stopped."));
      try {
        const o = JSON.parse(out);
        if (o.is_error) reject(new Error(String(o.result ?? "Claude Code error")));
        else resolve(String(o.result ?? ""));
      } catch {
        reject(new Error(err.trim() || "Claude Code returned no answer."));
      }
    });
  });

  proc.stdin?.write(prompt);
  proc.stdin?.end();
  return {
    result,
    abort: () => {
      aborted = true;
      proc.kill();
    },
  };
}
