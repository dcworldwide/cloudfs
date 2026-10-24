import { createServer, type Server, type Socket } from "node:net";

interface FileNode {
  kind: "file";
  body: Buffer;
  modified: Date;
}

interface DirNode {
  kind: "dir";
  children: Map<string, Node>;
  modified: Date;
}

type Node = FileNode | DirNode;

interface DataWait {
  socket: Socket | null;
  server: Server;
  ready: Promise<Socket>;
}

interface Session {
  socket: Socket;
  cwd: string;
  renameFrom: string | null;
  data: DataWait | null;
  buffer: string;
  chain: Promise<void>;
}

export interface FtpFault {
  verb: string;
  code: number;
  message: string;
}

/**
 * Loopback FTP server for tests. It speaks the commands basic-ftp sends
 * (EPSV, LIST, STOR, RETR, RNFR/RNTO) and keeps files in memory.
 */
export class TestFtpServer {
  readonly commands: string[] = [];
  readonly trace: string[] = [];
  port = 0;
  dropNext = false;
  failNext: FtpFault | null = null;
  private readonly denied = new Set<string>();
  private root: DirNode = { kind: "dir", children: new Map(), modified: new Date() };
  private control: Server | null = null;
  private sessions = new Set<Session>();

  async start(): Promise<number> {
    const server = createServer((socket) => this.accept(socket));
    this.control = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("FTP server did not bind.");
    this.port = address.port;
    return this.port;
  }

