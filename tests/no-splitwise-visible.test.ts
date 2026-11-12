import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Nothing a person can see may name another app. File names, imports and identifiers (SplitwiseImport,
// importFromSplitwise…) and comments may keep the old name; page text, attributes, metadata, error
// messages and email words may not.
//
// This reads each source file the way a person would see it, with a small scanner (no guessing with one big regex):
//  - comments are skipped,
//  - a string that is the path of an import / export-from / import() is skipped,
//  - a hostname string (like "…vercel.app", an address, not words) is skipped,
//  - the lowercase key "splitwise" on its own is an internal format id and is skipped,
//  - a word that is part of an identifier (SplitwiseImport, parseSplitwiseCsv) is skipped,
//  - everything else (any other string, template text, and bare words in JSX text) must not contain "splitwise".

export function visibleMentions(src: string): string[] {
  const hits: string[] = [];
  const re = /splitwise/i;
  let i = 0;
  let prev = ""; // the last word seen in code (to tell `from "x"` and `import("x")`)
  let prevChar = "";
  const stack: ("code" | "tpl")[] = ["code"];
  const depth: number[] = [];
  const flag = (text: string) => {
    if (re.test(text)) hits.push(text.trim().slice(0, 80));
  };
  const skipString = (isPath: boolean, text: string) => {
    if (isPath) return;
    if (text === "splitwise") return; // internal format id
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/i.test(text)) return; // a hostname
    flag(text);
  };
  while (i < src.length) {
    const top = stack[stack.length - 1];
    const c = src[i];
    if (top === "tpl") {
      let text = "";
      while (i < src.length && src[i] !== "`" && !(src[i] === "$" && src[i + 1] === "{")) {
        if (src[i] === "\\") text += src[i++];
        text += src[i++] ?? "";
      }
      flag(text);
      if (src[i] === "`") {
        i++;
        stack.pop();
      } else if (src[i] === "$") {
        i += 2;
        stack.push("code");
        depth.push(0);
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let text = "";
      // A JS string ends at its quote or at the end of the line (a lone apostrophe in JSX text is not a string).
      while (j < src.length && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\") text += src[j++];
        text += src[j++] ?? "";
      }
      const isPath = prev === "from" || prev === "import" || (prevChar === "(" && prev === "import");
      if (src[j] === c) skipString(isPath, text);
      else flag(src.slice(i, j));
      i = src[j] === c ? j + 1 : j;
      prev = "";
      prevChar = "";
      continue;
    }
    if (c === "`") {
      stack.push("tpl");
      i++;
      continue;
    }
    if (c === "{" && depth.length) depth[depth.length - 1]++;
    if (c === "}" && depth.length) {
      if (depth[depth.length - 1] === 0) {
        depth.pop();
        stack.pop();
        i++;
        continue;
      }
      depth[depth.length - 1]--;
    }
    const w = /^[A-Za-z0-9_$]+/.exec(src.slice(i, i + 200));
    if (w) {
      const word = w[0];
      // Bare word "Splitwise" in code position = JSX text; glued to other letters = an identifier.
      if (word.toLowerCase() === "splitwise") flag(word);
      prev = word;
      prevChar = "";
      i += word.length;
      continue;
    }
    if (c === "(") prevChar = "(";
    else if (!/\s/.test(c)) prevChar = "";
    i++;
  }
  return hits;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("the scanner itself", () => {
  it("flags visible words: JSX text, strings, attributes, template text, metadata", () => {
    expect(visibleMentions("<p>Splitwise export</p>")).toEqual(["Splitwise"]);
    expect(visibleMentions('const t = { title: "Switching from Splitwise?" };')).toHaveLength(1);
    expect(visibleMentions("<a aria-label='Import from Splitwise'>x</a>")).toHaveLength(1);
    expect(visibleMentions("const x = `Brought over from Splitwise (${n})`;")).toHaveLength(1);
    expect(visibleMentions('const k = ["split", "Splitwise alternative"];')).toHaveLength(1);
    expect(visibleMentions("const x = `a ${ok ? 'Splitwise' : 'b'} c`;")).toHaveLength(1);
    expect(visibleMentions("<p>Don't use Splitwise here</p>")).toHaveLength(1);
  });
  it("lets imports, identifiers, comments, hostnames and the internal format id through", () => {
    expect(visibleMentions('import { SplitwiseImport } from "@/components/SplitwiseImport";')).toEqual([]);
    expect(visibleMentions('import { importSplitwise } from "@/lib/splitwise-import";')).toEqual([]);
    expect(visibleMentions('const m = await import("@/lib/splitwise-csv");')).toEqual([]);
    expect(visibleMentions("export async function importFromSplitwise(f: FormData) { return parseSplitwiseCsv(f); }")).toEqual([]);
    expect(visibleMentions("// Splitwise's export\nconst a = 1; /* Splitwise */ const b = 2;")).toEqual([]);
    expect(visibleMentions('const H = ["getloopin.vercel.app", "splitwise-alt-bovz.vercel.app"];')).toEqual([]);
    expect(visibleMentions('const f: "splitwise" | "loopin" = d.format === "splitwise" ? 1 : 2;')).toEqual([]);
    expect(visibleMentions("<SplitwiseImport yourName={name} />")).toEqual([]);
  });
});

describe("nothing a user can see says Splitwise", () => {
  const root = path.resolve(__dirname, "..", "src");
  for (const dir of ["app", "components", "lib"]) {
    it(`src/${dir}: page text, attributes, metadata, messages and emails`, () => {
      const bad = files(path.join(root, dir)).flatMap((f) => visibleMentions(readFileSync(f, "utf8")).map((h) => `${path.relative(root, f)}: ${h}`));
      expect(bad).toEqual([]);
    });
  }
  it("the import label is generic", () => {
    const src = readFileSync(path.join(root, "lib", "import-formats.ts"), "utf8");
    expect(src).toContain('label: "Spreadsheet from another app"');
  });
});
