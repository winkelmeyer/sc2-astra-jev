import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Commander } from "./army/engagement.ts";
import { SquadManager, squadCenter } from "./army/squads.ts";
import type { Squad } from "./army/types.ts";
import { Tactician } from "./brain/tactician.ts";
import { JEV_INTERVAL_LOOPS, SC2_PORT, SC2_ROOT, STEP_SIZE } from "./config.ts";
import { describeCommands } from "./hud/describe.ts";
import { drawOverlay } from "./hud/overlay.ts";
import { GameLog } from "./log.ts";
import { Macro } from "./macro/buildOrder.ts";
import { microObserver, microSquad } from "./micro/behaviors.ts";
import { CommandCache } from "./micro/commandCache.ts";
import { Sc2Client } from "./sc2/client.ts";
import { Sc2Connection } from "./sc2/connection.ts";
import { Difficulty, GameResult, Race } from "./sc2/ids.ts";
import { launchSc2 } from "./sc2/launcher.ts";
import type { Command } from "./sc2/types.ts";
import { GameContext } from "./state/context.ts";
import { EnemyMemory, World } from "./state/world.ts";

const MACRO_INTERVAL_LOOPS = 8;

const { values: args } = parseArgs({
	options: {
		map: { type: "string", default: "Ladder2019Season3/AcropolisLE.SC2Map" },
		race: { type: "string", default: "Random" },
		difficulty: { type: "string", default: "Medium" },
		realtime: { type: "boolean", default: false },
		"no-llm": { type: "boolean", default: false },
		smoke: { type: "boolean", default: false },
		"max-loops": { type: "string" },
	},
});

function enumValue<T extends Record<string, number>>(table: T, key: string, label: string): number {
	const match = Object.entries(table).find(([name]) => name.toLowerCase() === key.toLowerCase());
	if (!match) throw new Error(`unknown ${label} "${key}", expected one of ${Object.keys(table).join(", ")}`);
	return match[1];
}

const useLlm = !args["no-llm"] && !args.smoke;
const maxLoops = args.smoke ? 400 * STEP_SIZE : args["max-loops"] ? Number(args["max-loops"]) : Number.POSITIVE_INFINITY;
const realtime = args.realtime;

const log = new GameLog();
const sc2 = launchSc2(SC2_PORT);
const client = new Sc2Client(await Sc2Connection.open(SC2_PORT));
await client.createGame({
	mapPath: join(SC2_ROOT, "Maps", args.map),
	enemyRace: enumValue(Race, args.race, "race"),
	difficulty: enumValue(Difficulty, args.difficulty, "difficulty"),
	realtime,
});
const playerId = await client.joinGame();
const info = await client.gameInfo();
const first = await client.observe();
const ctx = await GameContext.build(client, info, first.observation.rawData.units ?? []);
log.write({ type: "start", map: info.mapName, race: args.race, difficulty: args.difficulty, realtime, useLlm, expansions: ctx.expansions.map((e) => ({ x: e.pos.x, y: e.pos.y, d: Math.round(e.groundDistance) })) });
console.log(`[game] ${info.mapName} vs ${args.race} ${args.difficulty} | llm=${useLlm} realtime=${realtime} | log ${log.path}`);

const memory = new EnemyMemory();
const macro = new Macro(client, ctx);
const squadManager = new SquadManager();
const commander = new Commander(log, useLlm);
const tactician = new Tactician(client, log, useLlm);
const cache = new CommandCache();
let lastMacro = -MACRO_INTERVAL_LOOPS;
let lastJev = -JEV_INTERVAL_LOOPS;
let pendingJev: Promise<void> | null = null;
let result: number = GameResult.Undecided;
let finalLoop = 0;

while (true) {
	const response = await client.observe();
	const outcome = response.playerResult?.find((r) => r.playerId === playerId);
	finalLoop = response.observation.gameLoop;
	if (outcome) {
		result = outcome.result;
		break;
	}
	if (finalLoop >= maxLoops) break;

	const world = new World(ctx, response.observation, memory);
	if (world.loop % 1344 < STEP_SIZE) {
		const status = { loop: world.loop, supply: `${world.supplyUsed}/${world.supplyCap}`, army: world.armySupply, probes: world.probes.length, bases: world.nexuses.length, gates: world.all(62).length + world.all(133).length, minerals: world.minerals, gas: world.gas, mode: commander.mode, costUsd: Number(log.cost.total.toFixed(4)), marketCostUsd: Number(log.cost.marketTotal.toFixed(4)) };
		log.write({ type: "status", ...status });
		console.log(`[status] ${JSON.stringify(status)}`);
	}
	const squads = squadManager.update(world);
	commander.update(world, squads);
	const rally = commander.rally(world);
	const commands: Command[] = [];

	if (world.loop - lastMacro >= MACRO_INTERVAL_LOOPS) {
		lastMacro = world.loop;
		commands.push(...(await macro.tick(world, rally)));
	}

	if (world.loop - lastJev >= JEV_INTERVAL_LOOPS && !pendingJev) {
		lastJev = world.loop;
		pendingJev = tactician.tick(world, squads, commander).finally(() => {
			pendingJev = null;
		});
		if (!realtime) await pendingJev;
		await drawOverlay(client, world, commander, squads, log);
	}

	const main = largest(squads);
	const anchor = main ? squadCenter(main) : undefined;
	const retreatTo = commander.retreatPoint(world);
	for (const squad of squads) {
		if (squad.units.length === 0) continue;
		const orders = commander.ordersFor(world, squad);
		commands.push(...microSquad(squad, { world, orders, retreatTo, blinkReady: tactician.blinkReady, anchor: squad === main ? undefined : anchor }));
	}
	commands.push(...microObserver(world, commander.objective(world), anchor));

	const issued = cache.filter(commands, world.loop);
	for (const line of describeCommands(issued)) log.feed.push(world.loop, "build", line);
	await client.act(issued);
	if (!realtime) await client.step(STEP_SIZE);
}

const resultName = Object.entries(GameResult).find(([, v]) => v === result)?.[0] ?? String(result);
mkdirSync("replays", { recursive: true });
const replayPath = join("replays", `${info.mapName.replace(/\W+/g, "")}-${args.race}-${args.difficulty}-${resultName}-${Date.now()}.SC2Replay`);
writeFileSync(replayPath, await client.saveReplay());
const summary = { result: resultName, gameTime: `${Math.floor(finalLoop / 22.4 / 60)}:${String(Math.floor(finalLoop / 22.4) % 60).padStart(2, "0")}`, loops: finalLoop, replay: replayPath, ...log.summary() };
log.write({ type: "end", ...summary });
console.log(`[game] ${JSON.stringify(summary)}`);
await client.leave();
await client.quit();
sc2.kill("SIGKILL");
process.exit(0);

function largest(squads: Squad[]): Squad | undefined {
	return squads.filter((s) => s.kind !== "sentry" && s.units.length > 0).sort((a, b) => b.units.length - a.units.length)[0];
}

