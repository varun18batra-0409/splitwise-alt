// Home's game story: if anyone in the game has a block either way with the viewer, that game has no story at all.
// (Leaving one name out would change who "came out ahead", and could even read as "Everyone broke even".)
export function gameHasBlockedPlayer(memberIds: string[], isBlocked: (memberId: string) => boolean): boolean {
  return memberIds.some(isBlocked);
}
