import React, { StrictMode, useEffect, useEffectEvent, useMemo, useReducer, useRef } from "https://esm.sh/react";
import { createRoot } from "https://esm.sh/react-dom/client";
import * as THREE from "https://esm.sh/three";
import { OrbitControls } from "https://esm.sh/three/addons/controls/OrbitControls.js";
import { GUI } from "https://esm.sh/dat.gui";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<VoxelCity />
	</StrictMode>
);

const DEFAULT_CITY_CONFIG: CityConfig = {
	seed: 77345,
	daylight: 12,
	gridChaos: 0.25,
	commercialDensity: 0.65,
	residentialDensity: 0.7,
	blocks: 16,
	lotsPerBlock: 3,
	lotSize: 6,
	lotMargin: 2,
	streetWidth: 5,
	padOverhang: 1,
	padThickness: 0.5,
	maxHeight: 32,
	minBuildingHeight: 3,
	heightVariance: 0.6,
	setbackFrequency: 0.55,
	vacantLotChance: 0.1,
	minResidentialScale: 3,
	residentialHeightFactor: 0.3,
	windowDensity: 0.85,
	windowLitChance: 0.25,
	windowFloorHeight: 2,
	treeMin: 3,
	treeSpread: 5,
	neighborhoodPaletteSync: true
};
const DISTRICT_PALETTES: readonly (readonly string[])[] = [
	// steel & slate
	[
		"hsl(220, 25%, 90%)",
		"hsl(220, 25%, 60%)",
		"hsl(220, 25%, 45%)",
		"hsl(220, 25%, 30%)"
	],
	// brick & sand
	[
		"hsl(25, 55%, 85%)",
		"hsl(25, 55%, 60%)",
		"hsl(25, 55%, 50%)",
		"hsl(25, 55%, 35%)"
	],
	// verdigris
	[
		"hsl(130, 25%, 90%)",
		"hsl(130, 25%, 70%)",
		"hsl(130, 25%, 40%)",
		"hsl(130, 25%, 25%)"
	],
	// dusk violet
	[
		"hsl(260, 30%, 90%)",
		"hsl(260, 30%, 65%)",
		"hsl(260, 30%, 45%)",
		"hsl(260, 30%, 30%)"
	],
	// limestone
	[
		"hsl(30, 20%, 90%)",
		"hsl(30, 20%, 70%)",
		"hsl(30, 20%, 50%)",
		"hsl(30, 20%, 30%)"
	]
];
const PARK_GREEN: THREE.Color = new THREE.Color("hsl(105, 30%, 40%)");
const TREE_GREEN: THREE.Color = new THREE.Color("hsl(105, 30%, 30%)");
const SIDEWALK: THREE.Color = new THREE.Color("hsl(60, 5%, 60%)");
const AMBIENT_DAY: THREE.Color = new THREE.Color("hsl(210, 40%, 75%)");
const AMBIENT_NIGHT: THREE.Color = new THREE.Color("hsl(235, 55%, 22%)");
const SKY_DAY: THREE.Color = new THREE.Color("hsl(200, 70%, 70%)");
const SKY_DUSK: THREE.Color = new THREE.Color("hsl(20, 70%, 45%)");
const SKY_NIGHT: THREE.Color = new THREE.Color("hsl(230, 50%, 10%)");
const SUN_DAY: THREE.Color = new THREE.Color("hsl(40, 100%, 95%)");
const SUN_DUSK: THREE.Color = new THREE.Color("hsl(18, 90%, 62%)");
const SUN_MAX_INTENSITY: number = 2.4;
const HOURS_PER_DAY: number = 24;
const SUNRISE_HOUR: number = 6;
const SUN_TILT: number = 0.35;
const SHADOW_MAX_STRETCH: number = 3.5;
const ROAD_GRAY: string = "hsl(220, 5%, 30%)";
const WINDOW_LIT: THREE.Color = new THREE.Color("hsl(45, 95%, 78%)");
const WINDOW_DARK: THREE.Color = new THREE.Color("hsl(215, 25%, 20%)");
const WINDOW_DEPTH: number = 0.08;
const WINDOW_MAX_HEIGHT: number = 1.5;
const MAX_WINDOW_INSTANCES: number = 400_000;
const WINDOW_FACES: readonly WindowFace[] = [
	{ nx: 1, nz: 0 },
	{ nx: -1, nz: 0 },
	{ nx: 0, nz: 1 },
	{ nx: 0, nz: -1 }
];

