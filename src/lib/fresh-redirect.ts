import { revalidatePath } from "next/cache";
import { redirect as nextRedirect, type RedirectType } from "next/navigation";

// For server actions (saving something): go to the next screen AND forget the
// screens the phone fetched ahead of time, so nothing shown afterwards is
// from before the change. (Screens are fetched ahead so taps feel instant.)
export function redirect(url: string, type?: RedirectType): never {
  revalidatePath("/", "layout");
  nextRedirect(url, type);
}
