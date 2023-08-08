'use strict';

const COLORS = {
	EXTRA: ['rgba(24, 150, 211, 1)', 'rgba(87, 200, 255, 1)'],
	PERFECT: ['rgba(87, 200, 255, 1)', 'rgba(113, 240, 255, 1)'],
	GOOD: ['rgba(21, 152, 86, 1)', 'rgba(122, 238, 122, 1)'],
	SLOW: ['rgba(248, 222, 74, 1)', 'rgba(255, 238, 0, 1)'],
	NEUTRAL: ['rgba(178, 178, 178, 1)', 'rgba(255, 255, 255, 1)'],
	LOSS: ['rgba(220, 116, 13, 1)', 'rgba(255, 188, 0, 1)'],
	STOP: ['rgba(211, 24, 24, 1)', 'rgba(255, 87, 87, 1)']
};

const SYNC_STATES = {
	SYNCED: 0,
	UNSYNCED: 1,
	NOMOVE: 2,
	LOSS: 3
};

const GRAPH_COLORS = {
	[SYNC_STATES.SYNCED]: COLORS.NEUTRAL[1],
	[SYNC_STATES.UNSYNCED]: COLORS.LOSS[1],
	[SYNC_STATES.NOMOVE]: COLORS.STOP[1],
	[SYNC_STATES.LOSS]: COLORS.STOP[0]
};

const DEFAULT_BUFFER_LENGTH = 10;
const DEFAULT_MIN_SPEED = 200;
const DEFAULT_SETTING_ON = 1;
const DEFAULT_SETTING_OFF = 0;
const DEFAULT_GRAPH_BUFFER_LENGTH = 80;
const DEFAULT_GRAPH_MODE = 1;

class Synchronizer {
	static panels = {
		wrapper: $('#BarWrapper'),
		segments: [$('#Segment0'), $('#Segment1'), $('#Segment2'), $('#Segment3'), $('#Segment4')],
		background: $('#Background'),
		container: $('#Container'),
		needle: $('#Needle'),
		stats: [$('#StatsUpper'), $('#StatsLower')],
		graphContainer: $('#GraphContainer'),
		graph: $('#SynchroGraph')
	};

	static rad2deg = 180 / Math.PI;
	static deg2rad = 1 / this.rad2deg;
	static indicatorPercentage = 90; // this value shows ~90% gain or better when strafe indicator touches needle
	static strafeDirPercentage = 2 / 75;
	static bIsFirstPanelColored = true; // gets toggled in wrapValueToRange()
	static maxSegmentWidth = 25; // percentage of total element width
	static firstPanelWidth = this.maxSegmentWidth;
	static syncGain = 10; // scale how fast the bars move
	static altColor = 'rgba(0, 0, 0, 0.0)';
	static lastAngle = 0;
	static lastSynchroDir = 1;

	static onLoad() {
		this.initializeSettings();

		if (this.statMode) this.onJump(); // show stats if enabled
	}

