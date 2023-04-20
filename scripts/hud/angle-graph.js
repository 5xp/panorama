'use strict';

const GRAPH_LINE_THICKNESS = 3;
const GRAPH_AXIS_COLOR = [178, 178, 178, 0.5];
const GRAPH_LINE_COLOR = [24, 150, 211, 1];
const GRAPH_DELTA_COLOR = [255, 255, 255, 1];
const GRAPH_PADDING = 0;

class AngleGraph {
	static panels = {
		graph: $('#AngleGraph')
	};

	static AIR_ACCEL = 1000;
	static RUN_SPEED = 260;
	static AIR_SPEED = 30;
	static FRICTION = 4;
	static STOP_SPEED = 75;

	static rad2deg = 180 / Math.PI;
	static deg2rad = 1 / this.rad2deg;

	static lastVel = { x: 0, y: 0 };

	static onUpdate() {
		const lastMoveData = MomentumMovementAPI.GetLastMoveData();
		const wishDir = lastMoveData.wishdir;
		const vel = MomentumPlayerAPI.GetVelocity();
		const velDir = this.getNormal(vel, 0.001);
		const lastVelDir = this.getNormal(this.lastVel, 0.001);
		const lastSpeed = this.getSize(this.lastVel);
		const speed = this.getSize(vel);
		const tickInterval = MomentumMovementAPI.GetTickInterval();

		const bValidWishMove = this.getSize(wishDir) > 0;
		const deltaAngle = bValidWishMove ? this.getAngle(wishDir, lastVelDir) : 0;

		this.lastVel = vel;

		this.AIR_ACCEL = GameInterfaceAPI.GetSettingFloat('sv_airaccelerate');
		this.RUN_SPEED = GameInterfaceAPI.GetSettingFloat('sv_maxspeed');
		this.FRICTION = GameInterfaceAPI.GetSettingFloat('sv_friction');
		this.STOP_SPEED = GameInterfaceAPI.GetSettingFloat('sv_stopspeed');

		const isGrounded = lastMoveData.acceleration !== this.AIR_ACCEL;

		this.setupDrawing();

		this.drawGraph(lastSpeed, deltaAngle, {
			acceleration: lastMoveData.acceleration,
			friction: isGrounded ? this.FRICTION : 0,
			tickInterval,
			maxSpeed: isGrounded ? this.RUN_SPEED : this.AIR_SPEED,
			stopSpeed: this.STOP_SPEED,
			isGrounded
		});

		const lastSpeedAfterFriction = this.getSpeedAfterFriction(
			lastSpeed,
			this.STOP_SPEED,
			isGrounded ? this.FRICTION : 0,
			tickInterval
		);

		const projectedSpeed = !bValidWishMove
			? lastSpeedAfterFriction
			: this.getResultantSpeed(lastSpeedAfterFriction, deltaAngle, {
					acceleration: lastMoveData.acceleration,
					friction: isGrounded ? this.FRICTION : 0,
					tickInterval,
					maxSpeed: isGrounded ? this.WALK_SPEED : this.AIR_SPEED,
					stopSpeed: this.STOP_SPEED,
					isGrounded
			  });

		const speedDelta = speed - projectedSpeed;

		if (speedDelta < -0.001) {
			$.Msg(
				`Speed loss: ${speedDelta.toFixed(2)}, Projected: ${projectedSpeed.toFixed(2)}, Actual: ${speed.toFixed(
					2
				)}`
			);
		}
	}

	static drawGraph(speed, delta, moveData) {
		const speedAfterFriction = this.getSpeedAfterFriction(
			speed,
			moveData.stopSpeed,
			moveData.friction,
			moveData.tickInterval
		);

		const numPoints = 200;
		const maxDelta = this.finiteCheck(this.getMaxDelta(speed, moveData), 0);
		const minDelta = this.finiteCheck(this.getMinDelta(speed, moveData), 0);

		let xMin, xMax;
		// if (moveData.isGrounded) {
		xMin = -maxDelta - 5 * this.deg2rad;
		xMax = maxDelta + 5 * this.deg2rad;
		// } else {
		// 	xMin = minDelta;
		// 	xMax = maxDelta;
		// 	delta = Math.abs(delta);
		// }

		if (xMin >= xMax) {
			xMin = -Math.PI / 2;
			xMax = Math.PI / 2;
		}

		const xStep = (xMax - xMin) / numPoints;

		const yMax = this.getOptimalResultantSpeed(speedAfterFriction, moveData) - speed;
		const yMin = speedAfterFriction - speed;

		const points = [];

		for (let x = xMin; x <= xMax; x += xStep) {
			const y = this.getResultantSpeed(speedAfterFriction, x, moveData) - speed;
			points.push({ x, y });
		}

		const screenPoints = this.mapToScreen(points, xMin, xMax, yMin, yMax);

		const deltaLine = [
			{ x: delta, y: yMin },
			{ x: delta, y: yMax }
		];

		const screenDeltaLine = this.mapToScreen(deltaLine, xMin, xMax, yMin, yMax);

		const axisLine = [
			{ x: xMin, y: 0 },
			{ x: xMax, y: 0 }
		];

		const screenAxisLine = this.mapToScreen(axisLine, xMin, xMax, yMin, yMax);

		const deltaPoint = [{ x: delta, y: this.getResultantSpeed(speedAfterFriction, delta, moveData) - speed }];

		const screenDeltaPoint = this.mapToScreen(deltaPoint, xMin, xMax, yMin, yMax);

		// for (let i = -2; i < 6; i++) {
		// 	// draw the vertical lines at each 45 degree angle
		// 	const angle = (i * Math.PI) / 4;
		// 	const line = [
		// 		{ x: angle, y: yMin },
		// 		{ x: angle, y: yMax }
		// 	];
		// 	const screenLine = this.mapToScreen(line, xMin, xMax, yMin, yMax);
		// 	this.drawLine(screenLine, GRAPH_AXIS_COLOR, 2);
		// }

		this.drawLine(screenAxisLine, GRAPH_AXIS_COLOR);
		this.drawLine(screenPoints, GRAPH_LINE_COLOR);
		this.drawLine(screenDeltaLine, GRAPH_DELTA_COLOR);

		// draw dot where delta and resultant speed intersect
		this.drawFilledCircle(screenDeltaPoint[0].x, screenDeltaPoint[0].y, 5, GRAPH_DELTA_COLOR);
	}

