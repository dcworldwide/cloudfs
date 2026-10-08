import type { CloudfsApi } from "../../electron/preload";

export function api(): CloudfsApi {
  const value = (window as unknown as { cloudfs?: CloudfsApi }).cloudfs;
  if (!value) throw new Error("Cloudfs preload is not available.");
  return value;
}
