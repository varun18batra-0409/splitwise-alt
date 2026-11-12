// Not signed in: groups live only in this phone's browser. Said plainly, once, with the way out.
export function phoneOnlyText(plural: boolean): { before: string; link: string; after: string } {
  return plural
    ? { before: "These groups are saved on this phone. ", link: "Sign in", after: " to keep them if you clear your browser or change phones." }
    : { before: "This group is saved on this phone. ", link: "Sign in", after: " to keep it if you clear your browser or change phones." };
}

export function phoneOnlySentence(plural: boolean): string {
  const t = phoneOnlyText(plural);
  return `${t.before}${t.link}${t.after}`;
}
