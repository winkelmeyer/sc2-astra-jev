import { Unit } from "../sc2/ids.ts";
import type { RawUnit } from "../sc2/types.ts";
import { centroid, distance } from "../state/geometry.ts";
import type { World } from "../state/world.ts";
import { Squad, type SquadKind } from "./types.ts";

const MAX_STALKERS_PER_SQUAD = 8;
const ENGAGE_RADIUS = 13;

function kindOf(unitType: number): SquadKind | undefined {
	if (unitType === Unit.STALKER) return "stalker";
	if (unitType === Unit.ZEALOT) return "zealot";
	if (unitType === Unit.IMMORTAL) return "immortal";
	if (unitType === Unit.SENTRY) return "sentry";
	return undefined;
}

export class SquadManager {
	private readonly squads = new Map<string, Squad>();
	private readonly membership = new Map<number, Squad>();
	private counter = 0;

	update(world: World): Squad[] {
		const alive = new Map(world.army.map((u) => [u.tag, u]));
		for (const [tag, squad] of this.membership) {
			if (!alive.has(tag)) {
				squad.tags.delete(tag);
				this.membership.delete(tag);
			}
		}
		for (const unit of alive.values()) {
			if (this.membership.has(unit.tag)) continue;
			const kind = kindOf(unit.unitType);
			if (!kind) continue;
			const squad = this.assign(kind, world.loop);
			squad.tags.add(unit.tag);
			this.membership.set(unit.tag, squad);
		}
		for (const [id, squad] of this.squads) {
			if (squad.tags.size === 0) {
				this.squads.delete(id);
				continue;
			}
			squad.units = [...squad.tags].map((t) => alive.get(t)).filter((u): u is RawUnit => u !== undefined);
			squad.nearbyEnemies = world.enemyCombat.filter((e) => squad.units.some((u) => distance(u.pos, e.pos) < ENGAGE_RADIUS));
		}
		return [...this.squads.values()];
	}

	all(): Squad[] {
		return [...this.squads.values()];
	}

	private assign(kind: SquadKind, loop: number): Squad {
		if (kind === "zealot" || kind === "immortal") {
			const existing = this.squads.get(`${kind}s`);
			if (existing) return existing;
			return this.create(`${kind}s`, kind, loop);
		}
		if (kind === "stalker") {
			const open = [...this.squads.values()]
				.filter((s) => s.kind === "stalker" && s.tags.size < MAX_STALKERS_PER_SQUAD)
				.sort((a, b) => a.tags.size - b.tags.size)[0];
			if (open) return open;
			return this.create(`stalkers-${++this.counter}`, kind, loop);
		}
		return this.create(`sentry-${++this.counter}`, kind, loop);
	}

	private create(id: string, kind: SquadKind, loop: number): Squad {
		const squad = new Squad(id, kind, new Set(), loop);
		this.squads.set(id, squad);
		return squad;
	}
}

export function squadCenter(squad: Squad): { x: number; y: number } {
	return centroid(squad.units.map((u) => u.pos));
}
