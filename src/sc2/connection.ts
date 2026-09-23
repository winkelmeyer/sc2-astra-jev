import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";
import WebSocket from "ws";

const PROTO_DIR = fileURLToPath(new URL("../../proto/", import.meta.url));
const PROTO_FILES = ["sc2api", "common", "data", "debug", "error", "query", "raw", "score", "spatial", "ui"].map(
	(name) => `s2clientprotocol/${name}.proto`,
);

type Decoded = Record<string, unknown>;

export class Sc2Connection {
	private nextId = 1;
	private queue: Promise<unknown> = Promise.resolve();
	private pending: { id: number; resolve: (value: Decoded) => void; reject: (error: Error) => void } | null = null;

	private constructor(
		private readonly socket: WebSocket,
		private readonly requestType: protobuf.Type,
		private readonly responseType: protobuf.Type,
	) {
		socket.on("message", (data: Buffer) => this.onMessage(data));
		socket.on("close", () => this.pending?.reject(new Error("SC2 websocket closed")));
	}

	static async open(port: number, timeoutMs = 60_000): Promise<Sc2Connection> {
		const root = new protobuf.Root();
		root.resolvePath = (_origin, target) => `${PROTO_DIR}${target}`;
		await root.load(PROTO_FILES, { keepCase: false });
		const requestType = root.lookupType("SC2APIProtocol.Request");
		const responseType = root.lookupType("SC2APIProtocol.Response");
		const deadline = Date.now() + timeoutMs;
		while (true) {
			try {
				const socket = await connectOnce(`ws://127.0.0.1:${port}/sc2api`);
				return new Sc2Connection(socket, requestType, responseType);
			} catch (error) {
				if (Date.now() > deadline) throw new Error(`SC2 did not open port ${port}: ${String(error)}`);
				await new Promise((r) => setTimeout(r, 1000));
			}
		}
	}

	request<T = Decoded>(name: string, payload: object = {}): Promise<T> {
		const run = this.queue.then(() => this.send(name, payload));
		this.queue = run.catch(() => undefined);
		return run as Promise<T>;
	}

	close(): void {
		this.socket.close();
	}

	private send(name: string, payload: object): Promise<Decoded> {
		const id = this.nextId++;
		const message = this.requestType.fromObject({ id, [name]: payload });
		const bytes = this.requestType.encode(message).finish();
		return new Promise<Decoded>((resolve, reject) => {
			this.pending = {
				id,
				resolve: (response) => {
					const errors = response.error as string[] | undefined;
					if (errors?.length && response[name] === undefined) {
						reject(new Error(`SC2 ${name} failed: ${errors.join("; ")}`));
						return;
					}
					resolve((response[name] ?? {}) as Decoded);
				},
				reject,
			};
			this.socket.send(bytes);
		});
	}

	private onMessage(data: Buffer): void {
		const decoded = this.responseType.toObject(this.responseType.decode(data), {
			longs: Number,
			enums: Number,
			bytes: Buffer,
			arrays: true,
		}) as Decoded;
		const pending = this.pending;
		if (!pending) throw new Error(`unexpected SC2 response ${JSON.stringify(decoded).slice(0, 200)}`);
		if (decoded.id !== undefined && decoded.id !== pending.id) {
			throw new Error(`SC2 response id ${String(decoded.id)} does not match request ${pending.id}`);
		}
		this.pending = null;
		pending.resolve(decoded);
	}
}

function connectOnce(url: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url, { maxPayload: 1 << 30 });
		socket.once("open", () => resolve(socket));
		socket.once("error", reject);
	});
}