	static onUpdate() {
		const lastMoveData = MomentumMovementAPI.GetLastMoveData();
		const lastTickStats = MomentumMovementAPI.GetLastTickStats();
		const viewAngle = MomentumPlayerAPI.GetAngles().y;

		//zero buffers
		this.addToBuffer(this.gainRatioHistory, 0);
		this.addToBuffer(this.yawRatioHistory, 0);

		const bValidWishMove = this.getSize(lastMoveData.wishdir) > 0.1;
		const angleDelta = this.wrapValueToRange(this.lastAngle - viewAngle, -180, 180);
		this.lastAngle = viewAngle;
		const turnDir = angleDelta > 0 ? 1 : angleDelta < 0 ? -1 : 0;

		const direction = this.dynamicEnable === 1 ? turnDir || this.lastSynchroDir : 1;
		this.lastSynchroDir = direction;
		const flip = this.flipEnable === 1 ? -1 : 1;

		if (this.getSizeSquared(MomentumPlayerAPI.GetVelocity()) > Math.pow(this.minSpeed, 2)) {
			this.gainRatioHistory[this.interpFrames - 1] =
				this.sampleWeight * this.NaNCheck(lastTickStats.speedGain / lastTickStats.idealGain, 0);

			const ratio = this.displayMode > 2 ? 1 - lastTickStats.yawRatio : Math.abs(lastTickStats.yawRatio);
			this.yawRatioHistory[this.interpFrames - 1] = this.sampleWeight * this.NaNCheck(ratio, 0);
		}

		const gainRatio = this.getBufferedSum(this.gainRatioHistory);
		const yawRatio = this.getBufferedSum(this.yawRatioHistory);

		if (this.shouldDraw()) {
			this.addToBufferFront(this.graphHistory, {
				ratio: yawRatio,
				flow: direction * flip,
				gainRatio: gainRatio,
				syncState: this.getSyncState(bValidWishMove, lastTickStats.speedGain),
				strafeDir: (bValidWishMove ? 1 : 0) * lastTickStats.strafeRight
			});
		}

		const colorTuple = this.colorEnable
			? this.getColorTuple(gainRatio, false) //strafeRight * yawRatio > 1)
			: COLORS.NEUTRAL;
		const color = `gradient(linear, 0% 0%, 0% 100%, from(${colorTuple[0]}), to(${colorTuple[1]}))`;
		let flow;

		switch (this.displayMode) {
			case 1: // "Half-width throttle"
				flow = direction * flip;
				this.panels.container.style.flowChildren = flow < 0 ? 'left' : 'right';
				this.panels.segments[0].style.backgroundColor = color;
				this.panels.segments[0].style.width = (yawRatio * 50).toFixed(3) + '%';
				break;
			case 2: {
				// "Full-width throttle"
				const absRatio = Math.abs(gainRatio);
				flow = direction * (yawRatio > 1 ? -1 : 1) * flip;
				this.panels.container.style.flowChildren = flow < 0 ? 'left' : 'right';
				this.panels.segments[0].style.backgroundColor = color;
				this.panels.segments[0].style.width = (absRatio * 100).toFixed(3) + '%';
				break;
			}
			case 3: {
				// "Strafe indicator"
				this.panels.container.style.flowChildren = flip < 0 ? 'left' : 'right';
				//const offset = Math.min(Math.max(0.5 - (0.5 * direction * syncDelta) / idealDelta, 0), 1);
				const offset = Math.min(Math.max(0.5 - 0.5 * direction * yawRatio, 0), 1);
				this.panels.segments[0].style.width = (offset * this.indicatorPercentage).toFixed(3) + '%';
				this.panels.segments[1].style.backgroundColor = color;
				break;
			}
			case 4: // "Synchronizer"
				this.panels.container.style.flowChildren = flip < 0 ? 'left' : 'right';
				this.firstPanelWidth += this.syncGain * direction * yawRatio * lastTickStats.idealGain;
				this.firstPanelWidth = this.wrapValueToRange(this.firstPanelWidth, 0, this.maxSegmentWidth, true);
				this.panels.segments[0].style.width =
					this.NaNCheck(this.firstPanelWidth.toFixed(3), this.maxSegmentWidth) + '%';
				for (const [i, segment] of this.panels.segments.entries()) {
					const index = i + (this.bIsFirstPanelColored ? 1 : 0);
					segment.style.backgroundColor = index % 2 ? color : this.altColor;
				}
				break;
		}

		if (this.shouldDraw()) this.draw();
	}

	static shouldDraw() {
		return this.statMode !== 2 && this.graphMode > 0 && (this.displayMode === 1 || this.displayMode === 3);
	}

	static draw() {
		this.panels.graph.Clear(this.altColor);
		this.initializeGraph();

		switch (this.displayMode) {
			case 1:
				this.drawHalfWidthRects();
				break;
			case 3:
				this.drawIndicatorRects();
				break;
		}

		if (this.dynamicEnable === 1) this.drawStrafeDirRects();
	}