const GUI_FOLDERS: readonly GuiFolderSpec[] = [
	{
		folder: "Architecture",
		params: [
			{ key: "heightVariance", label: "Height variance", min: 0, max: 1, step: 0.01 },
			{ key: "maxHeight", label: "Max height", min: 1, max: 120, step: 1 },
			{ key: "minBuildingHeight", label: "Min height", min: 1, max: 50, step: 1 },
			{ key: "minResidentialScale", label: "Min residential scale", min: 1, max: 50, step: 1 },
			{ key: "residentialHeightFactor", label: "Residential height factor", min: 0.01, max: 1, step: 0.01 },
			{ key: "setbackFrequency", label: "Setback chance", min: 0, max: 1, step: 0.01 },
			{ key: "vacantLotChance", label: "Vacant lot chance", min: 0, max: 1, step: 0.01 },
		],
	},
	{
		folder: "City Grid",
		params: [
			{ key: "blocks", label: "Blocks per side", min: 1, max: 40, step: 1 },
			{ key: "lotMargin", label: "Lot margin", min: 0, max: 8, step: 1 },
			{ key: "lotSize", label: "Lot size", min: 3, max: 16, step: 1 },
			{ key: "lotsPerBlock", label: "Lots per block", min: 1, max: 8, step: 1 },
			{ key: "streetWidth", label: "Street width", min: 0, max: 24, step: 1 },
		],
	},
	{
		folder: "Ground & Pads",
		params: [
			{ key: "padOverhang", label: "Pad overhang", min: 0, max: 8, step: 0.25 },
			{ key: "padThickness", label: "Pad thickness", min: 0.05, max: 1, step: 0.05 },
		],
	},
	{
		folder: "Macro Planning",
		params: [
			{ key: "gridChaos", label: "Grid chaos", min: 0, max: 1, step: 0.01 },
			{ key: "commercialDensity", label: "Commercial density", min: 0, max: 1, step: 0.01 },
			{ key: "residentialDensity", label: "Residential density", min: 0, max: 1, step: 0.01 },
		],
	},
	{
		folder: "Parks",
		params: [
			{ key: "treeMin", label: "Trees (min)", min: 0, max: 40, step: 1 },
			{ key: "treeSpread", label: "Trees (spread)", min: 0, max: 40, step: 1 },
		],
	},
	{
		folder: "Windows",
		params: [
			{ key: "windowDensity", label: "Density", min: 0, max: 1, step: 0.01 },
			{ key: "windowFloorHeight", label: "Floor height", min: 1, max: 8, step: 1 },
			{ key: "windowLitChance", label: "Lit chance", min: 0, max: 1, step: 0.01 },
		]
	},
];
const LIMITS: ConfigurationLimits = {
	blocks: {
		min: 1,
		max: 40
	},
	lotsPerBlock: {
		min: 1,
		max: 8
	},
	lotSize: {
		min: 3,
		max: 16
	}
} as const;
const PAD_COLOR: Readonly<Record<Zone, THREE.Color>> = {
	commercial: SIDEWALK,
	residential: SIDEWALK,
	park: PARK_GREEN,
};
const ZONE_HEIGHT_SCALE: Readonly<Record<Zone, (cfg: CityConfig) => number>> = {
	commercial: (cfg) => cfg.maxHeight,
	residential: (cfg) =>
		Math.max(cfg.minResidentialScale, cfg.maxHeight * cfg.residentialHeightFactor),
	park: () => 0,
};
const ZONE_EMITTERS: Readonly<Record<Zone, (ctx: EmitContext, plan: BlockPlan) => void>> = {
	commercial: emitLots,
	residential: emitLots,
	park: emitParkTrees,
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t: number = clamp((x - edge0) / (edge1 - edge0), 0, 1);

	return t * t * (3 - 2 * t);
}

function clampInt(value: number, min: number, max: number): number {
	return clamp(Math.round(value), min, max);
}

function sanitize(cfg: CityConfig): CityConfig {
	const lotSize: number = clampInt(cfg.lotSize, LIMITS.lotSize.min, LIMITS.lotSize.max);
	const streetWidth: number = clamp(cfg.streetWidth, 0, 24);

	return {
		...cfg,
		seed: Math.floor(cfg.seed),
		daylight: clamp(cfg.daylight, 0, HOURS_PER_DAY),
		gridChaos: clamp(cfg.gridChaos, 0, 1),
		commercialDensity: clamp(cfg.commercialDensity, 0, 1),
		residentialDensity: clamp(cfg.residentialDensity, 0, 1),
		blocks: clampInt(cfg.blocks, LIMITS.blocks.min, LIMITS.blocks.max),
		lotsPerBlock: clampInt(cfg.lotsPerBlock, LIMITS.lotsPerBlock.min, LIMITS.lotsPerBlock.max),
		lotSize,
		lotMargin: clampInt(cfg.lotMargin, 0, lotSize - 2),
		streetWidth,
		padOverhang: clamp(cfg.padOverhang, 0, streetWidth),
		padThickness: clamp(cfg.padThickness, 0.05, 1),
		maxHeight: clampInt(cfg.maxHeight, 1, 200),
		minBuildingHeight: clampInt(cfg.minBuildingHeight, 1, 50),
		heightVariance: clamp(cfg.heightVariance, 0, 1),
		setbackFrequency: clamp(cfg.setbackFrequency, 0, 1),
		vacantLotChance: clamp(cfg.vacantLotChance, 0, 1),
		minResidentialScale: clampInt(cfg.minResidentialScale, 1, 50),
		residentialHeightFactor: clamp(cfg.residentialHeightFactor, 0.01, 1),
		windowDensity: clamp(cfg.windowDensity, 0, 1),
		windowLitChance: clamp(cfg.windowLitChance, 0, 1),
		windowFloorHeight: clampInt(cfg.windowFloorHeight, 1, 8),
		treeMin: clampInt(cfg.treeMin, 0, 40),
		treeSpread: clampInt(cfg.treeSpread, 0, 40),
	};
}

