import { FreshKeyInput } from "./FreshKeyInput";
import { newRequestKey } from "@/lib/once";

// A hidden input with a real key from the first byte of the page: <FreshKey name="rid" />.
// The server makes the first key (so a form sent before the screen has finished loading still has one),
// and the browser swaps it for a fresh one when the screen opens and when the Back button brings a saved
// copy of it back (see FreshKeyInput.tsx). Use this from server components; forms that are client
// components use useRequestKey from FreshKeyInput.
export function FreshKey({ name = "rid" }: { name?: string }) {
  return <FreshKeyInput name={name} initial={newRequestKey()} />;
}
