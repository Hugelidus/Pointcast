// A named import of one field: the bundle inlines the version string, not the whole package.json.
import { version } from "../package.json";

/** The CLI's version, for `pointcast --version` and the MCP server's handshake. */
export const VERSION: string = version;