	static drawHalfWidthRects() {
		for (let i = 0; i < this.graphHistory.length; i++) {
			const { ratio, flow, gainRatio, syncState } = this.graphHistory[i];

			if (ratio <= 0) continue;

			const dynamicRatio = flow === 1 ? ratio : 2 - ratio;

			const pointA = this.getCanvasPoint(i, dynamicRatio / 2);
			const pointB = this.getCanvasPoint(i + 1, dynamicRatio / 2);
			const pointC = this.getCanvasPoint(i + 1, flow === 1 ? 0 : 1);
			const pointD = this.getCanvasPoint(i, flow === 1 ? 0 : 1);

			const points =
				flow === 1
					? [...pointA, ...pointB, ...pointC, ...pointD]
					: [...pointA, ...pointD, ...pointC, ...pointB];

			const colorTuple = this.getColorTuple(gainRatio, false) ?? COLORS.NEUTRAL;

			const color = this.colorEnable ? colorTuple : GRAPH_COLORS[syncState];

			this.panels.graph.DrawPoly(4, points, color);
		}
	}

	static drawIndicatorRects() {
		for (let i = 0; i < this.graphHistory.length; i++) {
			const { ratio, flow, gainRatio, syncState } = this.graphHistory[i];

			if (ratio <= 0) continue;

			const offset = Math.min(Math.max(0.5 - 0.5 * ratio, 0), 1);
			let left = (offset * this.indicatorPercentage) / 100;
			let right = left + 0.1;

			if (flow === -1) {
				left = 1 - left;
				right = 1 - right;
			}

			const pointA = this.getCanvasPoint(i, right);
			const pointB = this.getCanvasPoint(i + 1, right);
			const pointC = this.getCanvasPoint(i + 1, left);
			const pointD = this.getCanvasPoint(i, left);

			const points =
				flow === 1
					? [...pointA, ...pointB, ...pointC, ...pointD]
					: [...pointA, ...pointD, ...pointC, ...pointB];

			const color = this.colorEnable ? this.getColorTuple(gainRatio, false)[1] : GRAPH_COLORS[syncState];

			this.panels.graph.DrawPoly(4, points, color);
		}
	}

	static drawStrafeDirRects() {
		for (let i = 0; i < this.graphHistory.length; i++) {
			const { strafeDir } = this.graphHistory[i];

			if (!strafeDir) continue;

			const offset = strafeDir === 1 ? this.strafeDirPercentage : 1 - this.strafeDirPercentage;

			const pointA = this.getCanvasPoint(i, offset);
			const pointB = this.getCanvasPoint(i + 1, offset);
			const pointC = this.getCanvasPoint(i + 1, strafeDir === 1 ? 0 : 1);
			const pointD = this.getCanvasPoint(i, strafeDir === 1 ? 0 : 1);

			const points =
				strafeDir === 1
					? [...pointA, ...pointB, ...pointC, ...pointD]
					: [...pointA, ...pointD, ...pointC, ...pointB];

			this.panels.graph.DrawPoly(4, points, 'rgba(87, 200, 255, 0.9)');
		}
	}

	static getSyncState(bValidWishMove, speedGain) {
		if (!bValidWishMove) {
			return SYNC_STATES.NOMOVE;
		} else if (speedGain > 0) {
			return SYNC_STATES.SYNCED;
		} else if (speedGain < 0) {
			return SYNC_STATES.LOSS;
		} else {
			return SYNC_STATES.UNSYNCED;
		}
	}

	static getCanvasPoint(i, x) {
		const xScale = this.width;
		const yScale = this.height / this.graphHistory.length;

		return [x * xScale, i * yScale];
	}