	static drawLine(points, rgb, thickness = GRAPH_LINE_THICKNESS) {
		const temp = [];
		for (const point of points) {
			temp.push(point.x, point.y);
		}

		this.panels.graph.DrawLinePoints(temp.length / 2, temp, thickness, `rgba(${rgb.join(',')})`);
	}

	static drawFilledCircle(x, y, radius, rgb) {
		this.panels.graph.DrawFilledCircle(x, y, radius, `rgba(${rgb.join(',')})`);
	}

	static mapToScreen(points, xMin, xMax, yMin, yMax) {
		const screenPoints = points.map((point) => {
			const xLerp = (point.x - xMin) / (xMax - xMin);
			const yLerp = (point.y - yMin) / (yMax - yMin);

			const x = xLerp * this.width;
			const y = (1 - yLerp) * this.height;

			return { x, y };
		});

		return screenPoints;
	}

	static setupDrawing() {
		this.panels.graph.Clear('#00000000');

		const height = this.panels.graph.actuallayoutheight / this.panels.graph.actualuiscale_y;
		const width = this.panels.graph.actuallayoutwidth / this.panels.graph.actualuiscale_x;

		this.top = GRAPH_PADDING;
		this.left = GRAPH_PADDING;
		this.right = width - GRAPH_PADDING;
		this.bottom = height - GRAPH_PADDING;

		this.width = this.right - this.left;
		this.height = this.bottom - this.top;
	}

	static getResultantSpeed(speed, delta, moveData) {
		const { acceleration, maxSpeed, tickInterval } = moveData;

		const maxAccel = acceleration * maxSpeed * tickInterval;

		let r = speed;

		if (speed * Math.cos(delta) <= maxSpeed - maxAccel) {
			r = Math.sqrt(Math.pow(speed, 2) + Math.pow(maxAccel, 2) + 2 * speed * maxAccel * Math.cos(delta));
		} else if (maxSpeed - maxAccel < speed * Math.cos(delta) && speed * Math.cos(delta) < maxSpeed) {
			r = Math.sqrt(Math.pow(speed, 2) * Math.pow(Math.sin(delta), 2) + Math.pow(maxSpeed, 2));
		}

		return r;
	}

	static getOptimalResultantSpeed(speed, moveData) {
		const { acceleration, maxSpeed, tickInterval } = moveData;

		const maxAccel = Math.min(maxSpeed, acceleration * maxSpeed * tickInterval);

		if (speed < maxSpeed - maxAccel) {
			return speed + maxAccel;
		}

		return Math.sqrt(Math.pow(speed, 2) - Math.pow(maxAccel, 2) + 2 * maxAccel * maxSpeed);
	}

	static getMinDelta(speed, moveData) {
		const { friction, maxSpeed, tickInterval } = moveData;

		const numerator = Math.pow(speed, 2) - Math.pow(maxSpeed, 2);
		const denominator =
			Math.pow(speed, 2) * (1 + Math.pow(friction, 2) * Math.pow(tickInterval, 2) - 2 * friction * tickInterval);

		return Math.asin(Math.sqrt(numerator / denominator));
	}

	static getMaxDelta(speed, moveData) {
		const { acceleration, friction, maxSpeed, tickInterval } = moveData;

		const maxAccel = acceleration * maxSpeed * tickInterval;

		const numerator =
			Math.pow(Math.min(maxAccel, maxSpeed), 2) +
			friction * tickInterval * Math.pow(speed, 2) * (friction * tickInterval - 2);
		const denominator = Math.min(2 * maxAccel, maxSpeed) * speed * (friction * tickInterval - 1);

		return Math.acos(numerator / denominator);
	}

	static getSpeedAfterFriction(speed, stopSpeed, friction, tickInterval) {
		if (speed >= stopSpeed) {
			return speed * (1 - friction * tickInterval);
		} else if (speed > 0.1) {
			return Math.max(0, speed - friction * stopSpeed * tickInterval);
		}

		return speed;
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

	static getDot(vec1, vec2) {
		return vec1.x * vec2.x + vec1.y * vec2.y;
	}

	static getAngle(vec1, vec2) {
		return Math.atan2(this.getCross(vec1, vec2), this.getDot(vec1, vec2));
	}

	static finiteCheck(val, def) {
		return !Number.isFinite(Number(val)) ? def : val;
	}

	static {
		$.RegisterEventHandler('ChaosHudProcessInput', $.GetContextPanel(), this.onUpdate.bind(this));
	}
}
