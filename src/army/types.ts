import type { Point2, RawUnit } from "../sc2/types.ts";

export type Stance = "engage" | "hold" | "retreat";
export type SquadKind = "stalker" | "zealot" | "immortal" | "sentry";
export type Role = "frontline" | "ranged" | "flank" | "support" | "harass";

export interface SquadOrders {
	role: Role;
	target: Point2;
	objective: string;
	focusPriority: string[];
	engageWhen: string;
	retreatWhen: string;
}

export interface Decision {
	stance: Stance;
	focusType?: string;
	blinkBack: boolean;
	forcefield: boolean;
	guardianShield: boolean;
	holdPoint?: Point2;
	probabilities: Record<string, number>;
	loop: number;
	source: "jev" | "default" | "scripted";
}

export function defaultDecision(loop: number): Decision {
	return { stance: "engage", blinkBack: false, forcefield: false, guardianShield: false, probabilities: {}, loop, source: "default" };
}

export class Squad {
	units: RawUnit[] = [];
	nearbyEnemies: RawUnit[] = [];
	decision: Decision;
	inFlight = false;
	lastDecisionLoop = 0;

	constructor(
		readonly id: string,
		readonly kind: SquadKind,
		readonly tags: Set<number>,
		loop: number,
	) {
		this.decision = defaultDecision(loop);
	}
}
