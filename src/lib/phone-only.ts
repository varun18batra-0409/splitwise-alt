// Not signed in: groups live only in this device's browser. Said plainly, once, with the way out.
export function phoneOnlyText(plural: boolean): { before: string; link: string; after: string } {
  return plural
    ? { before: "These groups are saved on this device. ", link: "Sign in", after: " to keep them if you clear your browser or change devices." }
    : { before: "This group is saved on this device. ", link: "Sign in", after: " to keep it if you clear your browser or change devices." };
}

export function phoneOnlySentence(plural: boolean): string {
  const t = phoneOnlyText(plural);
  return `${t.before}${t.link}${t.after}`;
}
