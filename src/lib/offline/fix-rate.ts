// "Open and fix" an expense kept on a phone, saved online at today's rate like any online save. The founder's rule is never to use another
// day's rate quietly, so when the expense is in another currency and its day is BEFORE today, the live rate is not used: the person enters
// the rate for that day. (The normal online form never asks: `isFix` is false there.)
export function fixNeedsOwnRate(o: { isFix: boolean; foreign: boolean; day: string; today: string }): boolean {
  return o.isFix && o.foreign && o.day < o.today;
}
