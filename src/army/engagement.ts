import { planEngagement, type EngagementPlan } from "../brain/astra.ts";
import { battlefieldSummary, composition } from "../brain/summary.ts";
import type { GameLog } from "../log.ts";
import type { Point2 } from "../sc2/types.ts";
import { centroid, closest, distance, towards } from "../state/geometry.ts";
import type { World } from "../state/world.ts";
import type { Squad, SquadOrders } from "./types.ts";

export type Mode = "gather" | "attack" | "defend";

export interface PlanRecord {
	planId: number | null;
	loop: number;
	trigger: string;
	latencyMs?: number;
	costUsd?: number;
	intent?: string;
	summary?: string;
	applied: boolean;
	error?: string;
}

const LOOPS_PER_SECOND = 22.4;
const MIN_REPLAN_LOOPS = 20 * LOOPS_PER_SECOND;
const ATTACK_ARMY_SUPPLY = 60;
const BASE_THREAT_RADIUS = 22;
const MIN_THREAT_UNITS = 3;
const MIN_URGENT_REPLAN_LOOPS = 10 * LOOPS_PER_SECOND;

const DEFAULT_ENGAGE = "We are at least even: our squad plus nearby allies have similar or more units than the enemies in range, or the enemy is hitting our base.";
const DEFAULT_RETREAT = "We are clearly losing the trade: most of our units are below 35% health while the enemy is mostly healthy, or enemies in range outnumber us more than two to one.";

export class Commander {
	mode: Mode = "gather";
	plan: EngagementPlan | null = null;
	private planLoop = -Infinity;
	pending = false;
	planId = 0;
	pendingTrigger = "";
	readonly history: PlanRecord[] = [];
	private inFlight: Promise<void> = Promise.resolve();
	private replanTrigger: string | null = null;
	private attackStartSupply = 0;
	private threatClearSince = 0;
	private readonly visited: Point2[] = [];

	constructor(
		private readonly log: GameLog,
		private readonly useAstra: boolean,
	) {}

	rally(world: World): Point2 {
		const ctx = world.ctx;
		if (world.count(59) < 2) return towards(ctx.myStart, ctx.natural.pos, 10);
		return towards(ctx.natural.pos, ctx.mapCenter, 7);
	}

	update(world: World, squads: Squad[]): void {
		if (this.replanTrigger && !this.pending) {
			const trigger = this.replanTrigger;
			this.replanTrigger = null;
			this.requestPlan(world, squads, trigger, true);
		}
		const threat = this.baseThreat(world);
		if (threat.length >= MIN_THREAT_UNITS) {
			this.threatClearSince = world.loop;
			if (this.mode !== "defend") {
				const center = centroid(threat.map((u) => u.pos));
				const hit = closest(world.own.filter((u) => world.ctx.isStructure(u.unitType)), center);
				const who = Object.entries(composition(world, threat)).map(([n, c]) => `${c} ${n}`).join(", ");
				this.transition(world, squads, "defend", `enemy ${who} near our ${hit ? world.ctx.name(hit.unitType) : "base"} at ${fmt(center)}`, true);
			}
			return;
		}
		if (this.mode === "defend" && world.loop - this.threatClearSince > 10 * LOOPS_PER_SECOND) {
			this.mode = "gather";
			this.plan = null;
		}
		if (this.mode === "gather" && (world.armySupply >= ATTACK_ARMY_SUPPLY || world.supplyUsed >= 185)) {
			this.attackStartSupply = world.armySupply;
			this.transition(world, squads, "attack", `army ready to attack (${world.armySupply} army supply)`, false);
			return;
		}
		if (this.mode === "attack") {
			if (world.armySupply < this.attackStartSupply * 0.45) {
				this.visited.length = 0;
				this.transition(world, squads, "gather", `attack is failing: army supply fell from ${this.attackStartSupply} to ${world.armySupply}`, true);
				return;
			}
			const target = this.plan?.target ?? this.defaultTarget(world);
			const army = world.army;
			const arrived = army.length > 0 && distance(centroid(army.map((u) => u.pos)), target) < 10;
			const cleared = world.enemyCombat.every((e) => distance(e.pos, target) > 14);
			if (arrived && cleared && !this.visited.some((v) => distance(v, target) < 10)) {
				this.visited.push(target);
				this.plan = null;
				this.transition(world, squads, "attack", `target ${fmt(target)} cleared, choose the next objective`, false);
			}
		}
	}

	ordersFor(world: World, squad: Squad): SquadOrders {
		const entry = this.plan?.squads.find((s) => s.squadId === squad.id);
		const target = this.mode === "gather" ? this.rally(world) : (entry?.target ?? this.objective(world));
		return {
			role: entry?.role ?? (squad.kind === "zealot" || squad.kind === "immortal" ? "frontline" : squad.kind === "sentry" ? "support" : "ranged"),
			target,
			objective: entry?.objective ?? this.plan?.summary ?? `${this.mode} at ${fmt(target)}`,
			focusPriority: entry?.focusPriority ?? [],
			engageWhen: entry?.engageWhen ?? DEFAULT_ENGAGE,
			retreatWhen: entry?.retreatWhen ?? DEFAULT_RETREAT,
		};
	}

