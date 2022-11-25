(() => {
  Settings.add(new BooleanSetting('discord-rp.enabled', 'Discord RP enabled', true))
  Settings.add(new Setting('discord-rp-1', 'discord-rp-1', [], 'Shinies: {caught_shiny}/{caught} {sparkle}'));
  Settings.add(new Setting('discord-rp-2', 'discord-rp-2', [], 'Total Attack: {attack}'));
  Settings.add(new BooleanSetting(`discord-rp.timer`, 'Show current session play time (max 24 hours)', false));
  Settings.add(new BooleanSetting(`discord-rp.timer-reset`, 'Reset timer on area change', false));
  Settings.add(new Setting('discord-rp.large-image', 'Discord main image',
      [
          new SettingOption('None', ''),
          new SettingOption('PokéClicker Logo', 'pokeclickerlogo'),
          new SettingOption('Current Area Environment', 'current-environment'),
          new SettingOption('Cave Environment', 'background-cave'),
          new SettingOption('Cave Gem Environment', 'background-cave-gem'),
          new SettingOption('Fire Environment', 'background-fire'),
          new SettingOption('Forest Environment', 'background-forest'),
          new SettingOption('Grass Environment', 'background-grass'),
          new SettingOption('Graveyard Environment', 'background-graveyard'),
          new SettingOption('Ice Environment', 'background-ice'),
          new SettingOption('Mansion Environment', 'background-mansion'),
          new SettingOption('Power Plant Environment', 'background-power-plant'),
          new SettingOption('Water Environment', 'background-water'),
      ],
      'pokeclickerlogo'));
  Settings.add(new Setting('discord-rp.small-image', 'Discord small image',
      [
          new SettingOption('None', ''),
          new SettingOption('Money', 'money'),
          new SettingOption('Dungeon Tokens', 'dungeonToken'),
          new SettingOption('Quest Points', 'questPoint'),
          new SettingOption('Farm Points', 'farmPoint'),
          new SettingOption('Diamonds', 'diamond'),
          new SettingOption('Battle Points', 'battlePoint'),
          new SettingOption('Trainer', 'trainer'),
          new SettingOption('Egg', 'egg'),
          new SettingOption('Poké Ball', 'pokeball'),
          new SettingOption('Cycle All', 'cycle'),
      ],
      'cycle'));

  const settingsModal = document.getElementById('settingsModal');
  const tabs = settingsModal.getElementsByClassName('nav-tabs')[0];
  const tabContent = settingsModal.getElementsByClassName('tab-content')[0];

  // Add the Discord tab
  const discordTab = document.createElement('li');
  discordTab.className = 'nav-item';
  const discordTabInner = document.createElement('a');
  discordTabInner.innerText = 'Discord';
  discordTabInner.className = 'nav-link';
  discordTabInner.href = '#settings-discord';
  discordTabInner.dataset.toggle = 'tab';
  discordTab.appendChild(discordTabInner);
  tabs.appendChild(discordTab);

  // Add the Discord tab contents
  const discordTabEl = document.createElement('div');
  discordTabEl.className = 'tab-pane';
  discordTabEl.id = 'settings-discord';
  discordTabEl.innerHTML = `<table class="table table-striped table-hover m-0"><tbody>
    <tr>
      <td colspan="2">
        <span>Enable Discord rich presence</span>
        <label class="form-check-label toggler-wrapper style-1 float-right">
          <input class="clickable" type="checkbox" data-bind="checked: Settings.getSetting('discord-rp.enabled').observableValue()" onchange="Settings.setSettingByName(this.name, this.checked)" name="discord-rp.enabled">
          <div class="toggler-slider">
            <div class="toggler-knob"></div>
          </div>
        </label>
      </td>
    </tr>
    <tr>
      <td colspan="2">
        <span>Show current session play time (max 24 hours)</span>
        <label class="form-check-label toggler-wrapper style-1 float-right">
          <input class="clickable" type="checkbox" data-bind="checked: Settings.getSetting('discord-rp.timer').observableValue()" onchange="Settings.setSettingByName(this.name, this.checked)" name="discord-rp.timer">
          <div class="toggler-slider">
            <div class="toggler-knob"></div>
          </div>
        </label>
      </td>
    </tr>
    <tr>
      <td colspan="2">
        <span>Reset timer on area change</span>
        <label class="form-check-label toggler-wrapper style-1 float-right">
          <input class="clickable" type="checkbox" data-bind="checked: Settings.getSetting('discord-rp.timer-reset').observableValue()" onchange="Settings.setSettingByName(this.name, this.checked)" name="discord-rp.timer-reset">
          <div class="toggler-slider">
            <div class="toggler-knob"></div>
          </div>
        </label>
      </td>
    </tr>
    <tr data-bind="template: { name: 'MultipleChoiceSettingTemplate', data: Settings.getSetting('discord-rp.large-image')}"></tr>
    <tr data-bind="template: { name: 'MultipleChoiceSettingTemplate', data: Settings.getSetting('discord-rp.small-image')}"></tr>
    <tr>
      <td class="p-2">Line 1 text:</td>
      <td class="p-0">
          <input class="form-control" onblur="window.discordRPFocus = this" onchange="Settings.setSettingByName(this.name, this.value)" id="discord-rp-1" name="discord-rp-1" data-bind="value: Settings.getSetting('discord-rp-1').observableValue() || ''" value="Shinies: {caught_shiny}/{caught} {sparkle}">
      </td>
    </tr>
    <tr>
      <td class="p-2">Line 2 text:</td>
      <td class="p-0">
          <input class="form-control" onblur="window.discordRPFocus = this" onchange="Settings.setSettingByName(this.name, this.value)" id="discord-rp-2" name="discord-rp-2" data-bind="value: Settings.getSetting('discord-rp-2').observableValue() || ''" value="Total Attack: {attack}">
      </td>
    </tr>
  </tbody></table>
  <span>Options:<br/>
    <code>${'{caught} {caught_shiny} {hatched} {hatched_shiny} {sparkle} {attack} {regional_attack} {click} {click_attack} {clicks} {current_region} {current_subregion} {current_area} {current_area_stats} {underground_levels_cleared} {underground_items_found} {underground_deal_trades} {achievement_bonus} {money} {dungeon_tokens} {diamonds} {farm_points} {quest_points} {battle_points} {time_played} {quests_completed} {frontier_stages_cleared} {frontier_highest_cleared} {total_manual_harvests} {total_berries_obtained} {total_berries_harvested} {total_berries_replanted} {total_berries_mutated} {total_mulches_used} {total_shovels_used} {berry_daily_deal_trades} {total_mulches_used} {pokerus} {pokerus_resistant}'.replace(/}/g, '}</a>').replace(/{(\w+)/g, `<a href="#" onclick="window.discordRPFocus.value += ' {$1}'">{$1`)}</code>
  </span>`;

  tabContent.appendChild(discordTabEl);
})();

// Our Discord rp stuff
let startTimestamp = Date.now();
let currentArea = '';
let cycleSmallImageIndex = 0;

const getDiscordRP = () => {
  const _currentArea = player.route() ? Routes.getName(player.route(), player.region) : player.town() ? player.town().name : 'Unknown Area';
  const replaceDiscordText = (input) => {
    try {
      output = input.replace(/{caught}/g, App.game.party.caughtPokemon.length || 0)
                    .replace(/{caught_shiny}/g, App.game.party.caughtPokemon.filter(p => p.shiny).length || 0)
                    .replace(/{hatched}/g, App.game.statistics.totalPokemonHatched().toLocaleString('en-US') || 0)
                    .replace(/{hatched_shiny}/g, App.game.statistics.totalShinyPokemonHatched().toLocaleString('en-US') || 0)
                    .replace(/{sparkle}/g, '✨')
                    .replace(/{attack}/g, App.game.party.calculatePokemonAttack(PokemonType.None, PokemonType.None, true).toLocaleString('en-US') || 0)
                    .replace(/{regional_attack}/g, App.game.party.calculatePokemonAttack().toLocaleString('en-US') || 0)
                    .replace(/{(click|click_attack)}/g, App.game.party.calculateClickAttack().toLocaleString('en-US') || 0)
                    .replace(/{clicks}/g, App.game.statistics.clickAttacks().toLocaleString('en-US') || 0)
                    .replace(/{underground_levels_cleared}/g, App.game.statistics.undergroundLayersMined().toLocaleString('en-US'))
                    .replace(/{underground_items_found}/g, App.game.statistics.undergroundItemsFound().toLocaleString('en-US'))
                    .replace(/{underground_deal_trades}/g, App.game.statistics.undergroundDailyDealTrades().toLocaleString('en-US'))
                    .replace(/{current_region}/g,  GameConstants.camelCaseToString(GameConstants.Region[player.region] ??  'Unknown Region'))
                    .replace(/{current_subregion}/g,  SubRegions.getSubRegionById(player.region, player.subregion)?.name ??  'Unknown Subregion')
                    .replace(/{(current_route|current_area)}/g,  player.route() ? Routes.getName(player.route(), player.region) : player.town() ? player.town().name : 'Unknown Area')
                    .replace(/{(current_route_kills|current_area_stats)}/g, player.route() ? App.game.statistics.routeKills[player.region][player.route()]().toLocaleString('en-US') : player.town().dungeon ? App.game.statistics.dungeonsCleared[GameConstants.getDungeonIndex(player.town().name)]().toLocaleString('en-US') : player.town().gym ? App.game.statistics.gymsDefeated[GameConstants.getGymIndex(player.town().name)]().toLocaleString('en-US') : '?')
                    .replace(/{achievement_bonus}/g, AchievementHandler.achievementBonusPercent() || 0)
                    .replace(/{money}/g, App.game.wallet.currencies[GameConstants.Currency.money]().toLocaleString('en-US') || 0)
                    .replace(/{dungeon_tokens}/g, App.game.wallet.currencies[GameConstants.Currency.dungeonToken]().toLocaleString('en-US') || 0)
                    .replace(/{diamonds}/g, App.game.wallet.currencies[GameConstants.Currency.diamond]().toLocaleString('en-US') || 0)
                    .replace(/{farm_points}/g, App.game.wallet.currencies[GameConstants.Currency.farmPoint]().toLocaleString('en-US') || 0)
                    .replace(/{quest_points}/g, App.game.wallet.currencies[GameConstants.Currency.questPoint]().toLocaleString('en-US') || 0)
                    .replace(/{battle_points}/g, App.game.wallet.currencies[GameConstants.Currency.battlePoint]().toLocaleString('en-US') || 0)
                    .replace(/{time_played}/g, GameConstants.formatSecondsToTime(App.game.statistics['secondsPlayed']()) || '0 Seconds')
                    .replace(/{quests_completed}/g, App.game.statistics['questsCompleted']().toLocaleString('en-US') || '0')
                    .replace(/{frontier_stages_cleared}/g, App.game.statistics['battleFrontierTotalStagesCompleted']().toLocaleString('en-US') || '0')
                    .replace(/{frontier_highest_cleared}/g, App.game.statistics['battleFrontierHighestStageCompleted']().toLocaleString('en-US') || '0')
                    .replace(/{total_manual_harvests}/g, App.game.statistics['totalManualHarvests']().toLocaleString('en-US') || '0')
                    .replace(/{total_berries_obtained}/g, App.game.statistics['totalBerriesObtained']().toLocaleString('en-US') || '0')
                    .replace(/{total_berries_harvested}/g, App.game.statistics['totalBerriesHarvested']().toLocaleString('en-US') || '0')
                    .replace(/{total_berries_replanted}/g, App.game.statistics['totalBerriesReplanted']().toLocaleString('en-US') || '0')
                    .replace(/{total_berries_mutated}/g, App.game.statistics['totalBerriesMutated']().toLocaleString('en-US') || '0')
                    .replace(/{total_mulches_used}/g, App.game.statistics['totalMulchesUsed']().toLocaleString('en-US') || '0')
                    .replace(/{total_shovels_used}/g, App.game.statistics['totalShovelsUsed']().toLocaleString('en-US') || '0')
                    .replace(/{berry_daily_deal_trades}/g, App.game.statistics['berryDailyDealTrades']().toLocaleString('en-US') || '0')
                    .replace(/{total_mulches_used}/g, App.game.statistics['totalMulchesUsed']().toLocaleString('en-US') || '0')
                    .replace(/{pokerus}/g, App.game.party.caughtPokemon.filter(p => p.pokerus).length.toLocaleString('en-US') || '0')
                    .replace(/{pokerus_resistant}/g, App.game.party.caughtPokemon.filter(p => p.pokerus >= 3).length.toLocaleString('en-US') || '0')
                    // Replace html line breaks with a space
                    .replace(/<\/?br>/g, ' ');

      return output;
    } catch {
      return '';
    }
  }
  const discordRPCValues = {
    enabled: Settings.getSetting('discord-rp.enabled').observableValue(),
    line1: replaceDiscordText(document.getElementById('discord-rp-1').value || ''),
    line2: replaceDiscordText(document.getElementById('discord-rp-2').value || ''),
  }

  // Reset timer if area has changed
  if (Settings.getSetting('discord-rp.timer-reset').observableValue() && currentArea != _currentArea) {
    startTimestamp = Date.now();
  }
  currentArea = _currentArea;
  // Set our "start" timestamp
  if (Settings.getSetting('discord-rp.timer').observableValue()) discordRPCValues.startTimestamp = startTimestamp;

  // Our Discord images
  switch (Settings.getSetting('discord-rp.large-image').observableValue()) {
    case 'current-environment':
      discordRPCValues.largeImageKey = `background-${MapHelper.calculateBattleCssClass() ?? 'grass'}`;
      break;
    default:
      discordRPCValues.largeImageKey = Settings.getSetting('discord-rp.large-image').observableValue();
  }
  discordRPCValues.largeImageText = currentArea;

  const cycleOptions = [
    'money',
    'dungeonToken',
    'questPoint',
    'farmPoint',
    'diamond',
    'battlePoint',
    'trainer',
    'egg',
    'pokeball',
  ];

  let smallImage = Settings.getSetting('discord-rp.small-image').observableValue();
  if (smallImage === 'cycle') {
    smallImage = cycleOptions[++cycleSmallImageIndex % cycleOptions.length];
  }
  switch (smallImage) {
    case 'trainer':
      discordRPCValues.smallImageKey = `trainer-${App.game.profile.trainer()}`;
      discordRPCValues.smallImageText = `Total Attack: ${App.game.party.calculatePokemonAttack(PokemonType.None, PokemonType.None, true, undefined, true, false, WeatherType.Clear, true, true).toLocaleString('en-US') || 0}`;
      break;
    case 'egg':
      discordRPCValues.smallImageKey = smallImage;
      discordRPCValues.smallImageText = `Total Hatched: ${App.game.statistics.totalPokemonHatched().toLocaleString('en-US') || 0}`;
      break;
    case 'pokeball':
      discordRPCValues.smallImageKey = smallImage;
      discordRPCValues.smallImageText = `Shinies: ${App.game.party.caughtPokemon.filter(p => p.shiny).length || 0}/${App.game.party.caughtPokemon.length || 0} ✨`;
      break;
    default:
      discordRPCValues.smallImageKey = smallImage.toLowerCase();
      discordRPCValues.smallImageText = `${GameConstants.camelCaseToString(smallImage)}: ${App.game.wallet.currencies[GameConstants.Currency[smallImage]]?.().toLocaleString('en-US') ?? '0'}`;
  }

  return discordRPCValues;
}