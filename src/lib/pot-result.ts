import { db } from "./db";

// Is this expense the result of a card game (some game points at it)? Only those must change through
// the game; a card-game row that came from an import has no game and stays an ordinary row.
export async function isGameResult(expenseId: string, c: Pick<typeof db, "potGame"> = db): Promise<boolean> {
  return (await c.potGame.count({ where: { resultId: expenseId } })) > 0;
}
