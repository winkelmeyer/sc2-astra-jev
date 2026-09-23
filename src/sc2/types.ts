export interface Point2 { x: number; y: number }
export interface Point3 extends Point2 { z?: number }

export interface UnitOrder {
	abilityId: number;
	targetWorldSpacePos?: Point3;
	targetUnitTag?: number;
	progress?: number;
}

export interface RawUnit {
	tag: number;
	unitType: number;
	alliance: number;
	owner?: number;
	pos: Point3;
	facing?: number;
	radius?: number;
	buildProgress?: number;
	health?: number;
	healthMax?: number;
	shield?: number;
	shieldMax?: number;
	energy?: number;
	energyMax?: number;
	mineralContents?: number;
	vespeneContents?: number;
	isFlying?: boolean;
	isHallucination?: boolean;
	displayType?: number;
	orders?: UnitOrder[];
	assignedHarvesters?: number;
	idealHarvesters?: number;
	weaponCooldown?: number;
	buffIds?: number[];
	isPowered?: boolean;
	isActive?: boolean;
}

export interface PowerSource { pos: Point3; radius: number; tag: number }

export interface Observation {
	gameLoop: number;
	playerCommon: {
		playerId: number;
		minerals?: number;
		vespene?: number;
		foodCap?: number;
		foodUsed?: number;
		foodArmy?: number;
		foodWorkers?: number;
		warpGateCount?: number;
	};
	rawData: {
		player: { powerSources?: PowerSource[]; upgradeIds?: number[] };
		units?: RawUnit[];
		event?: { deadUnits?: number[] };
	};
}

export interface ResponseObservation {
	observation: Observation;
	playerResult?: { playerId: number; result: number }[];
	actionErrors?: { unitTag?: number; abilityId?: number; result?: number }[];
}

export interface ImageData { bitsPerPixel: number; size: Point2; data: Buffer }

export interface GameInfo {
	mapName: string;
	startRaw: {
		mapSize: Point2;
		pathingGrid: ImageData;
		placementGrid: ImageData;
		terrainHeight: ImageData;
		playableArea: { p0: Point2; p1: Point2 };
		startLocations: Point2[];
	};
	playerInfo: { playerId: number; type?: number; raceRequested?: number; raceActual?: number }[];
}

export interface UnitTypeData {
	unitId: number;
	name?: string;
	available?: boolean;
	attributes?: number[];
	movementSpeed?: number;
	mineralCost?: number;
	vespeneCost?: number;
	foodRequired?: number;
	abilityId?: number;
	weapons?: { range?: number }[];
}

export interface Command {
	abilityId: number;
	unitTags: number[];
	targetWorldSpacePos?: Point2;
	targetUnitTag?: number;
	queueCommand?: boolean;
}
