(() => {

  Settings.add(new Setting('discord-rp-1', 'discord-rp-1', [], 'Shinies: {caught_shiny}/{caught} {sparkle}'));
  Settings.add(new Setting('discord-rp-2', 'discord-rp-2', [], 'Total Attack: {attack}'));

  const settingsModal = document.getElementById('settingsModal');
  const tabs = settingsModal.getElementsByClassName('nav-tabs')[0];
  const tabContent = settingsModal.getElementsByClassName('tab-content')[0];

  const discordTab = document.createElement('li');
  discordTab.className = 'nav-item';
  const discordTabInner = document.createElement('a');
  discordTabInner.innerText = 'Discord';
  discordTabInner.className = 'nav-link';
  discordTabInner.href = '#settings-discord';
  discordTabInner.dataset.toggle = 'tab';
  discordTab.appendChild(discordTabInner);
  tabs.appendChild(discordTab);

  const discordTabEl = document.createElement('div');
  discordTabEl.className = 'tab-pane';
  discordTabEl.id = 'settings-discord';
  discordTabEl.innerHTML = `<table class="table table-striped table-hover m-0"><tbody>
    <tr>
      <td>Line 1:</td>
      <td>
          <input class="form-control" onchange="Settings.setSettingByName(this.name, this.value)" id="discord-rp-1" name="discord-rp-1" data-bind="value: Settings.getSetting('discord-rp-1').observableValue() || ''" value="Shinies: {caught_shiny}/{caught} {sparkle}">
      </td>
    </tr>
    <tr>
      <td>Line 2:</td>
      <td>
          <input class="form-control" onchange="Settings.setSettingByName(this.name, this.value)" id="discord-rp-2" name="discord-rp-2" data-bind="value: Settings.getSetting('discord-rp-2').observableValue() || ''" value="Total Attack: {attack}">
      </td>
    </tr>
  </tbody></table>
  <span>Options:<br/>
    <code>{caught} | {caught_shiny} | {sparkle} | {attack} | {current_route} | {current_route_kills} | {achievement_bonus} | {money} | {dungeon_tokens} | {diamonds} | {farm_points} | {quest_points} | {battle_points} | {time_played} | {quests_completed}</code>
  </span>`;

  tabContent.appendChild(discordTabEl);
})();

const getDiscordRP = () => {
  const replaceDiscordText = (input) => {
    try {
      output = input.replace(/{caught}/g, App.game.party.caughtPokemon.length || 0)
                    .replace(/{caught_shiny}/g, App.game.party.caughtPokemon.filter(p => p.shiny).length || 0)
                    .replace(/{sparkle}/g, '✨')
                    .replace(/{attack}/g, App.game.party.caughtPokemon.reduce((sum, p) => sum + p.attack, 0).toLocaleString('en-US') || 0)
                    .replace(/{current_route}/g,  Routes.getName(player.route(), player.region) || 'Unknown Route')
                    .replace(/{current_route_kills}/g, App.game.statistics.routeKills[player.region][player.route()]().toLocaleString('en-US') || 0)
                    .replace(/{achievement_bonus}/g, AchievementHandler.achievementBonusPercent() || 0)
                    .replace(/{money}/g, App.game.wallet.currencies[GameConstants.Currency.money]().toLocaleString('en-US') || 0)
                    .replace(/{dungeon_tokens}/g, App.game.wallet.currencies[GameConstants.Currency.dungeonToken]().toLocaleString('en-US') || 0)
                    .replace(/{diamonds}/g, App.game.wallet.currencies[GameConstants.Currency.diamond]().toLocaleString('en-US') || 0)
                    .replace(/{farm_points}/g, App.game.wallet.currencies[GameConstants.Currency.farmPoint]().toLocaleString('en-US') || 0)
                    .replace(/{quest_points}/g, App.game.wallet.currencies[GameConstants.Currency.questPoint]().toLocaleString('en-US') || 0)
                    .replace(/{battle_points}/g, App.game.wallet.currencies[GameConstants.Currency.battlePoint]().toLocaleString('en-US') || 0)
                    .replace(/{time_played}/g, GameConstants.formatSecondsToTime(App.game.statistics['secondsPlayed']()) || '0 Seconds')
                    .replace(/{quests_completed}/g, App.game.statistics['questsCompleted']().toLocaleString('en-US') || '0');
      return output;
    } catch {
      return '';
    }
  }

  let line1 = replaceDiscordText(document.getElementById('discord-rp-1').value || '');
  let line2 = replaceDiscordText(document.getElementById('discord-rp-2').value || '');

  return [line1, line2];
}