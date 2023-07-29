'use strict';

const DEFAULT_BUFFER_LENGTH = 50;
const DEFAULT_VISIBLE_TICKS = 3;
const DEFAULT_COLOR_MODE = 1;
const MAX_TICK_DIFFERENCE = 15;
const INITIAL_OPACITY = 0.25;
const FADE_AMOUNT = 0.01;

const COLORS = {
	PERFECT: ['rgba(24, 150, 211, 1)', 'rgba(87, 200, 255, 1)'],
	GOOD: ['rgba(21, 152, 86, 1)', 'rgba(122, 238, 122, 1)'],
	SLOW: ['rgba(248, 222, 74, 1)', 'rgba(255, 238, 0, 1)'],
	STOP: ['rgba(211, 24, 24, 1)', 'rgba(255, 87, 87, 1)'],
	NEUTRAL: ['rgba(178, 178, 178, 1)', 'rgba(255, 255, 255, 1)']
};

class StrafeError {
	static panels = {
		container: $('#Container'),
		stats: $('#Stats'),
		arrow: $('#AverageArrow'),
		segments: []
	};

	static currentStrafeDir = 0;
	static currentTurnDir = 0;
	static lastStrafeDir = 0;
	static lastTurnDir = 0;
	static ticksSinceLastTurn = 0;
	static ticksSinceLastStrafe = 0;
	static lastAngle = 0;
	static averageStartDifference = 0;
	static averageMarkerPosition = 0;

	static onLoad() {
		this.initializeSettings();
	}

	static onUpdate() {
		const lastMoveData = MomentumMovementAPI.GetLastMoveData();
		const lastTickStats = MomentumMovementAPI.GetLastTickStats();
		const viewAngle = MomentumPlayerAPI.GetAngles().y;

		const shouldRecord = lastMoveData.acceleration > 10; // only record when in the air

		const bValidWishMove = this.getSize(lastMoveData.wishdir) > 0.1;
		this.currentStrafeDir = (bValidWishMove ? 1 : 0) * lastTickStats.strafeRight;

		const angleDelta = this.wrapValueToRange(this.lastAngle - viewAngle, -180, 180);
		this.lastAngle = viewAngle;
		this.currentTurnDir = angleDelta > 0 ? 1 : angleDelta < 0 ? -1 : 0;

		const startedStrafe = this.checkForStrafeStart();
		const startedTurn = this.checkForTurnStart();

		if (shouldRecord && (startedStrafe || startedTurn)) {
			this.recordStartDifference();
		}

		this.ticksSinceLastStrafe++;
		this.ticksSinceLastTurn++;

		this.lastStrafeDir = this.currentStrafeDir;
		this.lastTurnDir = this.currentTurnDir;

		this.fadeSegments();
		this.updateAverageIndicator();
	}

	static recordStartDifference() {
		const tickDifference = this.ticksSinceLastTurn - this.ticksSinceLastStrafe;

		if (Math.abs(tickDifference) > MAX_TICK_DIFFERENCE || this.currentStrafeDir !== this.currentTurnDir) {
			return;
		}

		this.addToBuffer(this.startDifferenceHistory, tickDifference, this.bufferLength);
		this.averageStartDifference = this.getBufferedAverage(this.startDifferenceHistory);
		this.updateStats();

		if (Math.abs(tickDifference) > this.visibleTicks) return;

		this.highlightSegment(tickDifference);
	}

	static checkForStrafeStart() {
		if (this.currentStrafeDir !== this.lastStrafeDir && this.currentStrafeDir !== 0) {
			this.ticksSinceLastStrafe = 0;
		}

		return this.ticksSinceLastStrafe === 0;
	}

	static checkForTurnStart() {
		if (this.currentTurnDir !== this.lastTurnDir && this.currentTurnDir !== 0) {
			this.ticksSinceLastTurn = 0;
		}

		return this.ticksSinceLastTurn === 0;
	}

	static highlightSegment(tickDifference) {
		const segment = this.panels.segments[tickDifference + this.visibleTicks];
		segment.style.opacity = 1;
	}

	static getColorGradient(colorTuple) {
		return `gradient(linear, 0% 0%, 0% 100%, from(${colorTuple[0]}), to(${colorTuple[1]}))`;
	}

