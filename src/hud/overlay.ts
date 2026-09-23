import type { Commander } from "../army/engagement.ts";
import type { Squad, Stance } from "../army/types.ts";
import { gameClock } from "../brain/summary.ts";
import type { DebugLine, DebugSphere, DebugText, Sc2Client } from "../sc2/client.ts";
import { centroid } from "../state/geometry.ts";
import type { World } from "../state/world.ts";

export const STANCE_COLORS: Record<Stance, { r: number; g: number; b: number }> = {
	engage: { r: 90, g: 230, b: 110 },
	hold: { r: 250, g: 210, b: 70 },
	retreat: { r: 250, g: 80, b: 80 },
};

const BLUE = { r: 120, g: 190, b: 255 };
const ORANGE = { r: 255, g: 170, b: 60 };



function terrainZ(world: World, p: { x: number; y: number }): number {
	return -16 + (32 * world.ctx.height.value(p.x, p.y)) / 255 + 0.5;
}

export async function drawOverlay(client: Sc2Client, world: World, commander: Commander, squads: Squad[], panelUrl: string | null): Promise<void> {
	const texts: DebugText[] = [];
	const lines: DebugLine[] = [];
	const spheres: DebugSphere[] = [];
	const plan = commander.plan;
	texts.push({
		text: `${gameClock(world.loop)} ASTRA ${commander.mode.toUpperCase()} ${plan ? `plan #${commander.planId} ${plan.intent.toUpperCase()}` : "default orders"}${commander.pending ? " (thinking...)" : ""}${panelUrl ? `   decisions: ${panelUrl}` : ""}`,
		screen: { x: 0.01, y: 0.04 },
		color: BLUE,
	});
	for (const squad of squads) {
		if (squad.units.length === 0) continue;
		const orders = commander.ordersFor(world, squad);
		const d = squad.decision;
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
	const target = commander.objective(world);
	const rally = commander.retreatPoint(world);
	spheres.push({ pos: { ...target, z: terrainZ(world, target) }, radius: 2, color: BLUE });
	spheres.push({ pos: { ...rally, z: terrainZ(world, rally) }, radius: 1.5, color: ORANGE });
	texts.push({ text: plan ? `ASTRA target (plan #${commander.planId})` : "default target", pos: { ...target, z: terrainZ(world, target) + 1 }, color: BLUE });
	texts.push({ text: "ASTRA rally", pos: { ...rally, z: terrainZ(world, rally) + 1 }, color: ORANGE });
	await client.drawText(texts, lines, spheres);
}