function deriveMetrics(cfg: CityConfig): CityMetrics {
	const blockSize: number = cfg.lotsPerBlock * cfg.lotSize;
	const blockPitch: number = blockSize + cfg.streetWidth;

	return { blockSize, blockPitch, citySpan: cfg.blocks * blockPitch };
}

function districtIndex(bx: number, by: number, cfg: CityConfig): number {
	const n: number = Utils.valueNoise2(bx * 0.16, by * 0.16, cfg.seed ^ 0x2545f491);

	return Math.min(Math.floor(n * DISTRICT_PALETTES.length), DISTRICT_PALETTES.length - 1);
}

function buildingColor(rand: () => number, district: number, cfg: CityConfig): THREE.Color {
	if (cfg.neighborhoodPaletteSync) {
		const palette: readonly string[] = DISTRICT_PALETTES[district];

		return new THREE.Color(palette[Math.floor(rand() * palette.length)]);
	}

	return new THREE.Color().setHSL(rand(), 0.3 + rand() * 0.35, 0.42 + rand() * 0.22);
}

function planBlock(bx: number, by: number, ctx: EmitContext): BlockPlan {
	const { cfg, metrics } = ctx;
	const half: number = metrics.citySpan / 2;
	const centerX: number = bx * metrics.blockPitch - half + metrics.blockSize / 2;
	const centerZ: number = by * metrics.blockPitch - half + metrics.blockSize / 2;
	const zone: Zone = Utils.pickZone(bx, by, cfg);

	return {
		zone,
		district: districtIndex(bx, by, cfg),
		centerX,
		centerZ,
		originX: centerX - metrics.blockSize / 2,
		originZ: centerZ - metrics.blockSize / 2,
		baseHeight: 0.35 + 0.65 * Utils.valueNoise2(bx * 0.6, by * 0.6, cfg.seed ^ 0x3c6ef372),
		heightScale: ZONE_HEIGHT_SCALE[zone](cfg),
	};
}

function emitWindowPane(
	ctx: EmitContext,
	grid: WindowGrid,
	face: WindowFace,
	wy: number,
	offset: number
): void {
	const { windows, windowRand, cfg } = ctx;

	if (windowRand() > cfg.windowDensity) return;

	const lit: boolean = windowRand() < ctx.windowPalette.litChance;
	// Wall-local placement, rotated into the tier's own frame.
	const lx: number = face.nx * grid.wall + face.nz * offset;
	const lz: number = face.nz * grid.wall + face.nx * offset;

	windows.push({
		x: grid.cx + lx * grid.cos + lz * grid.sin,
		y: wy - grid.paneH / 2,
		z: grid.cz - lx * grid.sin + lz * grid.cos,
		sx: Math.abs(face.nx) * WINDOW_DEPTH + Math.abs(face.nz) * grid.paneW,
		sy: grid.paneH,
		sz: Math.abs(face.nz) * WINDOW_DEPTH + Math.abs(face.nx) * grid.paneW,
		rotY: grid.rotY,
		color: (lit ? ctx.windowPalette.lit : ctx.windowPalette.dark)
			.clone()
			.offsetHSL(0, 0, (windowRand() - 0.5) * 0.08)
	});
}

function emitTierWindows(
	ctx: EmitContext,
	cx: number,
	cz: number,
	baseY: number,
	tierH: number,
	size: number,
	rotY: number
): void {
	const { cfg } = ctx;

	if (cfg.windowDensity <= 0) return;
	if (ctx.windows.length >= MAX_WINDOW_INSTANCES) return;

	const rows: number = Math.floor(tierH / cfg.windowFloorHeight);

	if (rows < 1) return;

	const cols: number = Math.max(1, Math.round(size / 2));
	const spacing: number = size / cols;
	const grid: WindowGrid = {
		cx,
		cz,
		wall: size / 2,
		paneW: spacing * 0.5,
		paneH: Math.min(WINDOW_MAX_HEIGHT, cfg.windowFloorHeight * 0.5),
		rotY,
		cos: Math.cos(rotY),
		sin: Math.sin(rotY)
	};

	for (let r: number = 0; r < rows; r++) {
		const wy: number = baseY + cfg.windowFloorHeight * (r + 0.5);

		for (let c: number = 0; c < cols; c++) {
			const offset: number = -size / 2 + spacing * (c + 0.5);

			for (const face of WINDOW_FACES) {
				emitWindowPane(ctx, grid, face, wy, offset);
			}
		}
	}
}

