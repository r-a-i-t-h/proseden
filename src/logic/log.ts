/** Operator-facing logs for quest / flag logic (never user-facing). */

export function logQuestFault(scope: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? `\n${err.stack}` : "";
  console.error(`[proseden:quest] ${scope}: ${detail}${stack}`);
}
