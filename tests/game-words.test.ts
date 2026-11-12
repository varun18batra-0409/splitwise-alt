import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { neutralGameText, TOOK_HOME_NOTES, GAME_CHOICES, GAME_NOTE, GAME_NIGHT, gameEmoji, gameLabel, hasBannedGameWord, isGameKind } from "@/lib/game-words";
import { GROUP_TYPES } from "@/lib/group-types";
import { POT_GAMES, isPotGame, potGameLabel, potResultLine } from "@/lib/pot";
import { sheetFor } from "@/lib/group-type-sheet";

// Game night: the words a person sees. Nothing that reads as gambling (app-store wording).

describe("the banned-words check itself", () => {
  it("catches every old word, in any case, and lets the one allowed line through", () => {
    for (const bad of ["Poker night", "Teen Patti", "teenpatti", "Buy-in", "buy in", "Buy-ins", "Cash out", "cash-out", "Cashed out", "Winnings", "place a bet", "Bets", "gambling"]) {
      expect(hasBannedGameWord(bad), bad).toBe(true);
    }
    for (const fine of ["Chips in", "Took home", "came out ahead", "buying groceries", "between friends", "better", "Cards", "Board game", "Any game", "Game night"]) {
      expect(hasBannedGameWord(fine), fine).toBe(false);
    }
    expect(hasBannedGameWord(GAME_NOTE)).toBe(false);
    expect(hasBannedGameWord(`${GAME_NOTE} Poker`)).toBe(true);
    expect(GAME_NOTE).toBe("Loopin keeps the score of games you play together. No betting happens in the app.");
  });
});

describe("game kinds: old stored values still work, with neutral labels", () => {
  it("poker and teenpatti are read as Cards; new values have their own labels", () => {
    expect(gameLabel("poker")).toBe("Cards");
    expect(gameLabel("teenpatti")).toBe("Cards");
    expect(gameLabel("cards")).toBe("Cards");
    expect(gameLabel("board")).toBe("Board game");
    expect(gameLabel("any")).toBe("Any game");
    expect(gameLabel("something-else")).toBe("Cards"); // nothing odd ever shows
    expect(potGameLabel("poker")).toBe("Cards");
    expect(gameEmoji("poker")).toBe("🃏");
    expect(gameEmoji("board")).toBe("🎲");
  });
  it("old and new values are accepted; the picker offers only the three neutral ones", () => {
    for (const ok of ["poker", "teenpatti", "cards", "board", "any"]) expect(isPotGame(ok) && isGameKind(ok), ok).toBe(true);
    expect(isPotGame("roulette")).toBe(false);
    expect(POT_GAMES.map((g) => g.label)).toEqual(["Cards", "Board game", "Any game"]);
    expect(GAME_CHOICES.map((g) => g.id)).toEqual(["cards", "board", "any"]);
  });
});

