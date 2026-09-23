import type { GameContext } from "../state/context.ts";
import type { World } from "../state/world.ts";

export class Budget {
	minerals: number;
	gas: number;
	supply: number;

	constructor(
		private readonly ctx: GameContext,
		world: World,
	) {
		this.minerals = world.minerals;
		this.gas = world.gas;
		this.supply = world.supplyLeft;
	}

	canAfford(unitType: number): boolean {
		const cost = this.ctx.cost(unitType);
		return this.minerals >= cost.minerals && this.gas >= cost.gas && (cost.supply === 0 || this.supply >= cost.supply);
	}

	canAffordRaw(minerals: number, gas: number): boolean {
		return this.minerals >= minerals && this.gas >= gas;
	}

	spend(unitType: number): void {
		const cost = this.ctx.cost(unitType);
		this.minerals -= cost.minerals;
		this.gas -= cost.gas;
		this.supply -= cost.supply;
	}

	spendRaw(minerals: number, gas: number): void {
		this.minerals -= minerals;
		this.gas -= gas;
	}

	reserve(unitType: number): void {
		const cost = this.ctx.cost(unitType);
		this.minerals -= cost.minerals;
		this.gas -= cost.gas;
	}
}
