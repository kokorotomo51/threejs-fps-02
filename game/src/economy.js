// The money: one wallet for the match and the round score. A kill pays $300, a
// plant pays $300, a won round pays $3,250 and a lost round pays $1,900, so a
// pistol round can still buy a rifle by round three. First to 5 rounds takes
// the match; the buy menu spends from this wallet and nothing else.
export function createEconomy() {
  const state = { money: 800, vanguard: 0, sentinel: 0, round: 1 };

  return {
    state,
    resetMatch() {
      state.money = 800;
      state.vanguard = 0;
      state.sentinel = 0;
      state.round = 1;
    },
    rewardKill() {
      state.money += 300;
    },
    rewardPlant() {
      state.money += 300;
    },
    rewardRound(won) {
      state.money += won ? 3250 : 1900;
      if (won) state.vanguard += 1;
      else state.sentinel += 1;
    },
    canAfford(price) {
      return state.money >= price;
    },
    spend(price) {
      // The wallet never goes below zero, even if a caller forgets canAfford.
      state.money = Math.max(0, state.money - price);
    },
    nextRound() {
      state.round += 1;
    },
    matchOver() {
      return state.vanguard >= 5 || state.sentinel >= 5;
    },
    winner() {
      return state.vanguard >= 5 ? 'Vanguard' : 'Sentinel';
    },
  };
}