function emitBuilding(
	ctx: EmitContext,
	plan: BlockPlan,
	cx: number,
	cz: number,
	totalHeight: number,
): void {
	const { out, rand, cfg } = ctx;
	let size: number = cfg.lotSize - cfg.lotMargin;
	let y: number = 0;
	const baseColor: THREE.Color = buildingColor(rand, plan.district, cfg);
	const rotY: number = (rand() - 0.5) * cfg.gridChaos * 0.35; // slight grid distortion

	while (y < totalHeight && size >= 2) {
		const remaining: number = totalHeight - y;
		const tierH: number = Utils.nextTierHeight(remaining, rand, cfg);

		// Upper tiers get subtly lighter for readable silhouettes.
		const tint: THREE.Color = baseColor.clone().offsetHSL(0, 0, Math.min(0.12, y * 0.004));

		out.push({
			x: cx,
			y,
			z: cz,
			sx: size,
			sy: tierH,
			sz: size,
			rotY,
			color: tint
		});
		emitTierWindows(ctx, cx, cz, y, tierH, size, rotY);
		y += tierH;

		if (tierH === remaining) break;

		size -= 2; // step inward one voxel per side
	}
}

function emitLot(ctx: EmitContext, plan: BlockPlan, lx: number, lz: number): void {
	const { rand, cfg } = ctx;

	if (rand() < cfg.vacantLotChance) return;

	const lotRoll: number = rand();
	const height: number = Math.max(
		cfg.minBuildingHeight,
		Math.round(Utils.lerp(plan.baseHeight, lotRoll, cfg.heightVariance) * plan.heightScale),
	);

	// gridChaos jitters each lot off its perfect grid position.
	const jitter: number = cfg.gridChaos * (cfg.streetWidth * 0.5);
	const cx: number = plan.originX + cfg.lotSize / 2 + lx * cfg.lotSize + (rand() - 0.5) * jitter;
	const cz: number = plan.originZ + cfg.lotSize / 2 + lz * cfg.lotSize + (rand() - 0.5) * jitter;

	emitBuilding(ctx, plan, cx, cz, height);
}

function emitLots(ctx: EmitContext, plan: BlockPlan): void {
	for (let lx: number = 0; lx < ctx.cfg.lotsPerBlock; lx++) {
		for (let lz: number = 0; lz < ctx.cfg.lotsPerBlock; lz++) {
			emitLot(ctx, plan, lx, lz);
		}
	}
}

function emitParkTrees(ctx: EmitContext, plan: BlockPlan): void {
	const { out, rand, cfg, metrics } = ctx;
	const trees: number = cfg.treeMin + Math.floor(rand() * cfg.treeSpread);
	const spread: number = Math.max(0, metrics.blockSize - 3);

	for (let t: number = 0; t < trees; t++) {
		const tx: number = plan.centerX + (rand() - 0.5) * spread;
		const tz: number = plan.centerZ + (rand() - 0.5) * spread;
		const th: number = 1 + Math.round(rand() * 2);

		out.push({
			x: tx,
			y: cfg.padThickness,
			z: tz,
			sx: 1,
			sy: th,
			sz: 1,
			rotY: 0,
			color: TREE_GREEN.clone(),
		});
	}
}

function emitPad(ctx: EmitContext, plan: BlockPlan): void {
	const { cfg, metrics } = ctx;

	ctx.out.push({
		x: plan.centerX,
		y: 0,
		z: plan.centerZ,
		sx: metrics.blockSize + cfg.padOverhang,
		sy: cfg.padThickness,
		sz: metrics.blockSize + cfg.padOverhang,
		rotY: 0,
		color: PAD_COLOR[plan.zone].clone(),
	});
}

function emitBlock(ctx: EmitContext, bx: number, by: number): void {
	const plan: BlockPlan = planBlock(bx, by, ctx);

	emitPad(ctx, plan);
	ZONE_EMITTERS[plan.zone](ctx, plan);
}

function generateCity(cfg: CityConfig, metrics: CityMetrics): CityGeometry {
	const ctx: EmitContext = {
		out: [],
		windows: [],
		windowPalette: buildWindowPalette(cfg),
		rand: Utils.mulberry32(cfg.seed),
		// Separate stream, so window rolls never perturb the city layout.
		windowRand: Utils.mulberry32(cfg.seed ^ 0x5bf03635),
		cfg,
		metrics
	};

	for (let bx: number = 0; bx < cfg.blocks; bx++) {
		for (let by: number = 0; by < cfg.blocks; by++) {
			emitBlock(ctx, bx, by);
		}
	}

	return {
		solids: ctx.out,
		windows: ctx.windows
	};
}

