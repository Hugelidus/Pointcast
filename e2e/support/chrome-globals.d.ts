/**
 * The few extension APIs that e2e code calls inside `page.evaluate` (running in an extension
 * page or a content script world, where `chrome` exists). Declared here so the e2e files
 * typecheck without pulling the full Chrome typings into the repo root.
 */
declare namespace chrome {
  namespace storage.session {
    function get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  }
  namespace storage.local {
    function get(keys: string | string[] | null): Promise<Record<string, unknown>>;
    function set(items: Record<string, unknown>): Promise<void>;
  }
  namespace downloads {
    interface DownloadItem {
      id: number;
      filename: string;
      url: string;
      state: "in_progress" | "interrupted" | "complete";
    }
    function search(query: object): Promise<DownloadItem[]>;
  }
  namespace action {
    function getBadgeText(details: object): Promise<string>;
    function getBadgeBackgroundColor(details: object): Promise<[number, number, number, number]>;
  }
  namespace commands {
    interface Command {
      name?: string;
      shortcut?: string;
    }
    function getAll(): Promise<Command[]>;
  }
  namespace permissions {
    function request(permissions: { origins?: string[] }): Promise<boolean>;
  }
  namespace runtime {
    function sendMessage(message: unknown): Promise<unknown>;
    function reload(): void;
  }
  namespace tabs {
    interface Tab {
      id?: number;
    }
    function query(query: object): Promise<Tab[]>;
  }
}
