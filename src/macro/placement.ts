import type { Sc2Client } from "../sc2/client.ts";
import { Ability } from "../sc2/ids.ts";
import type { Point2 } from "../sc2/types.ts";
import type { GameContext } from "../state/context.ts";
import { centroid, distance, towards, within } from "../state/geometry.ts";
import type { World } from "../state/world.ts";

const PYLON_POWER_RADIUS = 6.5;

export class Placer {
	constructor(
		private readonly client: Sc2Client,
		private readonly ctx: GameContext,
	) {}

	async pylonSpot(world: World, base: Point2): Promise<Point2 | undefined> {
		const resources = within([...world.mineralFields, ...world.geysers], base, 12);
		const away = resources.length > 0 ? towards(base, centroid(resources.map((r) => r.pos)), -9) : towards(base, this.ctx.mapCenter, 9);
		const structures = world.own.filter((u) => this.ctx.isStructure(u.unitType));
		const candidates: Point2[] = [];
		for (let dx = -14; dx <= 14; dx++) {
			for (let dy = -14; dy <= 14; dy++) {
				const p = { x: Math.round(base.x) + dx, y: Math.round(base.y) + dy };
				const d = distance(p, base);
				if (d < 6 || d > 15) continue;
				if (resources.some((r) => distance(r.pos, p) < 4)) continue;
				if (structures.some((s) => distance(s.pos, p) < 3.5)) continue;
				if (!this.ctx.placement.isFree(p, 2)) continue;
				candidates.push(p);
			}
		}
		candidates.sort((a, b) => distance(a, away) - distance(b, away));
		return this.firstValid(Ability.BUILD_PYLON, candidates.slice(0, 25));
	}

	async buildingSpot(world: World, abilityId: number, near: Point2): Promise<Point2 | undefined> {
		const structures = world.own.filter((u) => this.ctx.isStructure(u.unitType));
		const resources = [...world.mineralFields, ...world.geysers];
		const pylons = world.powerSources.filter((p) => distance(p.pos, near) < 30);
		const candidates: Point2[] = [];
		for (const pylon of pylons) {
			for (let dx = -5; dx <= 5; dx++) {
				for (let dy = -5; dy <= 5; dy++) {
					const p = { x: Math.floor(pylon.pos.x) + dx + 0.5, y: Math.floor(pylon.pos.y) + dy + 0.5 };
					if (distance(p, pylon.pos) > PYLON_POWER_RADIUS - 1) continue;
					if (resources.some((r) => distance(r.pos, p) < 6)) continue;
					if (structures.some((s) => distance(s.pos, p) < 4)) continue;
					if (!this.ctx.placement.isFree(p, 3)) continue;
					candidates.push(p);
				}
			}
		}
		candidates.sort((a, b) => distance(a, near) - distance(b, near));
		return this.firstValid(abilityId, candidates.slice(0, 30));
	}

	async warpSpots(abilityId: number, pylon: Point2, count: number): Promise<Point2[]> {
		const candidates: Point2[] = [];
		for (let dx = -5; dx <= 5; dx += 1.5) {
			for (let dy = -5; dy <= 5; dy += 1.5) {
				const p = { x: pylon.x + dx, y: pylon.y + dy };
				if (distance(p, pylon) < 2 || distance(p, pylon) > 5.5) continue;
				if (!this.ctx.pathing.value(p.x, p.y)) continue;
				candidates.push(p);
			}
		}
		const valid = await this.client.placements(abilityId, candidates);
		return candidates.filter((_, i) => valid[i]).slice(0, count);
	}

	private async firstValid(abilityId: number, candidates: Point2[]): Promise<Point2 | undefined> {
		const valid = await this.client.placements(abilityId, candidates);
		return candidates.find((_, i) => valid[i]);
	}
}
