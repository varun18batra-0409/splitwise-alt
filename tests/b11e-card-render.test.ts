import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PostcardFront } from "@/components/postcards/Card";

// The card as drawn on screen (server markup): the scrim behind light lettering, and the words on the margin under a taped print or a border.
describe("s3: lettering you can always read (the card markup)", () => {
  const base = { front: "photo:/photos/place-goa.jpg", words: "Lonavala", lettering: "classic", look: "", k: "t" };
  const html = (p: Record<string, unknown>) => renderToStaticMarkup(createElement(PostcardFront, { ...base, ...p }));
  it("the card on screen: scrim for gold on a full photo, none for navy", () => {
    expect(html({ tone: "gold" })).toContain("data-words-scrim");
    expect(html({ tone: "white" })).toContain("data-words-scrim");
    expect(html({ tone: "navy" })).not.toContain("data-words-scrim");
    expect(html({ tone: "gold", words: "" })).not.toContain("data-words-scrim");
  });
  it("the card on screen: a taped print or white border puts the words on the margin, in navy if the colour was light", () => {
    const t = html({ fit: "taped", tone: "gold" });
    expect(t).toContain('data-words-margin="bottom"');
    expect(t).not.toContain("data-words-scrim");
    expect(t).toContain("color:#1d2a52");
    expect(html({ fit: "taped", tone: "navy", wordsAt: "top" })).toContain('data-words-margin="top"');
    expect(html({ fit: "border", tone: "white" })).toContain('data-words-margin="bottom"');
    expect(html({ fit: "full" })).not.toContain("data-words-margin");
    // no words: a taped print is the centred 62-wide print it always was
    const none = html({ fit: "taped", words: "" });
    expect(none).toContain("w-[62cqw]");
    expect(none).not.toContain("data-words-margin");
  });
});
