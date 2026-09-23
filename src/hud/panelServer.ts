import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { Snapshot } from "./snapshot.ts";

const PAGE = readFileSync(new URL("./panel.html", import.meta.url), "utf8");

export class PanelServer {
	private readonly clients = new Set<ServerResponse>();
	private last: string | null = null;

	constructor(readonly port: number) {
		createServer((req, res) => {
			if (req.url === "/events") {
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
				if (this.last) res.write(`data: ${this.last}\n\n`);
				this.clients.add(res);
				req.on("close", () => this.clients.delete(res));
				return;
			}
			if (req.url === "/snapshot.json") {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(this.last ?? "null");
				return;
			}
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			res.end(PAGE);
		}).listen(port, "127.0.0.1");
	}

	get url(): string {
		return `http://127.0.0.1:${this.port}`;
	}

	open(): void {
		execFile("open", [this.url]);
	}

	publish(snapshot: Snapshot | { ended: Record<string, unknown> }): void {
		this.last = JSON.stringify(snapshot);
		for (const client of this.clients) client.write(`data: ${this.last}\n\n`);
	}
}
