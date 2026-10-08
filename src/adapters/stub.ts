import type { Account, CopyRequest, Entry, GetOptions, PutOptions, StoreAdapter } from "../core/store";
import type { Readable } from "node:stream";

export class UnavailableAdapter implements StoreAdapter {
  available = false;

  constructor(
    readonly id: "azure" | "gcs",
    readonly label: string,
  ) {}

  private refuse(): never {
    throw new Error(`${this.label} is not available yet.`);
  }

  test(_account: Account): Promise<void> {
    this.refuse();
  }
  listContainers(_account: Account): Promise<Entry[]> {
    this.refuse();
  }
  list(_account: Account, _container: string, _prefix: string): Promise<Entry[]> {
    this.refuse();
  }
  put(_account: Account, _container: string, _key: string, _stream: Readable, _opts: PutOptions): Promise<void> {
    this.refuse();
  }
  get(_account: Account, _container: string, _key: string, _opts?: GetOptions): Promise<Readable> {
    this.refuse();
  }
  remove(_account: Account, _container: string, _keys: string[]): Promise<void> {
    this.refuse();
  }
  copy(_account: Account, _request: CopyRequest): Promise<void> {
    this.refuse();
  }
  mkdir(_account: Account, _container: string, _prefix: string): Promise<void> {
    this.refuse();
  }
}
