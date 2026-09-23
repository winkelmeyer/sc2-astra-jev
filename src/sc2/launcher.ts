import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SC2_ROOT } from "../config.ts";

function latestBinary(): string {
	const versions = readdirSync(join(SC2_ROOT, "Versions"))
		.filter((name) => name.startsWith("Base"))
		.sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)));
	if (versions.length === 0) throw new Error(`no SC2 build under ${SC2_ROOT}/Versions`);
	return join(SC2_ROOT, "Versions", versions[0], "SC2.app", "Contents", "MacOS", "SC2");
}

export function launchSc2(port: number): ChildProcess {
	const binary = latestBinary();
	const child = spawn(
		binary,
		[
			"-listen", "127.0.0.1",
			"-port", String(port),
			"-displayMode", "0",
			"-windowwidth", "1600",
			"-windowheight", "1000",
			"-dataDir", SC2_ROOT,
			"-tempDir", mkdtempSync(join(tmpdir(), "sc2-")),
		],
		{ stdio: ["ignore", "ignore", "pipe"] },
	);
	child.stderr?.on("data", (chunk: Buffer) => {
		const line = chunk.toString().trim();
		if (line) process.stderr.write(`[sc2] ${line}\n`);
	});
	const kill = () => child.kill("SIGKILL");
	process.once("exit", kill);
	process.once("SIGINT", () => {
		kill();
		process.exit(130);
	});
	return child;
}
