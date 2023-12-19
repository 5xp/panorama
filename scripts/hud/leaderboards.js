const SJ_URL = 'https://www.sourcejump.net';
const SJ_API_KEY = 'SJPublicAPIKey';

/**
 * Class for the HUD leaderboards panel, which contains the leaderboards and end of run.
 */
class HudLeaderboards {
	static panels = {
		/** @type {Panel} @static */
		leaderboardsContainer: $('#LeaderboardsContainer'),
		/** @type {Panel} @static */
		endOfRunContainer: $('#EndOfRunContainer'),
		/** @type {Image} @static */
		gamemodeImage: $('#HudLeaderboardsGamemodeImage'),
		/** @type {Panel} @static */
		credits: $('#HudLeaderboardsMapCredits'),
		/** @type {Panel} @static */
		sjwr: $('#HudLeaderboardsSJWR')
	};

	static {
		$.RegisterForUnhandledEvent('Leaderboards_MapDataSet', this.setMapData.bind(this));
		$.RegisterForUnhandledEvent('HudLeaderboards_ForceClose', this.close.bind(this));
		$.RegisterForUnhandledEvent('EndOfRun_Show', this.showEndOfRun.bind(this));
		$.RegisterForUnhandledEvent('EndOfRun_Hide', this.hideEndOfRun.bind(this));

		//$.RegisterForUnhandledEvent('HudLeaderboards_Opened', this.onOpened);
		//$.RegisterForUnhandledEvent('HudLeaderboards_Closed', this.onClosed);
	}

	static showEndOfRun(_showReason) {
		this.panels.leaderboardsContainer.AddClass('hud-leaderboards__leaderboards--hidden');
		this.panels.endOfRunContainer.RemoveClass('hud-leaderboards__endofrun--hidden');
	}

	static hideEndOfRun() {
		this.panels.leaderboardsContainer.RemoveClass('hud-leaderboards__leaderboards--hidden');
		this.panels.endOfRunContainer.AddClass('hud-leaderboards__endofrun--hidden');
	}

	static async setMapData(isOfficial) {
		$.GetContextPanel().SetHasClass('hud-leaderboards--unofficial', !isOfficial);

		const img = GameModeInfoWithNull[GameModeAPI.GetCurrentGameMode()].shortName.toLowerCase();

		this.panels.gamemodeImage.SetImage(`file://{images}/gamemodes/${img}.svg`);

		const mapData = MapCacheAPI.GetCurrentMapData();

		if (mapData && isOfficial) {
			this.setMapStats(mapData);
			this.setMapAuthorCredits(mapData.credits);
		}

		if (GameModeAPI.GetCurrentGameMode() === GameMode.BHOP) {
			const res = await this.retrieveSJWR(MapCacheAPI.GetMapName());

			let data;

			try {
				// For some reason the response has a null byte at the end
				data = JSON.parse(res.replaceAll('\0', ''));
			} catch (error) {
				$.Warning('Failed to parse SJWR data: ' + error);
				return;
			}

			if (!data || !data[0]) return;

			this.setMapSJWR(data[0]);
		}
	}

	/**
	 *
	 * @param {String} mapName
	 * @returns an array of record times in ascending time
	 */
	static retrieveSJWR(mapName) {
		const url = `${SJ_URL}/api/records/${mapName}?key=${SJ_API_KEY}`;
		return new Promise((resolve, reject) => {
			$.AsyncWebRequest(url, {
				type: 'GET',
				complete: (data) =>
					data.statusText === 'success' ? resolve(data.responseText) : reject(data.statusText)
			});
		});
	}

	static setMapSJWR(data) {
		this.panels.sjwr.RemoveClass('hud-leaderboards-map-info__sjwr--hidden');

		const namePanel = $.CreatePanel('Label', this.panels.sjwr, '', {
			text: data.name
		});

		namePanel.AddClass('hud-leaderboards-map-info__sjwr-name');

		namePanel.SetPanelEvent('oncontextmenu', () => {
			UiToolkitAPI.ShowSimpleContextMenu('', '', [
				{
					label: $.Localize('#Action_ViewOnWebsite'),
					jsCallback: () => {
						SteamOverlayAPI.OpenURL(this.getRecordLink(data.id));
					}
				}
			]);
		});

		const timePanel = $.CreatePanel('Label', this.panels.sjwr, '', {
			text: ` in ${data.time}`
		});

		timePanel.AddClass('hud-leaderboards-map-info__sjwr-time-text');
	}

	static setMapAuthorCredits(credits) {
		// Delete existing name labels
		for (const label of this.panels.credits.Children().slice(1) || []) label.DeleteAsync(0);

		const authorCredits = credits.filter((x) => x.type === 'author');

		for (const credit of authorCredits) {
			const namePanel = $.CreatePanel('Label', this.panels.credits, '', {
				text: credit.user.alias
			});

			namePanel.AddClass('hud-leaderboards-map-info__credits-name');

			if (credit.user.xuid !== '0') {
				namePanel.SetPanelEvent('oncontextmenu', () => {
					UiToolkitAPI.ShowSimpleContextMenu('', '', [
						{
							label: $.Localize('#Action_ShowSteamProfile'),
							jsCallback: () => {
								SteamOverlayAPI.OpenToProfileID(credit.user.xuid);
							}
						}
					]);
				});
			} else {
				namePanel.AddClass('hud-leaderboards-map-info__credits-name--no-steam');
			}

			// hoped this would make contextmenu work but it doesn't
			if (authorCredits.indexOf(credit) < authorCredits.length - 1) {
				const commaPanel = $.CreatePanel('Label', this.panels.credits, '');
				commaPanel.AddClass('hud-leaderboards-map-info__credits-other-text');
				commaPanel.text = ',';
			}
		}
	}

	static setMapStats(data) {
		const cp = $.GetContextPanel();

		cp.SetDialogVariableInt('tier', data.mainTrack?.difficulty);
		cp.SetDialogVariable(
			'type',
			$.Localize(data.mainTrack?.isLinear ? '#MapInfo_Type_Linear' : '#MapInfo_Type_Staged')
		);
		cp.SetDialogVariableInt('zones', data.mainTrack?.numZones);
		cp.SetDialogVariableInt('numruns', data.stats?.completes);
	}

	static close() {
		$.GetContextPanel().forceCloseLeaderboards();
		return true;
	}

	static getRecordLink(recordId) {
		return `${SJ_URL}/records/id/${recordId}`;
	}
}
