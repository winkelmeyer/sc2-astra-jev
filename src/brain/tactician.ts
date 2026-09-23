import type { Commander } from "../army/engagement.ts";
import { defaultDecision, type Decision, type Squad } from "../army/types.ts";
import { JEV_CONCURRENCY } from "../config.ts";
import type { GameLog } from "../log.ts";
import type { Sc2Client } from "../sc2/client.ts";
import { Ability, Unit, Upgrade } from "../sc2/ids.ts";
import { centroid, distance } from "../state/geometry.ts";
import { hpFraction, type World } from "../state/world.ts";
import { toDecision } from "./decisions.ts";
import { STANCE_COLORS } from "../hud/overlay.ts";
import { askJev, buildJevRequest } from "./jev.ts";

export class Tactician {
	blinkReady = new Set<number>();

	constructor(
		private readonly client: Sc2Client,
		private readonly log: GameLog,
		private readonly useJev: boolean,
	) {}

	async tick(world: World, squads: Squad[], commander: Commander): Promise<void> {
		await this.refreshBlink(world);
		const retreatTo = commander.retreatPoint(world);
		const fighting: Squad[] = [];
		for (const squad of squads) {
			if (squad.units.length === 0) continue;
			if (squad.nearbyEnemies.length > 0) {
				fighting.push(squad);
				continue;
			}
			const stillFleeing = squad.decision.stance === "retreat" && distance(centroid(squad.units.map((u) => u.pos)), retreatTo) > 8;
			if (!stillFleeing && squad.decision.source !== "default") squad.decision = defaultDecision(world.loop);
		}
		const jobs = fighting.filter((s) => !s.inFlight);
		if (!this.useJev) {
			for (const squad of jobs) squad.decision = scriptedDecision(world, squad);
			return;
		}
		let next = 0;
		const worker = async () => {
			while (next < jobs.length) {
				const squad = jobs[next++];
				await this.decide(world, squad, squads, commander);
			}
		};
		await Promise.all(Array.from({ length: Math.min(JEV_CONCURRENCY, jobs.length) }, worker));
	}

	private async decide(world: World, squad: Squad, squads: Squad[], commander: Commander): Promise<void> {
		const orders = commander.ordersFor(world, squad);
		const { state, questions } = buildJevRequest(world, squad, orders, squads, this.blinkReady);
		squad.inFlight = true;
		const started = Date.now();
		try {
			const answers = await askJev(state, questions);
			const previous = squad.decision.stance;
			squad.decision = toDecision(answers, world.loop, centroid(squad.units.map((u) => u.pos)));
			squad.lastDecisionLoop = world.loop;
			const p = answers.probabilities;
			const extras = ["blinkBack", "forcefield", "guardianShield"].filter((k) => p[k] !== undefined).map((k) => ` ${k} ${p[k].toFixed(2)}`).join("");
			const transition = previous === squad.decision.stance ? squad.decision.stance : `${previous}->${squad.decision.stance}`;
			this.log.feed.push(world.loop, "jev", `JEV ${squad.id} vs ${commander.plan ? `plan #${commander.planId}` : "default"} -> ${transition.toUpperCase()} | engage ${(p.engage ?? 0).toFixed(2)} retreat ${(p.retreat ?? 0).toFixed(2)}${extras}${answers.focus ? ` | focus ${answers.focus}` : ""}`, STANCE_COLORS[squad.decision.stance]);
			this.log.jev({ loop: world.loop, squad: squad.id, latencyMs: Date.now() - started, cost: answers.cost, state, answers: { probabilities: answers.probabilities, focus: answers.focus }, stance: squad.decision.stance, changed: previous !== squad.decision.stance });
		} catch (error) {
			this.log.jevError({ loop: world.loop, squad: squad.id, error: String(error) });
			this.log.feed.push(world.loop, "jev", `JEV ${squad.id} error, keeping ${squad.decision.stance.toUpperCase()}`, { r: 255, g: 80, b: 80 });
		} finally {
			squad.inFlight = false;
		}
	}

	private async refreshBlink(world: World): Promise<void> {
		const stalkers = world.all(Unit.STALKER);
		if (!world.upgrades.has(Upgrade.BLINK) || stalkers.length === 0) {
			this.blinkReady.clear();
			return;
		}
		const abilities = await this.client.availableAbilities(stalkers.map((s) => s.tag));
		this.blinkReady = new Set(stalkers.filter((s) => abilities.get(s.tag)?.has(Ability.BLINK)).map((s) => s.tag));
	}
}

function scriptedDecision(world: World, squad: Squad): Decision {
	const ours = squad.units.reduce((sum, u) => sum + hpFraction(u), 0);
	const theirs = squad.nearbyEnemies.reduce((sum, u) => sum + hpFraction(u), 0);
	const retreat = ours * 2 < theirs;
	return {
		stance: retreat ? "retreat" : "engage",
		blinkBack: true,
		forcefield: false,
		guardianShield: squad.kind === "sentry",
		probabilities: {},
		loop: world.loop,
		source: "scripted",
	};
}