describe("the group-type chips and the game screens carry none of the old words", () => {
  it("the chip is called Game night, and no chip, hint or placeholder has a banned word", () => {
    expect(GROUP_TYPES.find((t) => t.id === "pot")?.label).toBe(GAME_NIGHT);
    expect(GAME_NIGHT).toBe("Game night");
    for (const t of GROUP_TYPES) expect(hasBannedGameWord(`${t.label} ${t.hint} ${t.namePlaceholder}`), t.id).toBe(false);
    expect(GROUP_TYPES.map((t) => t.id)).toContain("pot"); // the internal kind is unchanged
  });
  it("the one-time explainer has the calm line, and nothing else risky", () => {
    const sheet = sheetFor("pot", "g1")!;
    expect(sheet.title).toBe("Your Game night is ready");
    expect(sheet.note).toBe(GAME_NOTE);
    expect(hasBannedGameWord(JSON.stringify(sheet))).toBe(false);
    expect(sheet.primary.href).toBe("/groups/g1/pot/new"); // routes unchanged
  });
  it("the question before a result goes into Money owed uses neutral words", () => {
    const line = potResultLine([{ name: "Asha", net: 60000 }, { name: "Dev", net: -60000 }], "INR");
    expect(line).toBe("Put this game into Money owed? Asha +₹600, Dev −₹600. You can reopen it.");
    expect(hasBannedGameWord(line)).toBe(false);
  });
  it("the words in the screens' own source (comments and code names left out) have none of the banned words", () => {
    const files = [
      "src/app/groups/[id]/pot/[gameId]/page.tsx",
      "src/app/groups/[id]/pot/new/page.tsx",
      "src/app/groups/[id]/_components/GamesTab.tsx",
      "src/components/PotBuyIn.tsx",
      "src/components/PotCount.tsx",
      "src/components/PotName.tsx",
      "src/components/NewGroupForm.tsx",
      "src/components/GroupTypeSheet.tsx",
      "src/components/ActivityRow.tsx",
      "src/components/IntroTour.tsx",
      "src/lib/group-types.ts",
      "src/lib/group-type-sheet.ts",
      "src/lib/pot.ts",
      "src/lib/pot-db.ts",
      "src/lib/home/stories.ts",
      "src/lib/home/banner.ts",
      "src/app/faq/page.tsx",
      "src/app/how-it-works/page.tsx",
      "src/app/groups/[id]/invite/page.tsx",
    ];
    for (const f of files) {
      const text = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/.*$/gm, "$1") // line comments (not https://)
        .replace(/\b\w*(cashOut|CashOut|buyIn|BuyIn|buyin)\w*\b/g, " "); // code names, never shown
      expect(hasBannedGameWord(text), f).toBe(false);
    }
  });
});

describe("old stored games are shown with the neutral words (stored data is not changed)", () => {
  it("rewrites only the old stored patterns, by hand-written examples", () => {
    expect(neutralGameText("Teen Patti · 26 Oct")).toBe("Game night · 26 Oct");
    expect(neutralGameText("poker · 3 Nov")).toBe("Game night · 3 Nov");
    expect(neutralGameText("started a game: Friday (Teen Patti, 4 players)")).toBe("started a game: Friday (Cards, 4 players)");
    expect(neutralGameText("started a game: Round 2 (Poker, 3 players)")).toBe("started a game: Round 2 (Cards, 3 players)");
    expect(neutralGameText("finished Teen Patti · 26 Oct: Asha won ₹600")).toBe("finished Game night · 26 Oct: Asha came out ahead ₹600");
    expect(neutralGameText("Asha won 3 rounds")).toBe("Asha won 3 rounds"); // not money: left alone
    expect(neutralGameText("Asha won $30, Ravi won 1,200 THB")).toBe("Asha came out ahead $30, Ravi came out ahead 1,200 THB");
    expect(neutralGameText("Missing from the pot")).toBe("Missing from the count");
    expect(neutralGameText("Extra in the pot")).toBe("Extra in the count");
  });
  it("leaves everything else alone, including new neutral text", () => {
    for (const same of ["Cards · 26 Oct", "Friday night", "finished Cards · 26 Oct: Asha came out ahead by ₹600", "He won the argument", "Poker night"]) expect(neutralGameText(same)).toBe(same);
  });
  it("an old move noted \"cashed out\" is a \"took home\" line, and new ones are saved as \"took home\"", () => {
    expect(TOOK_HOME_NOTES).toContain("cashed out");
    expect(TOOK_HOME_NOTES).toContain("took home");
    expect(neutralGameText("cashed out")).toBe("took home");
    expect(TOOK_HOME_NOTES[0]).toBe("took home"); // what pot-db saves now
  });
  it("new games and events are saved neutral: the default name and the started/finished lines never use the old words", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/pot-db.ts", "utf8").replace(/\/\/.*$/gm, "");
    expect(src).toMatch(/note: "took home"/);
    expect(hasBannedGameWord(src.replace(/\b\w*(cashOut|buyIn|buyin)\w*\b/g, ""))).toBe(false);
    expect(src).not.toMatch(/ won \$\{/);
  });
});
