export interface CallCost {
	inputTokens: number;
	outputTokens: number;
	cost: number;
	marketCost: number;
}

interface Usage { inputTokens?: number; outputTokens?: number }
type ProviderMetadata = Record<string, Record<string, unknown> | undefined> | undefined;

export function callCost(usage: Usage, providerMetadata: ProviderMetadata): CallCost {
	const gateway = providerMetadata?.gateway;
	if (!gateway || gateway.cost === undefined) throw new Error("gateway response carried no cost metadata");
	return {
		inputTokens: usage.inputTokens ?? 0,
		outputTokens: usage.outputTokens ?? 0,
		cost: Number(gateway.cost),
		marketCost: Number(gateway.marketCost ?? gateway.cost),
	};
}

export class CostMeter {
	private readonly totals = new Map<string, CallCost & { calls: number }>();

	add(model: string, call: CallCost): void {
		const t = this.totals.get(model) ?? { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, marketCost: 0 };
		t.calls++;
		t.inputTokens += call.inputTokens;
		t.outputTokens += call.outputTokens;
		t.cost += call.cost;
		t.marketCost += call.marketCost;
		this.totals.set(model, t);
	}

	get total(): number {
		return [...this.totals.values()].reduce((sum, t) => sum + t.cost, 0);
	}

	get marketTotal(): number {
		return [...this.totals.values()].reduce((sum, t) => sum + t.marketCost, 0);
	}

	snapshot(): Record<string, unknown> {
		return {
			costUsd: round(this.total),
			marketCostUsd: round(this.marketTotal),
			byModel: Object.fromEntries([...this.totals].map(([m, t]) => [m, { ...t, cost: round(t.cost), marketCost: round(t.marketCost) }])),
		};
	}
}

function round(n: number): number {
	return Math.round(n * 1e6) / 1e6;
}
