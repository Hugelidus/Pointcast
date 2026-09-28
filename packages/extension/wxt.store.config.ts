import { pointcastConfig } from "./wxt.config";

/**
 * The Chrome Web Store and Edge Add-ons uploads (`pnpm zip:store`): the production build without
 * the manifest `key`, in .output/chrome-mv3-store, zipped as pointcast-<version>-chrome-store.zip.
 */
export default pointcastConfig({ store: true });
