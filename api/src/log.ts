// Structured logs for both Workers. Each record goes to the console as one object, which
// Workers Logs indexes field by field: query `doc`, `lang` or `error.message` in the
// dashboard or with infra/logs.py.
import { configureSync, getLogger, type Logger, type LogLevel, type LogRecord } from "@logtape/logtape";

/** The console method per level, so that Workers Logs' own level matches */
const METHOD = {
  trace: "debug",
  debug: "debug",
  info: "info",
  warning: "warn",
  error: "error",
  fatal: "error",
} as const satisfies Record<LogLevel, keyof Console>;

/** An Error turns into {} in JSON */
function plain(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack, ...(value.cause === undefined ? {} : { cause: plain(value.cause) }) };
  }
  return value;
}

/** The message with any {placeholders} filled in */
function render(message: readonly unknown[]): string {
  return message.map((part, i) => (i % 2 === 0 ? String(part) : JSON.stringify(plain(part)))).join("");
}

function toConsole(record: LogRecord): void {
  const fields = Object.fromEntries(Object.entries(record.properties).map(([key, value]) => [key, plain(value)]));
  console[METHOD[record.level]]({ ...fields, message: render(record.message), level: record.level, logger: record.category.join(".") });
}

configureSync({
  sinks: { console: toConsole },
  loggers: [
    { category: ["skolia"], sinks: ["console"], lowestLevel: "info" },
    // LogTape's own warnings, e.g. about its configuration
    { category: ["logtape", "meta"], sinks: ["console"], lowestLevel: "warning" },
  ],
});

/** A logger under skolia, e.g. log("ingest") for skolia.ingest */
export function log(name: string): Logger {
  return getLogger(["skolia", name]);
}