  async stop(): Promise<void> {
    for (const session of this.sessions) {
      session.socket.destroy();
      session.data?.server.close();
      session.data?.socket?.destroy();
    }
    this.sessions.clear();
    const server = this.control;
    this.control = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  deny(posixPath: string): void {
    this.denied.add(normalize(posixPath));
  }

  allow(posixPath: string): void {
    this.denied.delete(normalize(posixPath));
  }

  write(posixPath: string, body: Buffer | string): void {
    const full = normalize(posixPath);
    this.ensureDir(parentPath(full));
    this.insert(full, { kind: "file", body: Buffer.from(body), modified: new Date() });
  }

  read(posixPath: string): Buffer | undefined {
    const node = this.lookup(normalize(posixPath));
    return node?.kind === "file" ? node.body : undefined;
  }

  exists(posixPath: string): boolean {
    return this.lookup(normalize(posixPath)) != null;
  }

  private accept(socket: Socket): void {
    socket.setEncoding("utf8");
    socket.on("error", () => undefined);
    const session: Session = {
      socket,
      cwd: "/",
      renameFrom: null,
      data: null,
      buffer: "",
      chain: Promise.resolve(),
    };
    this.sessions.add(session);
    this.reply(session, 220, "cloudfs test ftp ready");
    socket.on("data", (chunk: string) => {
      session.buffer += chunk;
      let newline = session.buffer.indexOf("\n");
      while (newline >= 0) {
        const line = session.buffer.slice(0, newline).replace(/\r$/, "");
        session.buffer = session.buffer.slice(newline + 1);
        if (line) session.chain = session.chain.then(() => this.dispatch(session, line)).catch(() => undefined);
        newline = session.buffer.indexOf("\n");
      }
    });
    socket.on("close", () => {
      this.sessions.delete(session);
      void this.closeData(session);
    });
  }

  private async dispatch(session: Session, line: string): Promise<void> {
    const splitAt = line.indexOf(" ");
    const verb = (splitAt === -1 ? line : line.slice(0, splitAt)).toUpperCase();
    const arg = splitAt === -1 ? "" : line.slice(splitAt + 1).trim();
    this.commands.push(verb);
    this.trace.push(`> ${line}`);
    try {
      if (this.failNext?.verb === verb) {
        const fault = this.failNext;
        this.failNext = null;
        this.reply(session, fault.code, fault.message);
        return;
      }
      switch (verb) {
        case "OPTS":
        case "TYPE":
        case "STRU":
        case "NOOP":
        case "SYST":
          this.reply(session, verb === "SYST" ? 215 : 200, verb === "SYST" ? "UNIX Type: L8" : "OK");
          return;
        case "FEAT":
          this.reply(session, 211, "No features");
          return;
        case "USER":
          this.reply(session, 331, "Password required");
          return;
        case "PASS":
          this.reply(session, 230, "Logged in");
          return;
        case "PWD":
          this.reply(session, 257, `"${session.cwd}" is the current directory`);
          return;
        case "CWD":
          await this.cwd(session, arg);
          return;
        case "CDUP":
          await this.cwd(session, "..");
          return;
        case "MKD":
          this.mkdir(session, arg);
          return;
        case "DELE":
          this.dele(session, arg);
          return;
        case "RNFR":
          this.rnfr(session, arg);
          return;
        case "RNTO":
          this.rnto(session, arg);
          return;
        case "SIZE":
          this.size(session, arg);
          return;
        case "EPSV":
          await this.epsv(session);
          return;
        case "PASV":
          await this.pasv(session);
          return;
        case "LIST":
          await this.list(session, arg);
          return;
        case "RETR":
          await this.retr(session, arg);
          return;
        case "STOR":
          await this.stor(session, arg);
          return;
        case "QUIT":
          this.reply(session, 221, "Bye");
          session.socket.end();
          return;
        default:
          this.reply(session, 502, `Unknown ${verb}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed";
      this.reply(session, 451, message);
    }
  }

  private reply(session: Session, code: number, message: string): void {
    this.trace.push(`< ${code} ${message}`);
    if (!session.socket.destroyed) session.socket.write(`${code} ${message}\r\n`);
  }

  private async cwd(session: Session, arg: string): Promise<void> {
    const next = resolvePath(session.cwd, arg || "/");
    const node = this.lookup(next);
    if (node?.kind !== "dir") {
      this.reply(session, 550, "No such directory");
      return;
    }
    session.cwd = next;
    this.reply(session, 250, "Directory changed");
  }

  private mkdir(session: Session, arg: string): void {
    const full = resolvePath(session.cwd, arg);
    if (this.denied.has(full)) {
      this.reply(session, 550, "Permission denied");
      return;
    }
    if (this.lookup(full)) {
      this.reply(session, 550, "File exists");
      return;
    }
    this.ensureDir(full);
    this.reply(session, 257, `"${full}" created`);
  }

  private dele(session: Session, arg: string): void {
    const full = resolvePath(session.cwd, arg);
    if (this.denied.has(full)) {
      this.reply(session, 550, "Permission denied");
      return;
    }
    const located = this.parent(full);
    if (!located || !located.dir.children.has(located.name)) {
      this.reply(session, 550, "No such file");
      return;
    }
    located.dir.children.delete(located.name);
    this.reply(session, 250, "Deleted");
  }

  private rnfr(session: Session, arg: string): void {
    const full = resolvePath(session.cwd, arg);
    if (this.denied.has(full)) {
      this.reply(session, 550, "Permission denied");
      return;
    }
    if (!this.lookup(full)) {
      this.reply(session, 550, "No such file");
      return;
    }
    session.renameFrom = full;
    this.reply(session, 350, "Ready for destination");
  }

  private rnto(session: Session, arg: string): void {
    const from = session.renameFrom;
    session.renameFrom = null;
    if (!from) {
      this.reply(session, 503, "RNFR required");
      return;
    }
    const dest = resolvePath(session.cwd, arg);
    if (this.denied.has(dest)) {
      this.reply(session, 550, "Permission denied");
      return;
    }
    const source = this.parent(from);
    const target = this.parent(dest);
    const node = source?.dir.children.get(source.name);
    if (!source || !node || !target) {
      this.reply(session, 550, "No such file");
      return;
    }
    source.dir.children.delete(source.name);
    target.dir.children.set(target.name, node);
    this.reply(session, 250, "Renamed");
  }

  private size(session: Session, arg: string): void {
    const node = this.lookup(resolvePath(session.cwd, arg));
    if (node?.kind !== "file") {
      this.reply(session, 550, "No such file");
      return;
    }
    this.reply(session, 213, String(node.body.length));
  }

  private async epsv(session: Session): Promise<void> {
    const port = await this.armData(session);
    this.reply(session, 229, `Entering Extended Passive Mode (|||${port}|)`);
  }

  private async pasv(session: Session): Promise<void> {
    const port = await this.armData(session);
    this.reply(session, 227, `Entering Passive Mode (127,0,0,1,${port >> 8},${port & 255})`);
  }

  private async list(session: Session, arg: string): Promise<void> {
    const target = listTarget(session.cwd, arg);
    if (this.denied.has(target)) {
      this.reply(session, 550, "Permission denied");
      return;
    }
    const node = this.lookup(target);
    if (node?.kind !== "dir") {
      this.reply(session, 550, "No such directory");
      return;
    }
    const lines = [...node.children.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, child]) => formatLine(name, child));
    const payload = lines.length ? `${lines.join("\n")}\n` : "";
    await this.sendData(session, Buffer.from(payload), false);
  }

  private async retr(session: Session, arg: string): Promise<void> {
    const full = resolvePath(session.cwd, arg);
    if (this.denied.has(full)) {
      this.reply(session, 550, "Permission denied");
      return;
    }
    const node = this.lookup(full);
    if (node?.kind !== "file") {
      this.reply(session, 550, "No such file");
      return;
    }
    await this.sendData(session, node.body, true);
  }

  private async stor(session: Session, arg: string): Promise<void> {
    const full = resolvePath(session.cwd, arg);
    if (this.denied.has(full)) {
      this.reply(session, 550, "Permission denied");
      return;
    }
    if (!this.parent(full)) {
      this.reply(session, 550, "No such directory");
      return;
    }
    const socket = await this.takeData(session);
    if (!socket) return;
    if (this.dropNext) {
      this.dropNext = false;
      this.reply(session, 150, "Opening data connection");
      socket.destroy(new Error("ECONNRESET"));
      this.reply(session, 426, "Connection closed; transfer aborted");
      return;
    }
    // Listen before 150. The client does not send bytes until it sees 150.
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      socket.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      socket.on("error", reject);
      socket.on("end", () => resolve(Buffer.concat(chunks)));
    });
    this.reply(session, 150, "Opening data connection");
    const body = await done;
    this.insert(full, { kind: "file", body, modified: new Date() });
    this.reply(session, 226, "Transfer complete");
  }

  private async sendData(session: Session, payload: Buffer, droppable: boolean): Promise<void> {
    const socket = await this.takeData(session);
    if (!socket) return;
    if (droppable && this.dropNext) {
      this.dropNext = false;
      this.reply(session, 150, "Opening data connection");
      socket.destroy(new Error("ECONNRESET"));
      this.reply(session, 426, "Connection closed; transfer aborted");
      return;
    }
    this.reply(session, 150, "Opening data connection");
    await new Promise<void>((resolve, reject) => {
      socket.on("error", reject);
      socket.end(payload, () => resolve());
    });
    this.reply(session, 226, "Transfer complete");
  }

  private async armData(session: Session): Promise<number> {
    await this.closeData(session);
    const server = createServer();
    let resolveReady: (socket: Socket) => void = () => undefined;
    const ready = new Promise<Socket>((resolve) => {
      resolveReady = resolve;
    });
    server.on("connection", (socket) => {
      socket.on("error", () => undefined);
      resolveReady(socket);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    session.data = { socket: null, server, ready };
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("data port missing");
    return address.port;
  }

  private async takeData(session: Session): Promise<Socket | null> {
    const data = session.data;
    if (!data) {
      this.reply(session, 425, "Use PASV or EPSV first");
      return null;
    }
    const socket = await Promise.race([
      data.ready,
      new Promise<Socket>((_resolve, reject) => setTimeout(() => reject(new Error("data connection timed out")), 5000)),
    ]);
    data.socket = socket;
    return socket;
  }

  private async closeData(session: Session): Promise<void> {
    const data = session.data;
    session.data = null;
    if (!data) return;
    data.socket?.destroy();
    await new Promise<void>((resolve) => data.server.close(() => resolve()));
  }

  private ensureDir(full: string): void {
    if (full === "/") return;
    const parts = full.split("/").filter(Boolean);
    let current = this.root;
    for (const part of parts) {
      const next = current.children.get(part);
      if (next?.kind === "dir") {
        current = next;
        continue;
      }
      if (next) throw new Error(`${part} is a file`);
      const created: DirNode = { kind: "dir", children: new Map(), modified: new Date() };
      current.children.set(part, created);
      current = created;
    }
  }

  private insert(full: string, node: Node): void {
    const located = this.parent(full);
    if (!located) throw new Error(`missing parent for ${full}`);
    located.dir.children.set(located.name, node);
  }

  private lookup(full: string): Node | undefined {
    if (full === "/") return this.root;
    const parts = full.split("/").filter(Boolean);
    let current: Node = this.root;
    for (const part of parts) {
      if (current.kind !== "dir") return undefined;
      const next = current.children.get(part);
      if (!next) return undefined;
      current = next;
    }
    return current;
  }

  private parent(full: string): { dir: DirNode; name: string } | undefined {
    const slash = full.lastIndexOf("/");
    const name = full.slice(slash + 1);
    const parent = slash <= 0 ? "/" : full.slice(0, slash);
    const node = this.lookup(parent);
    if (node?.kind !== "dir" || !name) return undefined;
    return { dir: node, name };
  }
}

function normalize(input: string): string {
  return resolvePath("/", input);
}

function parentPath(full: string): string {
  const slash = full.lastIndexOf("/");
  return slash <= 0 ? "/" : full.slice(0, slash);
}

function resolvePath(cwd: string, input: string): string {
  const base = input.startsWith("/") ? input : `${cwd}/${input}`;
  const parts: string[] = [];
  for (const part of base.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function listTarget(cwd: string, arg: string): string {
  const paths = arg
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !token.startsWith("-"));
  return resolvePath(cwd, paths[0] ?? "");
}

function formatLine(name: string, node: Node): string {
  const dir = node.kind === "dir";
  const size = dir ? 0 : node.body.length;
  const stamp = formatStamp(node.modified);
  const mode = dir ? "drwxr-xr-x" : "-rw-r--r--";
  return `${mode} 1 ftp ftp ${size} ${stamp} ${name}`;
}

function formatStamp(date: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[date.getMonth()];
  const day = String(date.getDate()).padStart(2, " ");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month} ${day} ${hours}:${minutes}`;
}