function createScene(
	mount: HTMLElement,
	cfg: CityConfig,
	metrics: CityMetrics,
	className?: string
): SceneRefs {
	const width: number = window.innerWidth;
	const height: number = window.innerHeight;
	const renderer: THREE.WebGLRenderer = new THREE.WebGLRenderer({ antialias: true });

	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(width, height);
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	Utils.styleCanvasFullscreen(renderer.domElement, className);
	mount.appendChild(renderer.domElement);

	const scene: THREE.Scene = new THREE.Scene();
	scene.background = new THREE.Color(SKY_DAY);

	const fog: THREE.Fog = new THREE.Fog(SKY_DAY, 1, 2);
	scene.fog = fog;

	const camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(50, width / height, 0.5, 10);
	const controls: OrbitControls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.maxPolarAngle = Math.PI * 0.49; // stay above ground
	controls.minDistance = 15;

	const sun: THREE.DirectionalLight = new THREE.DirectionalLight(SUN_DAY, SUN_MAX_INTENSITY);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	sun.shadow.bias = -0.0005;
	sun.shadow.radius = 3;
	scene.add(sun);
	const ambient: THREE.AmbientLight = new THREE.AmbientLight(AMBIENT_DAY, 0.9);

	scene.add(ambient);

	// Unit plane, scaled in applyMetrics — avoids rebuilding geometry per tweak.
	const ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial> = new THREE.Mesh(
		new THREE.PlaneGeometry(1, 1),
		new THREE.MeshLambertMaterial({ color: ROAD_GRAY }),
	);

	ground.rotation.x = -Math.PI / 2;
	ground.receiveShadow = true;
	scene.add(ground);

	const refs: SceneRefs = {
		renderer,
		scene,
		camera,
		controls,
		sun,
		ambient,
		fog,
		boxGeometry: new THREE.BoxGeometry(1, 1, 1),
		material: new THREE.MeshLambertMaterial(),
		cityMesh: null,
		windowMesh: null,
		windowMaterial: new THREE.MeshBasicMaterial(),
		ground,
		frameId: 0,
	};

	applyMetrics(refs, metrics);
	applyDaylight(refs, cfg, metrics);
	resetView(refs, metrics);

	return refs;
}

function buildWindowPalette(cfg: CityConfig): WindowPalette {
	const solar: SolarState = solarState(cfg.daylight);

	return windowPalette(cfg, skyColor(solar), solar);
}

function solarState(hour: number): SolarState {
	const angle: number = ((hour - SUNRISE_HOUR) / (HOURS_PER_DAY / 2)) * Math.PI;
	const elevation: number = Math.sin(angle);
	const east: number = -Math.cos(angle);
	// Tilt keeps the noon sun off dead-centre, so buildings always cast something.
	const length: number = Math.hypot(east, elevation, SUN_TILT);

	return {
		dirX: east / length,
		dirY: elevation / length,
		dirZ: SUN_TILT / length,
		elevation,
		dayFactor: smoothstep(-0.3, 0.3, elevation)
	};
}

function skyColor(solar: SolarState): THREE.Color {
	// Night -> dusk while the sun is below the horizon, dusk -> day above it.
	return solar.dayFactor < 0.5
		? SKY_NIGHT.clone().lerp(SKY_DUSK, smoothstep(0, 0.5, solar.dayFactor))
		: SKY_DUSK.clone().lerp(SKY_DAY, smoothstep(0.5, 1, solar.dayFactor));
}

function windowPalette(cfg: CityConfig, sky: THREE.Color, solar: SolarState): WindowPalette {
	const darkness: number = 1 - solar.dayFactor;

	return {
		lit: WINDOW_LIT.clone(),
		// By day, dark glass reads as a sky reflection rather than a black hole.
		dark: WINDOW_DARK.clone().lerp(sky.clone().multiplyScalar(0.55), solar.dayFactor),
		litChance: cfg.windowLitChance * darkness
	};
}

function applyDaylight(refs: SceneRefs, cfg: CityConfig, metrics: CityMetrics): void {
	const solar: SolarState = solarState(cfg.daylight);
	const sky: THREE.Color = skyColor(solar);

	if (refs.scene.background instanceof THREE.Color) refs.scene.background.copy(sky);

	refs.fog.color.copy(sky);

	const radius: number = metrics.citySpan * 0.9;

	refs.sun.position.set(solar.dirX * radius, solar.dirY * radius, solar.dirZ * radius);
	refs.sun.intensity = SUN_MAX_INTENSITY * smoothstep(-0.1, 0.3, solar.elevation);
	refs.sun.color.copy(SUN_DUSK).lerp(SUN_DAY, smoothstep(0.05, 0.4, solar.elevation));
	// Nothing to project once the sun is down; skip the shadow pass entirely.
	refs.sun.castShadow = solar.elevation > 0;

	applyShadowFrustum(refs, metrics, solar);

	refs.ambient.color.copy(AMBIENT_NIGHT).lerp(AMBIENT_DAY, solar.dayFactor);
	refs.ambient.intensity = Utils.lerp(0.15, 0.9, solar.dayFactor);
}

