/**
 * Errors meant to be shown to the user as-is, without a stack trace: they describe a mistake
 * in input (a bad flag, a missing file, a malformed session.json), not a bug in this tool.
 * Shared by every CLI command (transcribe, process) so `main()` has one place to catch them.
 */
export class CliError extends Error {}
