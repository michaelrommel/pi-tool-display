import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

interface ThemeLike {
  fg(color: string, text: string): string;
}

interface AssistantMessageLike {
  role?: unknown;
  api?: unknown;
  content?: unknown;
}

const THINKING_CHAT_PREFIX = "Thinking: ";
const THINKING_LABEL_PREFIX_PATTERN = /^(?:thinking:\s*)+/i;

const OPENAI_REASONING_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
]);

const ANTHROPIC_REASONING_APIS = new Set([
  "anthropic-messages",
  "anthropic-responses",
  "anthropic-completions",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeApiName(api: unknown): string | undefined {
  if (typeof api !== "string") {
    return undefined;
  }

  const normalized = api.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function shouldPrefixThinkingForApi(api: unknown): boolean {
  const normalizedApi = normalizeApiName(api);
  if (!normalizedApi) {
    return true;
  }

  if (OPENAI_REASONING_APIS.has(normalizedApi)) {
    return true;
  }

  if (ANTHROPIC_REASONING_APIS.has(normalizedApi)) {
    return true;
  }

  if (normalizedApi.startsWith("anthropic-")) {
    return true;
  }

  // Keep OpenAI handling explicit to avoid applying this formatter to
  // unrelated OpenAI transport APIs that may not emit thinking blocks.
  if (normalizedApi.startsWith("openai-")) {
    return false;
  }

  // For non-OpenAI providers, apply the prefix when thinking blocks exist.
  return true;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function formatThinkingLabel(theme: ThemeLike | undefined, thinkingText: string): string {
  if (!theme) {
    return `${THINKING_CHAT_PREFIX}${thinkingText}`;
  }

  const label = theme.fg("accent", THINKING_CHAT_PREFIX.trimEnd());
  const body = theme.fg("thinkingText", thinkingText);
  return `${label} ${body}`;
}

function prefixThinkingLine(text: string, theme: ThemeLike | undefined): string {
  const plainTrimmed = stripAnsi(text).trim();
  if (!plainTrimmed) {
    return text;
  }

  const withoutThinkingPrefix = plainTrimmed
    .replace(THINKING_LABEL_PREFIX_PATTERN, "")
    .trimStart();

  if (withoutThinkingPrefix.length === 0) {
    return theme ? theme.fg("accent", THINKING_CHAT_PREFIX.trimEnd()) : THINKING_CHAT_PREFIX.trimEnd();
  }

  return formatThinkingLabel(theme, withoutThinkingPrefix);
}

function isThinkingBlock(value: unknown): value is Record<string, unknown> & {
  type: "thinking";
  thinking: string;
} {
  if (!isRecord(value)) {
    return false;
  }

  return value.type === "thinking" && typeof value.thinking === "string";
}

function prefixThinkingBlocks(message: AssistantMessageLike, theme: ThemeLike | undefined): void {
  if (!shouldPrefixThinkingForApi(message.api)) {
    return;
  }

  if (!Array.isArray(message.content)) {
    return;
  }

  for (const block of message.content) {
    if (!isThinkingBlock(block)) {
      continue;
    }

    const nextThinking = prefixThinkingLine(block.thinking, theme);
    if (nextThinking !== block.thinking) {
      block.thinking = nextThinking;
    }
  }
}

function extractAssistantMessage(event: unknown): AssistantMessageLike | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  const maybeMessage = event.message;
  if (!isRecord(maybeMessage)) {
    return undefined;
  }

  if (maybeMessage.role !== "assistant") {
    return undefined;
  }

  return maybeMessage as AssistantMessageLike;
}

function handleThinkingMessageEvent(event: unknown, ctx: ExtensionContext | undefined): void {
  try {
    const message = extractAssistantMessage(event);
    if (!message) {
      return;
    }

    prefixThinkingBlocks(message, ctx?.ui?.theme);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    ctx?.ui?.notify(`Thinking label formatting failed: ${message}`, "warning");
  }
}

export function registerThinkingLabeling(pi: ExtensionAPI): void {
  pi.on("message_update", async (event, ctx) => {
    handleThinkingMessageEvent(event, ctx);
  });

  pi.on("message_end", async (event, ctx) => {
    handleThinkingMessageEvent(event, ctx);
  });
}