function applyShadowFrustum(refs: SceneRefs, metrics: CityMetrics, solar: SolarState): void {
	const stretch: number = clamp(1 / Math.max(solar.dirY, 0.2), 1, SHADOW_MAX_STRETCH);
	const extent: number = metrics.citySpan * 0.7 * stretch;
	const camera: THREE.OrthographicCamera = refs.sun.shadow.camera;

	camera.left = -extent;
	camera.right = extent;
	camera.top = extent;
	camera.bottom = -extent;
	camera.far = metrics.citySpan * 0.9 + extent * 2;
	camera.updateProjectionMatrix();
}

function applyMetrics(refs: SceneRefs, metrics: CityMetrics): void {
	const span: number = metrics.citySpan;

	refs.camera.far = span * 4;
	refs.camera.updateProjectionMatrix();
	refs.fog.near = span * 0.9;
	refs.fog.far = span * 2.4;
	refs.controls.maxDistance = span * 1.8;

	refs.ground.scale.set(span * 3, span * 3, 1);
}

function disposeCityMeshes(refs: SceneRefs): void {
	if (refs.cityMesh) {
		refs.scene.remove(refs.cityMesh);
		refs.cityMesh.dispose();
		refs.cityMesh = null;
	}

	if (refs.windowMesh) {
		refs.scene.remove(refs.windowMesh);
		refs.windowMesh.dispose();
		refs.windowMesh = null;
	}
}

function resetView(refs: SceneRefs, metrics: CityMetrics): void {
	const span: number = metrics.citySpan;

	refs.camera.position.set(span * 0.55, span * 0.45, span * 0.55);
	refs.controls.target.set(0, 6, 0);
	refs.controls.update();
}

function createGui(target: CityConfig, actions: GuiActions, onCommit: () => void): GUI {
	const gui: GUI = new GUI({ width: 320 });

	gui.domElement.parentElement?.style.setProperty("z-index", "1");
	gui.add(target, "seed").step(1).name("Seed").onFinishChange(onCommit);
	gui.add(target, "daylight", 0, HOURS_PER_DAY, 0.25).name("Hour of day").onChange(onCommit);
	gui.add(target, "neighborhoodPaletteSync").name("Palette sync").onFinishChange(onCommit);
	gui.add(actions, "randomizeSeed").name("Randomize seed");
	gui.add(actions, "resetView").name("Reset View");

	for (const spec of GUI_FOLDERS) {
		const folder: GUI = gui.addFolder(spec.folder);

		for (const param of spec.params) {
			folder
				.add(target, param.key, param.min, param.max, param.step)
				.name(param.label)
				.onFinishChange(onCommit);
		}
	}

	gui.__folders["City Grid"]?.open();

	return gui;
}

