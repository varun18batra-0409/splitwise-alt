// The postcard preview in the editor keeps one size on every tab (Photo, Look, Words, Lettering, Colour, Touches, Note tools, and
// while the keyboard is open). The tool panel gives way and scrolls; the card never shrinks or grows.
export const PREVIEW_W = 300; // css px, on normal phones
export const PREVIEW_W_SMALL = 176; // css px, on a 320 px phone (the widths below SMALL_MAX)
export const PREVIEW_SMALL_MAX = 359;

// The Tailwind classes that say the same thing (kept in step by a test).
export const PREVIEW_CLASS = "w-[300px] max-[359px]:w-[176px]";

// The width the preview has on a phone this wide (css px).
export function previewWidth(viewportWidth: number): number {
  return viewportWidth <= PREVIEW_SMALL_MAX ? PREVIEW_W_SMALL : PREVIEW_W;
}