	static onJump() {
		const lastJumpStats = MomentumMovementAPI.GetLastJumpStats();
		this.panels.stats[0].text =
			`${lastJumpStats.jumpCount}: `.padStart(6, ' ') +
			`${lastJumpStats.takeoffSpeed.toFixed(0)} `.padStart(6, ' ') +
			`(${(lastJumpStats.yawRatio * 100).toFixed(2)}%)`.padStart(10, ' ');
		this.panels.stats[1].text = (lastJumpStats.speedGain * 100).toFixed(2);

		const colorTuple = this.StatColorEnable
			? this.getColorTuple(lastJumpStats.speedGain, lastJumpStats.yawRatio > 0)
			: COLORS.NEUTRAL;
		for (const stat of this.panels.stats) stat.style.color = colorTuple[1];
	}

	static getColorTuple(ratio, bOverStrafing) {
		// cases where gain effectiveness is >90%
		if (ratio > 1.02) return COLORS.EXTRA;
		else if (ratio > 0.99) return COLORS.PERFECT;
		else if (ratio > 0.95) return COLORS.GOOD;
		else if (ratio <= -5) return COLORS.STOP;

		const lerpColorTuples = (c1, c2, alpha) => {
			return [
				this.lerpColorStrings(c1[0], c2[0], alpha.toFixed(3)),
				this.lerpColorStrings(c1[1], c2[1], alpha.toFixed(3))
			];
		};

		// cases where gain effectiveness is <90%
		if (!bOverStrafing) {
			if (ratio > 0.85) return lerpColorTuples(COLORS.SLOW, COLORS.GOOD, (ratio - 0.85) / 0.1);
			else if (ratio > 0.75) return COLORS.SLOW;
			else if (ratio > 0.5) return lerpColorTuples(COLORS.NEUTRAL, COLORS.SLOW, (ratio - 0.5) / 0.25);
			else if (ratio > 0) return COLORS.NEUTRAL;
			else if (ratio > -5) return lerpColorTuples(COLORS.NEUTRAL, COLORS.STOP, Math.abs(ratio) / 5);
		} else {
			if (ratio > 0.8) return lerpColorTuples(COLORS.SLOW, COLORS.GOOD, (ratio - 0.8) / 0.15);
			else if (ratio > 0) return lerpColorTuples(COLORS.LOSS, COLORS.SLOW, (ratio - 0.25) / 0.55);
			else if (ratio > -5) return lerpColorTuples(COLORS.LOSS, COLORS.STOP, Math.abs(ratio) / 5);
		}
	}

	static parseColorString(colorString) {
		const rgbaValues = colorString.split(' ').join(', ');
		return `rgba(${rgbaValues})`;
	}

	static wrapValueToRange(value, min, max, bShouldTrackWrap) {
		const range = max - min;
		while (value > max) {
			value -= range;
			if (bShouldTrackWrap) {
				this.bIsFirstPanelColored = !this.bIsFirstPanelColored; // less than clean way to track color flips
			}
		}
		while (value < min) {
			value += range;
			if (bShouldTrackWrap) {
				this.bIsFirstPanelColored = !this.bIsFirstPanelColored;
			}
		}
		return value;
	}

	static findFastAngle(speed, maxSpeed, maxAccel) {
		const threshold = maxSpeed - maxAccel;
		return Math.acos(speed < threshold ? 1 : threshold / speed);
	}

	static getSize(vec) {
		return Math.sqrt(this.getSizeSquared(vec));
	}

	static getSizeSquared(vec) {
		return vec.x * vec.x + vec.y * vec.y;
	}

	static getNormal(vec, threshold) {
		const mag = this.getSize(vec);
		const vecNormal = {
			x: vec.x,
			y: vec.y
		};
		if (mag < threshold * threshold) {
			vecNormal.x = 0;
			vecNormal.y = 0;
		} else {
			const inv = 1 / mag;
			vecNormal.x *= inv;
			vecNormal.y *= inv;
		}
		return vecNormal;
	}

	static getCross(vec1, vec2) {
		return vec1.x * vec2.y - vec1.y * vec2.x;
	}