function VoxelCity({
	config: userConfig,
	mount,
	className,
	showGui = true,
}: Readonly<VoxelCityProps>): null {
	const sceneRef: React.RefObject<SceneRefs | null> = useRef<SceneRefs | null>(null);
	const guiRef: React.RefObject<GUI | null> = useRef<GUI | null>(null);
	const configKey: string = JSON.stringify(userConfig ?? {});
	const baseConfig: CityConfig = useMemo<CityConfig>(
		() => sanitize({
			...DEFAULT_CITY_CONFIG,
			...(JSON.parse(configKey) as Partial<CityConfig>)
		}),
		[configKey],
	);
	const liveConfig: React.RefObject<CityConfig> = useRef<CityConfig>({ ...baseConfig });
	const appliedBase: React.RefObject<CityConfig> = useRef<CityConfig>(baseConfig);
	const [revision, bumpRevision] = useReducer((n: number): number => n + 1, 0);

	const rebuildCity: () => void = useEffectEvent(() => {
		const refs: SceneRefs | null = sceneRef.current;

		if (!refs) return;

		const cfg: CityConfig = sanitize(liveConfig.current);
		Object.assign(liveConfig.current, cfg);
		guiRef.current?.updateDisplay();

		const metrics: CityMetrics = deriveMetrics(cfg);
		applyMetrics(refs, metrics);
		applyDaylight(refs, cfg, metrics);

		disposeCityMeshes(refs);

		const geometry: CityGeometry = generateCity(cfg, metrics);

		refs.cityMesh = Utils.buildCityMesh(geometry.solids, refs.boxGeometry, refs.material);
		refs.scene.add(refs.cityMesh);

		if (geometry.windows.length === 0) return;

		refs.windowMesh = Utils.buildCityMesh(
			geometry.windows,
			refs.boxGeometry,
			refs.windowMaterial
		);
		// Panes sit proud of the wall by a fraction of a voxel; letting them cast
		// or receive shadows only produces acne along every facade.
		refs.windowMesh.castShadow = false;
		refs.windowMesh.receiveShadow = false;
		refs.scene.add(refs.windowMesh);
	});
	const resolveMount: () => HTMLElement = useEffectEvent(
		(): HTMLElement => mount ?? document.body
	);
	const resolveClassName: () => string | undefined = useEffectEvent(
		(): string | undefined => className
	);
	const resolveShowGui: () => boolean = useEffectEvent((): boolean => showGui);

	useEffect(() => {
		const cfg: CityConfig = liveConfig.current;
		const refs: SceneRefs = createScene(
			resolveMount(),
			cfg,
			deriveMetrics(cfg),
			resolveClassName()
		);
		sceneRef.current = refs;

		if (resolveShowGui()) {
			guiRef.current = createGui(
				cfg,
				{
					randomizeSeed: (): void => {
						cfg.seed = Math.floor(Utils.random() * 1_000_000);
						guiRef.current?.updateDisplay();
						bumpRevision();
					},
					resetView: (): void => resetView(refs, deriveMetrics(sanitize(cfg))),
				},
				bumpRevision,
			);
		}

		const animate = (): void => {
			refs.frameId = requestAnimationFrame(animate);
			refs.controls.update();
			refs.renderer.render(refs.scene, refs.camera);
		};
		animate();

		const handleResize = (): void => {
			const w: number = window.innerWidth;
			const h: number = window.innerHeight;

			if (w === 0 || h === 0) return;

			refs.camera.aspect = w / h;
			refs.camera.updateProjectionMatrix();
			refs.renderer.setSize(w, h);
		};

		window.addEventListener("resize", handleResize);
		window.visualViewport?.addEventListener("resize", handleResize);

		return () => {
			window.removeEventListener("resize", handleResize);
			window.visualViewport?.removeEventListener("resize", handleResize);
			guiRef.current?.destroy();
			guiRef.current = null;
			disposeCityMeshes(refs);
			refs.windowMaterial.dispose();
			Utils.disposeScene(refs);
			sceneRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (appliedBase.current !== baseConfig) {
			Object.assign(liveConfig.current, baseConfig);
			appliedBase.current = baseConfig;
			guiRef.current?.updateDisplay();
		}

		rebuildCity();
	}, [baseConfig, revision]);

	return null;
}

class Utils {
	static random(): number {
		return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
	}

	static mulberry32(seed: number): () => number {
		let a: number = seed >>> 0;
	
		return (): number => {
			// Must wrap modulo 2^32; plain truncation would let `a` drift past 2^53
			// and silently degrade the sequence.
			a = (a + 0x6d2b79f5) % 0x100000000;
	
			let t: number = Math.imul(a ^ (a >>> 15), 1 | a);
	
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}
	
	static hash2(ix: number, iy: number, seed: number): number {
		let h: number = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
		
		h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
		h ^= h >>> 13;
	
		return (h >>> 0) / 4294967296;
	}
	
	static valueNoise2(x: number, y: number, seed: number): number {
		const ix: number = Math.floor(x);
		const iy: number = Math.floor(y);
		const fx: number = x - ix;
		const fy: number = y - iy;
		const sx: number = fx * fx * (3 - 2 * fx);
		const sy: number = fy * fy * (3 - 2 * fy);
		const a: number = this.hash2(ix, iy, seed);
		const b: number = this.hash2(ix + 1, iy, seed);
		const c: number = this.hash2(ix, iy + 1, seed);
		const d: number = this.hash2(ix + 1, iy + 1, seed);
		const top: number = a + (b - a) * sx;
		const bot: number = c + (d - c) * sx;
	
		return top + (bot - top) * sy;
	}
	
	static lerp(a: number, b: number, t: number): number {
		return a + (b - a) * t;
	}
	
	static pickZone(bx: number, by: number, cfg: CityConfig): Zone {
		const comm: number = this.valueNoise2(bx * 0.35, by * 0.35, cfg.seed ^ 0x9e3779b9) * cfg.commercialDensity;
		const res: number = this.valueNoise2(bx * 0.35 + 71.3, by * 0.35 + 19.7, cfg.seed ^ 0x51ab7c11) * cfg.residentialDensity;
	
		if (Math.max(comm, res) < 0.12) return "park";
	
		return comm >= res ? "commercial" : "residential";
	}

	static nextTierHeight(remaining: number, rand: () => number, cfg: CityConfig): number {
		if (remaining <= 3 || rand() >= cfg.setbackFrequency) return remaining;

		return Math.max(2, Math.round(remaining * (0.35 + rand() * 0.4)));
	}
	
	static buildCityMesh(
		instances: readonly VoxelInstance[],
		geometry: THREE.BoxGeometry,
		material: THREE.Material,
	): THREE.InstancedMesh {
		const mesh: THREE.InstancedMesh = new THREE.InstancedMesh(geometry, material, instances.length);
		const temp: THREE.Object3D = new THREE.Object3D();
	
		for (let i: number = 0; i < instances.length; i++) {
			const v: VoxelInstance = instances[i];
	
			temp.position.set(v.x, v.y + v.sy / 2, v.z);
			temp.rotation.set(0, v.rotY, 0);
			temp.scale.set(v.sx, v.sy, v.sz);
			temp.updateMatrix();
			mesh.setMatrixAt(i, temp.matrix);
			mesh.setColorAt(i, v.color);
		}
	
		mesh.instanceMatrix.needsUpdate = true;
	
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	
		mesh.castShadow = true;
		mesh.receiveShadow = true;
	
		return mesh;
	}
	
	static styleCanvasFullscreen(canvas: HTMLCanvasElement, className?: string): void {
		canvas.style.position = "fixed";
		canvas.style.top = "0";
		canvas.style.left = "0";
		canvas.style.display = "block";
		canvas.style.touchAction = "none";
		canvas.style.outline = "none";
	
		if (className) canvas.className = className;
	}
	
	static disposeScene(refs: SceneRefs): void {
		cancelAnimationFrame(refs.frameId);
		refs.controls.dispose();
	
		if (refs.cityMesh) {
			refs.scene.remove(refs.cityMesh);
			refs.cityMesh.dispose();
		}
	
		refs.boxGeometry.dispose();
		refs.material.dispose();
		refs.ground.geometry.dispose();
		refs.ground.material.dispose();
		refs.renderer.dispose();
		refs.renderer.domElement.remove();
	}
}

interface VoxelCityProps {
	config?: Partial<CityConfig>;
	mount?: HTMLElement | null;
	className?: string;
	showGui?: boolean;
}

interface BlockPlan {
	zone: Zone;
	district: number;
	centerX: number;
	centerZ: number;
	originX: number;
	originZ: number;
	baseHeight: number;
	heightScale: number;
}

interface CityConfig {
	seed: number;
	daylight: number;
	gridChaos: number;
	commercialDensity: number;
	residentialDensity: number;
	blocks: number;
	lotsPerBlock: number;
	lotSize: number;
	lotMargin: number;
	streetWidth: number;
	padOverhang: number;
	padThickness: number;
	maxHeight: number;
	minBuildingHeight: number;
	heightVariance: number;
	setbackFrequency: number;
	vacantLotChance: number;
	minResidentialScale: number;
	residentialHeightFactor: number;
	windowDensity: number;
	windowLitChance: number;
	windowFloorHeight: number;
	treeMin: number;
	treeSpread: number;
	neighborhoodPaletteSync: boolean;
}
 
interface CityGeometry {
	solids: VoxelInstance[];
	windows: VoxelInstance[];
}

interface CityMetrics {
	blockSize: number;
	blockPitch: number;
	citySpan: number;
}

interface EmitContext {
	out: VoxelInstance[];
	windows: VoxelInstance[];
	windowPalette: WindowPalette;
	rand: () => number;
	windowRand: () => number;
	cfg: CityConfig;
	metrics: CityMetrics;
}

interface GuiActions {
	randomizeSeed: () => void;
	resetView: () => void;
}

interface GuiFolderSpec {
	folder: string;
	params: readonly GuiNumericParam[];
}

interface GuiNumericParam {
	key: NumericConfigKey;
	label: string;
	min: number;
	max: number;
	step: number;
}

interface SceneRefs {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	controls: OrbitControls;
	sun: THREE.DirectionalLight;
	ambient: THREE.AmbientLight;
	fog: THREE.Fog;
	boxGeometry: THREE.BoxGeometry;
	material: THREE.MeshLambertMaterial;
	cityMesh: THREE.InstancedMesh | null;
	windowMesh: THREE.InstancedMesh | null;
	windowMaterial: THREE.MeshBasicMaterial;
	ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
	frameId: number;
}

interface VoxelInstance {
	x: number;
	y: number;
	z: number;
	sx: number;
	sy: number;
	sz: number;
	rotY: number;
	color: THREE.Color;
}

interface WindowFace {
	nx: number;
	nz: number;
}

interface SolarState {
	dirX: number;
	dirY: number;
	dirZ: number;
	elevation: number;
	dayFactor: number;
}

interface WindowPalette {
	lit: THREE.Color;
	dark: THREE.Color;
	litChance: number;
}

interface WindowGrid {
	cx: number;
	cz: number;
	wall: number;
	paneW: number;
	paneH: number;
	rotY: number;
	cos: number;
	sin: number;
}

type ConfigurationLimits = {
    blocks: ConfigurationRange;
    lotsPerBlock: ConfigurationRange;
    lotSize: ConfigurationRange;
};

type ConfigurationRange = {
    min: number;
    max: number;
};

type NumericConfigKey = {
	[K in keyof CityConfig]: CityConfig[K] extends number ? K : never;
}[keyof CityConfig];

type Zone = "commercial" | "residential" | "park";