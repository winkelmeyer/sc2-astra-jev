import type { Commander } from "../army/engagement.ts";
import type { Squad, Stance } from "../army/types.ts";
import { averageHp, gameClock } from "../brain/summary.ts";
import type { GameLog } from "../log.ts";
import type { DebugLine, DebugSphere, DebugText, Sc2Client } from "../sc2/client.ts";
import { centroid } from "../state/geometry.ts";
import type { World } from "../state/world.ts";

export const STANCE_COLORS: Record<Stance, { r: number; g: number; b: number }> = {
	engage: { r: 90, g: 230, b: 110 },
	hold: { r: 250, g: 210, b: 70 },
	retreat: { r: 250, g: 80, b: 80 },
};

const PANEL_X = 0.6;
const LINE = 0.0175;
const WRAP = 78;
const WHITE = { r: 255, g: 255, b: 255 };
const DIM = { r: 160, g: 160, b: 160 };
const BLUE = { r: 120, g: 190, b: 255 };

function bar(p: number | undefined): string {
	if (p === undefined) return "[----------]  -- ";
	const filled = Math.round(p * 10);
	return `[${"|".repeat(filled)}${".".repeat(10 - filled)}] ${p.toFixed(2)}`;
}

function wrap(text: string, width: number): string[] {
	const lines: string[] = [];
	let current = "";
	for (const word of text.split(" ")) {
		if ((current + word).length > width) {
			lines.push(current.trimEnd());
			current = "";
		}
		current += `${word} `;
	}
	if (current.trim()) lines.push(current.trimEnd());
	return lines;
}

function terrainZ(world: World, p: { x: number; y: number }): number {
	return -16 + (32 * world.ctx.height.value(p.x, p.y)) / 255 + 0.5;
}

export async function drawOverlay(client: Sc2Client, world: World, commander: Commander, squads: Squad[], log: GameLog): Promise<void> {
	const texts: DebugText[] = [];
	const lines: DebugLine[] = [];
	const spheres: DebugSphere[] = [];
	let y = 0.02;
	const line = (text: string, color = WHITE) => {
		texts.push({ text, screen: { x: PANEL_X, y }, color });
		y += LINE;
	};

	line(`${gameClock(world.loop)}  army ${world.armySupply}  supply ${world.supplyUsed}/${world.supplyCap}  LLM $${log.cost.total.toFixed(3)} (market $${log.cost.marketTotal.toFixed(3)})`, DIM);
	y += LINE / 2;

	const plan = commander.plan;
	line(`ASTRA (system 2, plans once per engagement)  mode ${commander.mode.toUpperCase()}`, BLUE);
	if (plan) {
		line(`  plan #${commander.planId} ${plan.intent.toUpperCase()}`, BLUE);
		for (const l of wrap(plan.summary, WRAP).slice(0, 2)) line(`  ${l}`, BLUE);
	} else {
		line("  no plan: squads run the scripted default orders", DIM);
	}
	if (commander.pending) line(`  thinking... (${commander.pendingTrigger.slice(0, WRAP - 16)})`, { r: 180, g: 220, b: 255 });
	y += LINE / 2;

	line("ASTRA orders  ->  JEV verdict (system 1, every squad ~2x per game second)", WHITE);
	for (const squad of squads) {
		if (squad.units.length === 0) continue;
		const orders = commander.ordersFor(world, squad);
		const d = squad.decision;
		const age = ((world.loop - d.loop) / 22.4).toFixed(1);
		const source = plan && plan.squads.some((sq) => sq.squadId === squad.id) ? `plan #${commander.planId}` : "default";
		const contact = squad.nearbyEnemies.length > 0 ? `${squad.nearbyEnemies.length} enemies in range` : "no contact, following orders";
		line(`${squad.id} [${orders.role}] ${squad.units.length}u ${averageHp(squad.units)}%hp  (${source})`, WHITE);
		line(`  engage when:  ${orders.engageWhen.slice(0, WRAP - 14)}`, BLUE);
		line(`  retreat when: ${orders.retreatWhen.slice(0, WRAP - 14)}`, BLUE);
		line(
			`  JEV -> ${d.stance.toUpperCase().padEnd(7)} e${bar(d.probabilities.engage)} r${bar(d.probabilities.retreat)}${d.focusType ? ` focus ${d.focusType}` : ""}  ${contact}, ${age}s`,
			STANCE_COLORS[d.stance],
		);

		const center = centroid(squad.units.map((u) => u.pos));
		const z = squad.units[0].pos.z ?? 10;
		lines.push({ from: { ...center, z: z + 0.3 }, to: { ...orders.target, z: terrainZ(world, orders.target) }, color: STANCE_COLORS[d.stance] });
		const p = d.probabilities;
		texts.push({
			text: `${squad.id} ${d.stance.toUpperCase()}${p.engage !== undefined ? ` e${p.engage.toFixed(2)} r${(p.retreat ?? 0).toFixed(2)}` : ""}${d.focusType ? ` >${d.focusType}` : ""}`,
			pos: { ...center, z },
			color: STANCE_COLORS[d.stance],
		});
	}
	y += LINE / 2;

	line("DECISIONS", WHITE);
	const remaining = Math.max(6, Math.floor((0.74 - y) / LINE));
	for (const entry of log.feed.latest(remaining)) {
		const text = `${gameClock(entry.loop)} ${entry.text}`;
		line(text.length > WRAP + 12 ? `${text.slice(0, WRAP + 9)}...` : text, entry.color);
	}

	const target = commander.objective(world);
	const rally = commander.retreatPoint(world);
	spheres.push({ pos: { ...target, z: terrainZ(world, target) }, radius: 2, color: BLUE });
	spheres.push({ pos: { ...rally, z: terrainZ(world, rally) }, radius: 1.5, color: { r: 255, g: 170, b: 60 } });
	texts.push({ text: plan ? `ASTRA target (plan #${commander.planId})` : "default target", pos: { ...target, z: terrainZ(world, target) + 1 }, color: BLUE });
	texts.push({ text: "ASTRA rally", pos: { ...rally, z: terrainZ(world, rally) + 1 }, color: { r: 255, g: 170, b: 60 } });
	await client.drawText(texts, lines, spheres);
}
