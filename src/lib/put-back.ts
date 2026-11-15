// Undoing a change that takes someone with their own account out of a group would put them back without their say.
// So it is allowed only to the person who made that change, and only for a short while afterwards. After that the
// person is invited back from People. Names nobody has claimed (no account) keep no time limit.

export const PUT_BACK_MINUTES = 10;

// Is the change (made at `madeAt`) still recent enough to be undone?
export const putBackOpen = (madeAt: Date, now: Date = new Date()) => now.getTime() - madeAt.getTime() <= PUT_BACK_MINUTES * 60_000;

export const lateRemovalText = (name: string) => `Undo only lasts ${PUT_BACK_MINUTES} minutes. To bring ${name} back, invite them from People.`;

export const lateMoveText = (name: string) => `Undo only lasts ${PUT_BACK_MINUTES} minutes. ${name} can still undo it, or you can invite them back from People.`;
