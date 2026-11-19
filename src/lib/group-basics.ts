import { cache } from "react";
import { db } from "./db";

// The three facts every group screen checks before it does anything else: does the group exist, what type is it, was it deleted.
// One small read, remembered for the one request that asks (the group's layout and the page's pair check both want it),
// and forgotten when the request ends. It is not kept between requests, and it never holds money.
export const groupBasics = cache((id: string) => db.group.findUnique({ where: { id }, select: { id: true, type: true, deletedAt: true } }));
