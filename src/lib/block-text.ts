// One list of what blocking changes, used by the Block question and the Unblock question, so they always say the same things.
// Blocking works both ways: none of these work between the two people. Shared group expenses and balances stay (the money has to add up).
export const BLOCK_LIST = "postcards, passports, nudges, moments, notifications and Want to go lists";

export const blockText = (name: string) => `Block ${name}? Until you unblock, none of these work between you: ${BLOCK_LIST}. You’ll still see shared group expenses and balances.`;

export const unblockText = (name: string) => `Unblock ${name}? These work between you again: ${BLOCK_LIST}.`;
