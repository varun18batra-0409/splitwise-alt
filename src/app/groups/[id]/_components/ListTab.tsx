import { listAdd, listBuy, listGoingShopping, listRemove, listToggle } from "@/app/bill-actions";
import { newRequestKey } from "@/lib/once";
import { Notice } from "@/components/Notice";
import type { GroupView } from "./view";

type Item = { id: string; text: string; addedById: string; boughtById: string; boughtAt: Date | null };

// The shared shopping list: add, tick when bought, then say what it cost —
// that becomes one Groceries expense, shared the group's way.
export function ListTab({ v, items, usual, notice }: { v: GroupView; items: Item[]; usual: string[]; notice?: string }) {
  const { group, myId, nameOf } = v;
  const toBuy = items.filter((i) => !i.boughtAt);
  const mine = items.filter((i) => i.boughtAt && i.boughtById === myId);
  const others = items.filter((i) => i.boughtAt && i.boughtById !== myId);
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;

  const box = (on: boolean) => (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] ${on ? "bg-fg text-canvas" : "border-[1.5px] border-gray-400"}`}
      aria-hidden
    >
      {on && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l5 5 9-10" />
        </svg>
      )}
    </span>
  );

  const row = (i: Item, on: boolean) => (
    <li key={i.id} className="flex items-center gap-1 border-b border-line">
      <form action={listToggle} className="min-w-0 flex-1">
        {hidden("groupId", group.id)}
        {hidden("itemId", i.id)}
        <button type="submit" aria-pressed={on} className="flex w-full items-center gap-3 py-3 text-left">
          {box(on)}
          <span className={`min-w-0 flex-1 truncate text-[15px] ${on ? "text-gray-500 line-through" : ""}`}>{i.text}</span>
          {!on && <span className="shrink-0 text-xs text-gray-400">{nameOf(i.addedById)} added</span>}
        </button>
      </form>
      {!on && (
        <form action={listRemove}>
          {hidden("groupId", group.id)}
          {hidden("itemId", i.id)}
          <button type="submit" aria-label={`Remove ${i.text}`} className="px-2 py-3 text-lg leading-none text-gray-400">
            ×
          </button>
        </form>
      )}
    </li>
  );

  return (
    <div>
      {notice && <Notice tone="success" params={["bought", "told", "error"]} className="mb-4">{notice}</Notice>}

      <form action={listAdd} className="flex gap-2">
        {hidden("groupId", group.id)}
        <label className="flex-1">
          <span className="sr-only">Add an item</span>
          <input
            name="text"
            required
            maxLength={60}
            autoComplete="off"
            enterKeyHint="done"
            placeholder="Add an item… e.g. bread"
            className="w-full rounded-xl border border-line bg-mist px-4 py-3 text-[15px] text-fg outline-none placeholder:text-gray-400 focus:border-accent"
          />
        </label>
        <button type="submit" className="pop shrink-0 bg-fg px-4 text-sm font-semibold text-canvas [--pop-edge:#6e6b63]">
          Add
        </button>
      </form>
      {usual.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">Usual:</span>
          {usual.map((u) => (
            <form key={u} action={listAdd}>
              {hidden("groupId", group.id)}
              {hidden("text", u)}
              <button type="submit" className="rounded-full border border-line px-3 py-1.5 text-[13px] active:bg-mist">
                + {u}
              </button>
            </form>
          ))}
        </div>
      )}

      {mine.length > 0 && (
        <section className="mt-6 rounded-2xl border border-line bg-white px-4 py-4">
          <p className="font-semibold">
            You bought {mine.length} {mine.length === 1 ? "thing" : "things"}. What did it cost?
          </p>
          <form action={listBuy} className="mt-3 flex gap-2">
            {hidden("groupId", group.id)}
            {hidden("rid", newRequestKey())}
            <span className="flex flex-1 items-center gap-2 rounded-xl border border-line bg-mist px-3 focus-within:border-accent">
              <span className="text-sm text-gray-400">{group.currency}</span>
              <input name="amount" required inputMode="decimal" aria-label="What it cost" placeholder="0" className="w-full bg-transparent py-3 font-display text-xl outline-none" />
            </span>
            <button type="submit" className="pop shrink-0 bg-fg px-4 text-sm font-semibold text-canvas [--pop-edge:#6e6b63]">
              Add expense
            </button>
          </form>
          <p className="mt-2 text-xs text-gray-500">Groceries · paid by you · shared the group’s way · the items go in the note</p>
        </section>
      )}

      <h2 className="mb-1 mt-6 text-sm font-semibold text-gray-500">To buy · {toBuy.length}</h2>
      {toBuy.length === 0 ? (
        <p className="py-3 text-sm text-gray-500">Nothing on the list. Add what’s running low.</p>
      ) : (
        <ul>{toBuy.map((i) => row(i, false))}</ul>
      )}

      {mine.length > 0 && (
        <>
          <h2 className="mb-1 mt-6 text-sm font-semibold text-gray-500">You bought · {mine.length}</h2>
          <ul>{mine.map((i) => row(i, true))}</ul>
        </>
      )}
      {others.length > 0 && (
        <>
          <h2 className="mb-1 mt-6 text-sm font-semibold text-gray-500">Bought by others · not added yet</h2>
          <ul className="text-sm text-gray-500">
            {others.map((i) => (
              <li key={i.id} className="flex justify-between border-b border-line py-2.5">
                <span className="line-through">{i.text}</span>
                <span>{nameOf(i.boughtById)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <form action={listGoingShopping} className="mt-6">
        {hidden("groupId", group.id)}
        <button type="submit" className="text-sm font-medium text-fg underline underline-offset-4">
          Going shopping? Tell {group.type === "couple" ? "your partner" : "the flat"}
        </button>
      </form>
    </div>
  );
}