	static initializeBuffer(size) {
		return Array.from({ length: size }).fill(0);
	}

	static addToBuffer(buffer, value) {
		buffer.push(value);
		buffer.shift();
	}

	static addToBufferFront(buffer, value) {
		buffer.unshift(value);
		buffer.pop();
	}

	static getBufferedSum(history) {
		return history.reduce((sum, element) => sum + element, 0);
	}

	static getColorStringFromArray(color) {
		return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3] / 255})`;
	}

	static splitColorString(string) {
		return string
			.slice(5, -1)
			.split(',')
			.map((c, i) => (i === 3 ? +c * 255 : +c));
	}

	static lerpColorStrings(stringA, stringB, alpha) {
		const colorA = this.splitColorString(stringA);
		const colorB = this.splitColorString(stringB);
		return this.getColorStringFromArray(this.lerpColorArrays(colorA, colorB, alpha));
	}

	static lerpColorArrays(A, B, alpha) {
		return A.map((Ai, i) => Ai + alpha * (B[i] - Ai));
	}

	static setDisplayMode(newMode) {
		this.displayMode = newMode ?? 0;
		switch (this.displayMode) {
			case 1: // "Half-width throttle"
				for (const segment of this.panels.segments) segment.style.backgroundColor = this.altColor;
				this.panels.needle.style.visibility = 'visible';
				this.setGraphMode(this.graphMode);
				break;
			case 2: // "Full-width throttle"
				for (const segment of this.panels.segments) segment.style.backgroundColor = this.altColor;
				this.panels.needle.style.visibility = 'collapse';
				this.panels.wrapper.style.transform = 'scaleX(1) rotateZ(0deg)';
				this.panels.graphContainer.style.visibility = 'collapse';
				this.panels.background.style.borderRadius = '8px';
				break;
			case 3: // "Strafe indicator"
				this.panels.segments[1].style.width = 100 - this.indicatorPercentage + '%';
				this.panels.segments[2].style.width = 50 + '%';
				this.panels.segments[3].style.width = 50 + '%';
				for (const segment of this.panels.segments) segment.style.backgroundColor = this.altColor;
				this.panels.needle.style.visibility = 'visible';
				this.setGraphMode(this.graphMode);
				break;
			case 4: // "Synchronizer"
				for (const segment of this.panels.segments) {
					segment.style.width = this.maxSegmentWidth + '%';
				}
				this.panels.needle.style.visibility = 'collapse';
				this.panels.wrapper.style.transform = 'scaleX(1) rotateZ(0deg)';
				this.panels.graphContainer.style.visibility = 'collapse';
				this.panels.background.style.borderRadius = '8px';
				break;
		}
	}

	static setColorMode(newColorMode) {
		this.colorEnable = newColorMode ?? DEFAULT_SETTING_OFF;
	}

	static setDynamicMode(newDynamicMode) {
		this.dynamicEnable = newDynamicMode ?? DEFAULT_SETTING_ON;
	}

	static setDirection(newDirection) {
		this.flipEnable = newDirection ?? DEFAULT_SETTING_OFF;
	}

	static setBufferLength(newBufferLength) {
		this.interpFrames = newBufferLength ?? DEFAULT_BUFFER_LENGTH;
		this.sampleWeight = 1 / this.interpFrames;

		this.gainRatioHistory = this.initializeBuffer(this.interpFrames);
		this.yawRatioHistory = this.initializeBuffer(this.interpFrames);
	}

	static setGraphBufferLength(newBufferLength) {
		const bufferLength = newBufferLength ?? DEFAULT_GRAPH_BUFFER_LENGTH;

		this.graphHistory = this.initializeBuffer(bufferLength);
	}

	static initializeGraph() {
		this.height = this.panels.graph.actuallayoutheight / this.panels.graph.actualuiscale_y;
		this.width = this.panels.graph.actuallayoutwidth / this.panels.graph.actualuiscale_x;
	}

	static setMinSpeed(newMinSpeed) {
		this.minSpeed = newMinSpeed ?? DEFAULT_MIN_SPEED;
	}

	static setStatMode(newStatMode) {
		this.statMode = newStatMode ?? 0;
		this.panels.wrapper.style.visibility = newStatMode === 2 ? 'collapse' : 'visible';
	}

	static setStatColorMode(newColorMode) {
		this.StatColorEnable = newColorMode ?? DEFAULT_SETTING_OFF;
	}

	static setGraphMode(newMode) {
		this.graphMode = newMode ?? DEFAULT_GRAPH_MODE;
		switch (this.graphMode) {
			case 0: // "Off"
				this.panels.graphContainer.style.visibility = 'collapse';
				this.panels.background.style.borderRadius = '8px';
				this.panels.wrapper.style.transform = 'scaleX(1) rotateZ(0deg)';
				break;
			case 1: // "On"
				this.panels.graphContainer.style.visibility = 'visible';
				this.panels.background.style.borderRadius = '8px 8px 0px 0px';
				this.panels.wrapper.style.transform = 'scaleX(1) rotateZ(0deg)';
				break;
			case 2: // "Rotated"
				this.panels.graphContainer.style.visibility = 'visible';
				this.panels.background.style.borderRadius = '8px 8px 0px 0px';
				this.panels.wrapper.style.transform = 'scaleX(-1) rotateZ(90deg)';
				break;
		}
	}

	static NaNCheck(val, def) {
		return Number.isNaN(Number(val)) ? def : val;
	}

	static initializeSettings() {
		this.setGraphMode();
		this.setDisplayMode(GameInterfaceAPI.GetSettingFloat('mom_hud_synchro_mode'));
		this.setColorMode(GameInterfaceAPI.GetSettingFloat('mom_hud_synchro_color_enable'));
		this.setDynamicMode(GameInterfaceAPI.GetSettingFloat('mom_hud_synchro_dynamic_enable'));
		this.setDirection(GameInterfaceAPI.GetSettingFloat('mom_hud_synchro_flip_enable'));
		this.setBufferLength(GameInterfaceAPI.GetSettingFloat('mom_hud_synchro_buffer_size'));
		this.setMinSpeed(GameInterfaceAPI.GetSettingFloat('mom_hud_synchro_min_speed'));
		this.setStatMode(GameInterfaceAPI.GetSettingFloat('mom_hud_synchro_stat_mode'));
		this.setStatColorMode(GameInterfaceAPI.GetSettingFloat('mom_hud_synchro_stat_color_enable'));
		this.setGraphBufferLength();
	}

	static {
		$.RegisterEventHandler('ChaosHudProcessInput', $.GetContextPanel(), this.onUpdate.bind(this));

		$.RegisterForUnhandledEvent('OnSynchroModeChanged', this.setDisplayMode.bind(this));
		$.RegisterForUnhandledEvent('OnSynchroColorModeChanged', this.setColorMode.bind(this));
		$.RegisterForUnhandledEvent('OnSynchroDynamicModeChanged', this.setDynamicMode.bind(this));
		$.RegisterForUnhandledEvent('OnSynchroDirectionChanged', this.setDirection.bind(this));
		$.RegisterForUnhandledEvent('OnSynchroBufferChanged', this.setBufferLength.bind(this));
		$.RegisterForUnhandledEvent('OnSynchroMinSpeedChanged', this.setMinSpeed.bind(this));
		$.RegisterForUnhandledEvent('OnSynchroStatModeChanged', this.setStatMode.bind(this));
		$.RegisterForUnhandledEvent('OnSynchroStatColorModeChanged', this.setStatColorMode.bind(this));
		$.RegisterForUnhandledEvent('OnJumpStarted', this.onJump.bind(this));
		$.RegisterForUnhandledEvent('ChaosLevelInitPostEntity', this.onLoad.bind(this));
	}
}
