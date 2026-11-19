import { guestGroupsOnPhone } from "@/lib/identity";
import { googleConfigured } from "@/lib/google";
import { SignInNoteSheet } from "@/components/SignInSheet";
import type { Notes } from "@/lib/flash";

// The page's side of "Sign in to do this": when a refusal left a (signed, checked) note, open the sheet. `back` is the page to come back to.
export async function SigninPrompt({ notes, back }: { notes: Notes; back: string }) {
  if (!notes.signin) return null;
  const groups = await guestGroupsOnPhone();
  return <SignInNoteSheet signin={notes.signin} ctx={{ groups, google: googleConfigured(), back }} />;
}
