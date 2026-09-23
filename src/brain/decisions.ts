import type { Decision } from "../army/types.ts";
import type { Point2 } from "../sc2/types.ts";
import type { JevAnswers } from "./jev.ts";

const RETREAT_THRESHOLD = 0.6;
const ENGAGE_THRESHOLD = 0.55;
const ABILITY_THRESHOLD = 0.7;

export function toDecision({ probabilities, focus }: JevAnswers, loop: number, holdPoint: Point2): Decision {
	const p = (key: string) => probabilities[key] ?? 0;
	const stance = p("retreat") > RETREAT_THRESHOLD ? "retreat" : p("engage") > ENGAGE_THRESHOLD ? "engage" : "hold";
	return {
		stance,
		focusType: focus,
		blinkBack: p("blinkBack") > ABILITY_THRESHOLD,
		forcefield: p("forcefield") > ABILITY_THRESHOLD,
		guardianShield: p("guardianShield") > ABILITY_THRESHOLD,
		holdPoint: stance === "hold" ? holdPoint : undefined,
		probabilities,
		loop,
		source: "jev",
	};
}