	static getColorTuple(tickDifference) {
		const difference = Math.abs(tickDifference);
		const keys = Object.keys(COLORS);
		const colorKey = keys[Math.min(difference, keys.length - 2)];
		return COLORS[colorKey];
	}

	static fadeSegments() {
		for (const segment of this.panels.segments) {
			const opacity = segment.style.opacity;

			if (opacity <= 0) {
				continue;
			}

			segment.style.opacity = opacity - FADE_AMOUNT;
		}
	}

	static updateAverageIndicator() {
		const containerWidth = this.panels.container.actuallayoutwidth;
		const nextPosition = this.lerp(
			this.averageMarkerPosition,
			this.averageStartDifference,
			MomentumMovementAPI.GetTickInterval() * 10
		);

		const offsetPixels = (nextPosition + this.visibleTicks) * (1 / (2 * this.visibleTicks + 1)) * containerWidth;

		this.averageMarkerPosition = nextPosition;

		this.panels.arrow.style.marginLeft = `${offsetPixels.toFixed(3)}px`;
	}

	static updateStats() {
		const stdDev = this.NaNCheck(this.getStandardDeviation(this.startDifferenceHistory), 0);
		this.panels.stats.text =
			`Avg: ${this.averageStartDifference.toFixed(2)}` +
			`Dev: ${stdDev.toFixed(2)}`.padStart(14, ' ') +
			`N: ${this.startDifferenceHistory.length}`.padStart(14, ' ');
	}

	static NaNCheck(val, def) {
		return Number.isNaN(Number(val)) ? def : val;
	}

	static setBufferLength(newBufferLength) {
		this.bufferLength = newBufferLength ?? DEFAULT_BUFFER_LENGTH;

		this.startDifferenceHistory = this.initializeBuffer(0);
	}

	static initializeBuffer(size, value = 0) {
		return Array.from({ length: size }).fill(value);
	}

	static addToBuffer(buffer, value, maxSize) {
		buffer.push(value);

		if (buffer.length > maxSize) {
			buffer.shift();
		}
	}

	static getBufferedSum(history) {
		return history.reduce((sum, element) => sum + element, 0);
	}

	static getBufferedAverage(history) {
		return this.getBufferedSum(history) / history.length;
	}

	static getStandardDeviation(history) {
		const average = this.getBufferedAverage(history);
		const variance = this.getBufferedSum(history.map((value) => (value - average) ** 2)) / history.length;
		return Math.sqrt(variance);
	}

	static setBarSize(newSize) {
		this.visibleTicks = newSize ?? DEFAULT_VISIBLE_TICKS;

		for (const segment of this.panels.segments) segment.DeleteAsync(0);

		this.panels.container.style.flowChildren = 'right';
		const numSegments = 2 * this.visibleTicks + 1;
		const segmentWidth = 1 / numSegments;

		for (let i = 0; i < 2 * this.visibleTicks + 1; i++) {
			const tickDifference = i - this.visibleTicks;
			const colorTuple = this.colorMode ? this.getColorTuple(tickDifference) : COLORS.NEUTRAL;
			const color = this.getColorGradient(colorTuple);

			const segment = $.CreatePanel('Panel', this.panels.container, `Segment${i}`, {
				class: 'strafe-error__segment',
				style: `width: ${segmentWidth * 100}%; background-color: ${color}; opacity: 0;`
			});

			this.panels.segments.push(segment);
		}
	}

	static wrapValueToRange(value, min, max) {
		const range = max - min;
		while (value > max) {
			value -= range;
		}
		while (value < min) {
			value += range;
		}
		return value;
	}

	static getSize(vec) {
		return Math.sqrt(this.getSizeSquared(vec));
	}

	static getSizeSquared(vec) {
		return vec.x * vec.x + vec.y * vec.y;
	}

	static lerp(a, b, alpha) {
		return a + alpha * (b - a);
	}

	static setColorMode(newColorMode) {
		this.colorMode = newColorMode ?? DEFAULT_COLOR_MODE;
	}

	static initializeSettings() {
		this.setBufferLength();
		this.setColorMode();
		this.setBarSize();
		this.updateStats();
	}

	static {
		$.RegisterEventHandler('ChaosHudProcessInput', $.GetContextPanel(), this.onUpdate.bind(this));
		$.RegisterForUnhandledEvent('ChaosLevelInitPostEntity', this.onLoad.bind(this));
	}
}
