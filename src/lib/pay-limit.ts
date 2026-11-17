import { allow } from "./rate-limit";

// Recording, deleting or bringing back payments: at most 60 changes an hour for one person. Far more than a real settle-up needs,
// and it stops anyone using payments to flood another person's phone. The payment itself is never lost: the limit only refuses
// the next change.
export const PAY_CHANGES_PER_HOUR = 60;
export const PAY_CHANGE_LIMIT_TEXT = "Too many changes in a short time. Try again in a few minutes.";
export const payChangeOk = (memberKey: string) => allow(`pay-change:${memberKey}`, PAY_CHANGES_PER_HOUR, 3600);
