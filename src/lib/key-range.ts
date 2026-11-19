// "Every key that starts with this text", written as a range of keys. The database can use the key's own index for a range
// (it jumps straight to the first match), but not for a "starts with" search, which it answers by reading the whole table.
//
// The top of the range is the biggest character there is, so any text after the prefix (letters, digits, accents, emoji) is inside it.
// Unlike "starts with" in SQLite (which ignores capital letters), a range is exact about case. Loopin builds these keys in code in
// one consistent case (ids are lower-case, the words are fixed), so nothing that matched before stops matching.
export function keyStarting(prefix: string): { gte: string; lt: string } {
  return { gte: prefix, lt: `${prefix}\u{10ffff}` };
}
