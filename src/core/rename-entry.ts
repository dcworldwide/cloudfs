import path from "node:path";
import type { LocalAdapter } from "../adapters/local";
import { parentPrefix, renamedKey } from "./paths";
import type { AdapterRegistry } from "./registry";
import { selectTransferStrategy } from "./transfer-strategy";
import type { Account, ProviderId } from "./store";

/** Rename inside one provider. FTP uses RNFR/RNTO. S3 copies on the server, then deletes. */
export async function renameEntry(args: {
  local: LocalAdapter;
  registry: AdapterRegistry;
  account: Account | null;
  provider: ProviderId;
  container: string;
  from: string;
  toName: string;
}): Promise<void> {
  const name = args.toName.replace(/[\\/]/g, "").trim();
  if (!name) throw new Error("A name is required.");
  if (args.provider === "local") {
    await args.local.rename(args.from, path.join(path.dirname(args.from), name));
    return;
  }
  if (!args.account) throw new Error("That store is no longer saved.");
  const adapter = args.registry.get(args.provider);
  const parent = parentPrefix(args.provider, args.from);
  const destKey = renamedKey(args.provider, args.from, name);
  const existing = await adapter.list(args.account, args.container, parent);
  if (existing.some((entry) => entry.name === name && entry.key !== args.from)) {
    throw new Error(`"${name}" already exists.`);
  }
  const source = {
    storeId: args.account.id,
    provider: args.provider,
    container: args.container,
    key: args.from,
  };
  const dest = { ...source, key: destKey };
  const streams = adapter.streaming !== false;
  const strategy = selectTransferStrategy({
    kind: "move",
    source,
    dest,
    sourceStreams: streams,
    destStreams: streams,
  });
  if (strategy.kind === "ftp-rename") {
    await adapter.copy(args.account, { from: source, to: dest, move: true });
    const written = await adapter.stat(args.account, args.container, destKey);
    if (!written.exists) throw new Error("Rename could not be verified.");
    return;
  }
  await adapter.copy(args.account, { from: source, to: dest });
  const written = await adapter.stat(args.account, args.container, destKey);
  if (!written.exists) throw new Error("Rename could not be verified.");
  await adapter.remove(args.account, args.container, [args.from]);
}
