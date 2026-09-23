import { Sc2Connection } from "./connection.ts";
import { PlacementResult, Race, Status } from "./ids.ts";
import type { Command, GameInfo, Point2, Point3, ResponseObservation, UnitTypeData } from "./types.ts";

export interface GameSetup {
	mapPath: string;
	enemyRace: number;
	difficulty: number;
	realtime: boolean;
}

type Color = { r: number; g: number; b: number };
export interface DebugLine { from: Point3; to: Point3; color: Color }
export interface DebugSphere { pos: Point3; radius: number; color: Color }
export interface DebugText { text: string; pos?: Point3; screen?: Point2; color?: { r: number; g: number; b: number } }

export class Sc2Client {
	status = 0;

	constructor(private readonly connection: Sc2Connection) {}

	async createGame({ mapPath, enemyRace, difficulty, realtime }: GameSetup): Promise<void> {
		const response = await this.connection.request<{ error?: number; errorDetails?: string }>("createGame", {
			localMap: { mapPath },
			playerSetup: [
				{ type: 1, race: Race.Protoss },
				{ type: 2, race: enemyRace, difficulty },
			],
			disableFog: false,
			realtime,
		});
		if (response.error) throw new Error(`createGame error ${response.error}: ${response.errorDetails ?? ""}`);
	}

	async joinGame(): Promise<number> {
		const response = await this.connection.request<{ playerId: number; error?: number; errorDetails?: string }>(
			"joinGame",
			{
				race: Race.Protoss,
				options: { raw: true, score: true, showCloaked: true, rawAffectsSelection: true },
			},
		);
		if (response.error) throw new Error(`joinGame error ${response.error}: ${response.errorDetails ?? ""}`);
		return response.playerId;
	}

	gameInfo(): Promise<GameInfo> {
		return this.connection.request<GameInfo>("gameInfo");
	}

	async unitTypeData(): Promise<Map<number, UnitTypeData>> {
		const response = await this.connection.request<{ units?: UnitTypeData[] }>("data", { unitTypeId: true });
		return new Map((response.units ?? []).map((unit) => [unit.unitId, unit]));
	}

	async observe(): Promise<ResponseObservation> {
		return this.connection.request<ResponseObservation>("observation", {});
	}

	async step(count: number): Promise<void> {
		await this.connection.request("step", { count });
	}

	async act(commands: Command[]): Promise<void> {
		if (commands.length === 0) return;
		await this.connection.request("action", {
			actions: commands.map((command) => ({ actionRaw: { unitCommand: command } })),
		});
	}

	async moveCamera(center: Point2): Promise<void> {
		await this.connection.request("action", {
			actions: [{ actionRaw: { cameraMove: { centerWorldSpace: { x: center.x, y: center.y } } } }],
		});
	}

	async placements(abilityId: number, positions: Point2[]): Promise<boolean[]> {
		if (positions.length === 0) return [];
		const response = await this.connection.request<{ placements?: { result?: number }[] }>("query", {
			placements: positions.map((targetPos) => ({ abilityId, targetPos })),
		});
		return (response.placements ?? []).map((placement) => placement.result === PlacementResult.Success);
	}

	async pathDistances(pairs: { from: Point2; to: Point2 }[]): Promise<number[]> {
		if (pairs.length === 0) return [];
		const response = await this.connection.request<{ pathing?: { distance?: number }[] }>("query", {
			pathing: pairs.map(({ from, to }) => ({ startPos: from, endPos: to })),
		});
		return (response.pathing ?? []).map((path) => path.distance ?? 0);
	}

	async availableAbilities(unitTags: number[]): Promise<Map<number, Set<number>>> {
		if (unitTags.length === 0) return new Map();
		const response = await this.connection.request<{
			abilities?: { unitTag: number; abilities?: { abilityId: number }[] }[];
		}>("query", { abilities: unitTags.map((unitTag) => ({ unitTag })) });
		return new Map(
			(response.abilities ?? []).map((entry) => [
				entry.unitTag,
				new Set((entry.abilities ?? []).map((ability) => ability.abilityId)),
			]),
		);
	}

	async drawText(texts: DebugText[], lines: DebugLine[] = [], spheres: DebugSphere[] = []): Promise<void> {
		await this.connection.request("debug", {
			debug: [
				{
					draw: {
						lines: lines.map(({ from, to, color }) => ({ line: { p0: from, p1: to }, color })),
						spheres: spheres.map(({ pos, radius, color }) => ({ p: pos, r: radius, color })),
						text: texts.map(({ text, pos, screen, color }) => ({
							text,
							...(pos ? { worldPos: { x: pos.x, y: pos.y, z: (pos.z ?? 10) + 1 } } : { virtualPos: { x: screen?.x ?? 0, y: screen?.y ?? 0 } }),
							color: color ?? { r: 255, g: 255, b: 255 },
							size: 12,
						})),
					},
				},
			],
		});
	}

	async saveReplay(): Promise<Buffer> {
		const response = await this.connection.request<{ data: Buffer }>("saveReplay");
		return response.data;
	}

	async leave(): Promise<void> {
		await this.connection.request("leaveGame").catch(() => undefined);
	}

	async quit(): Promise<void> {
		await this.connection.request("quit").catch(() => undefined);
		this.connection.close();
	}

	static readonly ended = Status.ended;
}