	settled(): Promise<void> {
		return this.inFlight;
	}

	objective(world: World): Point2 {
		return this.mode === "gather" ? this.rally(world) : (this.plan?.target ?? this.defaultTarget(world));
	}

	retreatPoint(world: World): Point2 {
		return this.plan?.rally ?? this.rally(world);
	}

	private transition(world: World, squads: Squad[], mode: Mode, trigger: string, urgent: boolean): void {
		this.mode = mode;
		if (mode === "gather") this.plan = null;
		this.log.write({ type: "mode", loop: world.loop, mode, trigger });
		this.log.feed.push(world.loop, "mode", `MODE ${mode.toUpperCase()}: ${trigger}`);
		console.log(`[commander] ${mode}: ${trigger}`);
		this.requestPlan(world, squads, trigger, urgent);
	}

	private requestPlan(world: World, squads: Squad[], trigger: string, urgent: boolean): void {
		const mode = this.mode;
		if (!this.useAstra || mode === "gather") return;
		if (this.pending) {
			this.replanTrigger = `${trigger} (queued while Astra was busy)`;
			return;
		}
		if (world.loop - this.planLoop < (urgent ? MIN_URGENT_REPLAN_LOOPS : MIN_REPLAN_LOOPS)) return;
		this.planLoop = world.loop;
		this.pending = true;
		this.pendingTrigger = trigger;
		this.log.feed.push(world.loop, "astra", `ASTRA thinking: ${trigger}`);
		const summary = battlefieldSummary(world, squads, trigger, this.rally(world));
		const requestedLoop = world.loop;
		this.inFlight = planEngagement(summary)
			.then(({ plan, latencyMs, cost }) => {
				const applied = this.mode === mode;
				if (applied) {
					this.plan = plan;
					this.planId++;
				}
				if (!applied) this.replanTrigger = `new plan for ${this.mode}: the ${mode} plan arrived after the situation changed`;
				this.history.push({ planId: applied ? this.planId : null, loop: requestedLoop, trigger, latencyMs, costUsd: cost.cost, intent: plan.intent, summary: plan.summary, applied });
				this.log.astra({ loop: requestedLoop, trigger, latencyMs, cost, applied: this.mode === mode, plan }, true);
				console.log(`[astra] ${latencyMs}ms $${cost.cost.toFixed(4)} ${plan.intent}: ${plan.summary}`);
				this.log.feed.push(requestedLoop, "astra", `ASTRA ${applied ? `plan #${this.planId}` : "discarded plan"} ${plan.intent.toUpperCase()} (${(latencyMs / 1000).toFixed(0)}s, $${cost.cost.toFixed(3)}): ${plan.summary}`);
				if (applied) for (const sq of plan.squads) this.log.feed.push(requestedLoop, "astra", `  ${sq.squadId} [${sq.role}] ${sq.objective}`);
				if (plan.intent === "retreat" && this.mode !== "defend") this.mode = "gather";
			})
			.catch((error: unknown) => {
				this.log.astra({ loop: requestedLoop, trigger, error: String(error) }, false);
				this.history.push({ planId: null, loop: requestedLoop, trigger, applied: false, error: String(error) });
				this.log.feed.push(requestedLoop, "astra", `ASTRA failed, scripted plan stays: ${String(error).slice(0, 80)}`, { r: 255, g: 80, b: 80 });
				console.error(`[astra] failed, keeping scripted default: ${String(error)}`);
			})
			.finally(() => {
				this.pending = false;
			});
	}

	private baseThreat(world: World) {
		const structures = world.own.filter((u) => world.ctx.isStructure(u.unitType));
		return world.enemyCombat.filter((e) => structures.some((s) => distance(s.pos, e.pos) < BASE_THREAT_RADIUS));
	}

	private defaultTarget(world: World): Point2 {
		const threat = this.baseThreat(world);
		if (threat.length > 0) return centroid(threat.map((u) => u.pos));
		const from = world.army.length > 0 ? centroid(world.army.map((u) => u.pos)) : world.ctx.myStart;
		const unvisited = (p: Point2) => !this.visited.some((v) => distance(v, p) < 10);
		const structures = [...world.memory.structures.values()].filter((s) => unvisited(s.pos));
		const known = closest(structures, from);
		if (known) return known.pos;
		const ctx = world.ctx;
		const scouting = [ctx.enemyNatural.pos, ctx.enemyStart, ...[...ctx.expansions].reverse().map((e) => e.pos)];
		return scouting.find(unvisited) ?? ctx.enemyStart;
	}
}

function fmt(p: Point2): string {
	return `(${Math.round(p.x)}, ${Math.round(p.y)})`;
}
