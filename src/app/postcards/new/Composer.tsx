"use client";

import { useMemo, useRef, useState } from "react";
import { PostcardBack, PostcardFront } from "@/components/postcards/Card";
import { PostcardOneSide } from "@/components/postcards/OneSide";
import { face } from "@/components/postcards/PostcardView";
import { shrink } from "@/components/OwnPhoto";
import { buzz } from "@/lib/haptics";
import { keptLook, keptTouches } from "@/lib/postcards/looks";
import { HANDS, keptHand, keptInk, keptLettering, keptPaper, keptTone, stampOrder, toneOf } from "@/lib/postcards/catalog";
import { messageFit, overText, roughMeasure, type MeasureEm } from "@/lib/postcards/fit";
import { fitOf, formatOf, oneSideTooLong, photoSizeOf, ONESIDE_MAX, type Fit, type Format, type PhotoSize } from "@/lib/postcards/format";
import { sendPostcardAction } from "@/app/postcard-actions";
import type { PostcardGroup } from "@/lib/postcards/people";
import type { MyUpload } from "@/lib/postcards/uploads";
import type { PostcardMoment } from "@/lib/moments-db";
import { TopBar, type Step } from "./editor/TopBar";
import { FormatSwitch } from "./editor/FormatSwitch";
import { ToolRow, type ToolDef } from "./editor/ToolRow";
import { PhotoPanel, type Own } from "./editor/PhotoPanel";
import { ColourPanel, LetteringPanel, LookPanel, TouchesPanel, WordsPanel } from "./editor/FrontPanels";
import { MessagePanel, PaperPanel, PenPanel, SealPanel, StampPanel } from "./editor/NotePanels";
import { SendStep } from "./editor/SendStep";
import { Icons } from "./editor/shared";

type Props = {
  groupId: string;
  groups: PostcardGroup[];
  photos: string[];
  photosLabel: string;
  words: string[];
  uploads: MyUpload[];
  moments: PostcardMoment[];
  tripCountry: string;
  title: string;
  backHref: string;
  error?: string;
  defaults: {
    front: string;
    words: string;
    stamp: string;
    place: string;
    to: string[];
    // When sending a card again: everything it had.
    from?: string;
    format?: string;
    fit?: string;
    photoSize?: string;
    lettering?: string;
    tone?: string;
    look?: string;
    wordsAt?: string;
    wordsSize?: number;
    touches?: string;
    seal?: string;
    signoff?: string;
    message?: string;
    hand?: string;
    paper?: string;
    ink?: string;
    address?: string[];
    ownPhoto?: { id: string; url: string };
  };
  rare: { id: string; until: string }[];
  home: string;
  myName: string;
  date: string;
};

const FRONT_TOOLS: ToolDef[] = [
  { id: "photo", name: "Photo", icon: Icons.photo },
  { id: "look", name: "Look", icon: Icons.look },
  { id: "words", name: "Words", icon: Icons.words },
  { id: "lettering", name: "Lettering", icon: Icons.lettering },
  { id: "colour", name: "Colour", icon: Icons.colour },
  { id: "touches", name: "Touches", icon: Icons.touchesFront },
];
const NOTE_TOOLS: ToolDef[] = [
  { id: "message", name: "Message", icon: Icons.message },
  { id: "pen", name: "Pen", icon: Icons.pen },
  { id: "paper", name: "Paper", icon: Icons.paper },
  { id: "stamp", name: "Stamp", icon: Icons.stamp },
  { id: "seal", name: "Wax seal", icon: Icons.seal },
  { id: "touches", name: "Touches", icon: Icons.touches },
];
const ONE_TOOLS: ToolDef[] = [{ id: "photo", name: "Photo", icon: Icons.photo }, ...NOTE_TOOLS];
// The touches a one-side card has room for (its wax seal is its own tool).
const ONE_TOUCHES = ["coffee", "flower", "paravion"];

// Write a postcard on one screen: the card in the middle, the options for the chosen tool above the tool row, and Next at the bottom.
// Front, Note and Card are one fixed screen (nothing scrolls but a long list inside its own panel); Send is an ordinary page.
// Every tap changes the card at once. Send goes to the people you tick.
export function Composer({ groupId, groups, photos, photosLabel, words: wordOptions, uploads, moments, tripCountry, title, backHref, error, defaults, rare, home, myName, date }: Props) {
  const [tab, setTab] = useState<Step>("front");
  const [format, setFormat] = useState<Format>(formatOf(defaults.format));
  const [fit, setFit] = useState<Fit>(fitOf(defaults.fit));
  const [photoSize, setPhotoSize] = useState<PhotoSize>(photoSizeOf(defaults.photoSize));
  const [tools, setTools] = useState({ front: "photo", back: "message", one: "photo" });
  const [front, setFront] = useState(defaults.front);
  // Where an own photo comes from: a new upload (data), one of your earlier uploads (reuseId) or one of your own moments (momentId).
  // Each source writes only its own field, so the form sends exactly one of photo / reusePhoto / momentPhoto.
  const [own, setOwn] = useState<Own>(defaults.ownPhoto ? { url: defaults.ownPhoto.url, reuseId: defaults.ownPhoto.id } : null);
  const [words, setWords] = useState(defaults.words);
  const [custom, setCustom] = useState(Boolean(defaults.words) && !wordOptions.includes(defaults.words));
  const [lettering, setLettering] = useState(keptLettering(defaults.lettering ?? "classic"));
  const [tone, setTone] = useState(keptTone(defaults.tone ?? "white"));
  const [look, setLook] = useState(() => {
    const [id, n] = (defaults.look ?? "").split(":");
    return id ? `${keptLook(id)}:${n ?? 100}` : "";
  });
  const [wordsAt, setWordsAt] = useState(defaults.wordsAt ?? "bottom");
  const [wordsSize, setWordsSize] = useState(defaults.wordsSize ?? 100);
  const [touches, setTouches] = useState<string[]>(keptTouches(defaults.touches));
  const [seal, setSeal] = useState(defaults.seal ?? "crimson:initial");
  const [message, setMessage] = useState(defaults.message ?? "");
  const [signoff, setSignoff] = useState(defaults.signoff ?? "");
  const [hand, setHand] = useState(keptHand(defaults.hand ?? "caveat"));
  const [stamp, setStamp] = useState(defaults.stamp);
  const [paper, setPaper] = useState(keptPaper(defaults.paper ?? "cream"));
  const [ink, setInk] = useState(keptInk(defaults.ink ?? "navy"));
  const [to, setTo] = useState<string[]>(defaults.to);
  const [addr, setAddr] = useState<string[]>(defaults.address ?? ["", "", ""]);
  const [opensOn, setOpensOn] = useState("");
  const [photoState, setPhotoState] = useState("");
  const [typing, setTyping] = useState(false);
  const [nudge, setNudge] = useState("");
  const autoNavy = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const oneSide = format === "oneside";
  const everyone = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const p of g.people) if (!m.has(p.id)) m.set(p.id, p.name);
    return m;
  }, [groups]);
  const firstOf = (n: string) => n.trim().split(/\s+/)[0] || n;
  // With one person picked, the first address line is their name (until you type your own).
  const address = addr[0] || to.length !== 1 ? addr : [firstOf(everyone.get(to[0]) ?? ""), addr[1], addr[2]];
  const rareIds = rare.map((r) => r.id);
  const stampList = useMemo(() => stampOrder(stamp, tripCountry, home, rareIds), [home, tripCountry, rareIds.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const touchList = touches.join(",");
  const toggleTouch = (id: string) => setTouches((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const sealOn = touches.includes("seal");
  const setSealOn = (on: boolean) => setTouches((t) => (on ? (t.includes("seal") ? t : [...t, "seal"]) : t.filter((x) => x !== "seal")));

  const from = signoff.trim() || firstOf(myName) || "Me";
  const frontProps = { front, photo: front === "own" ? own?.url : undefined, words, lettering, tone, look, wordsAt, wordsSize, touches: touchList, fit, k: "cf" };
  const backProps = { message: message || "Your words here…", hand, stamp, paper, ink, touches: touchList, seal, address, place: defaults.place, date, from, k: "cb" };
  const oneProps = { size: photoSize, front, photo: front === "own" ? own?.url : undefined, look, message: message || "Your words here…", hand, stamp, paper, ink, touches: touchList, seal, place: defaults.place, date, from, k: "co" };

  async function pickPhoto(file?: File) {
    if (!file) return;
    setPhotoState("Getting it ready…");
    try {
      const blob = await shrink(file);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      setOwn({ url: URL.createObjectURL(blob), data: btoa(bin) });
      setFront("own");
      setPhotoState("");
      buzz("tap");
    } catch (e) {
      setPhotoState(e instanceof Error ? e.message : "Couldn’t use that photo.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  // A taped print is white-edged on cream: light words would vanish on it, so the first time it is chosen (with a light colour) the
  // words go Navy. Change them back whenever you like.
  const chooseFit = (f: Fit) => {
    setFit(f);
    if (f === "taped" && !autoNavy.current && !toneOf(tone).dark) {
      autoNavy.current = true;
      setTone("navy");
    }
  };

  // Does the message fit on the card? Measured with the chosen handwriting when the phone can, roughly otherwise.
  const handDef = HANDS.find((h) => h.id === hand);
  const measure = useMemo<MeasureEm>(() => {
    try {
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx || !handDef) return roughMeasure;
      ctx.font = `100px '${handDef.family}', cursive`;
      return (t) => ctx.measureText(t).width / 100;
    } catch {
      return roughMeasure;
    }
  }, [handDef]);
  const fitInfo = messageFit(`${message}`, handDef?.size ?? 1, measure);
  const tooLong = oneSide ? oneSideTooLong(message) : fitInfo.over > 0;

  const steps: { id: Step; name: string }[] = oneSide
    ? [
        { id: "front", name: "Card" },
        { id: "send", name: "Send" },
      ]
    : [
        { id: "front", name: "Front" },
        { id: "back", name: "Note" },
        { id: "send", name: "Send" },
      ];
  const order = steps.map((s) => s.id);
  const goStep = (s: Step) => {
    setTab(s);
    setTyping(false);
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  };
  const toolKey = oneSide ? "one" : tab === "back" ? "back" : "front";
  const toolDefs = oneSide ? ONE_TOOLS : tab === "back" ? NOTE_TOOLS : FRONT_TOOLS;
  const tool = tools[toolKey];
  const pickTool = (id: string) => setTools((t) => ({ ...t, [toolKey]: id }));
  const messageTool = () => setTools((t) => ({ ...t, [oneSide ? "one" : "back"]: "message" }));

  // Next: Front goes to Note. Note (or the one-side Card) needs a message that fits: if not, the Message tool opens and says so (never silent).
  const next = () => {
    if (tab === "front" && !oneSide) return goStep("back");
    if (!message.trim()) {
      messageTool();
      setNudge("Write a few words first");
      return;
    }
    if (tooLong) {
      messageTool();
      setNudge(oneSide ? `A one-side card holds up to ${ONESIDE_MAX} characters. Take a few out.` : overText(fitInfo.over));
      return;
    }
    setNudge("");
    goStep("send");
  };
  const flip = () => {
    buzz("tap");
    goStep(tab === "front" ? "back" : "front");
  };
  const onMessage = (m: string) => {
    setMessage(m);
    setNudge("");
  };
  const changeFormat = (f: Format) => {
    setFormat(f);
    setNudge("");
  };

  const showBack = tab === "back";
  const trip = front.startsWith("photo:") ? front.slice(6) : "";
  const lookSrc = front === "own" ? own?.url ?? "" : trip;
  const cardW = typing ? "w-[min(60cqw,90cqh)]" : "w-[min(96cqw,144cqh)]";
  const preview = oneSide ? (
    <div className={cardW} data-composer-card="oneside">
      <PostcardOneSide {...oneProps} />
    </div>
  ) : (
    <button type="button" onClick={flip} aria-label={showBack ? "Show the front" : "Show the back"} className={`block ${cardW} [perspective:1600px]`} data-composer-card={showBack ? "back" : "front"}>
      <div className="relative transition-transform duration-[800ms] ease-[cubic-bezier(.2,.8,.2,1)] [transform-style:preserve-3d] motion-reduce:transition-none" style={{ transform: showBack ? "rotateY(180deg)" : "none" }}>
        <div className="[backface-visibility:hidden]" style={face(!showBack)}>
          <PostcardFront {...frontProps} />
        </div>
        <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]" style={face(showBack)}>
          <PostcardBack {...backProps} />
        </div>
      </div>
    </button>
  );

  const panel = (() => {
    const t = tool;
    if (t === "photo")
      return (
        <PhotoPanel
          format={format}
          front={front}
          own={own}
          onFront={setFront}
          onFile={pickPhoto}
          fileRef={fileRef}
          state={photoState}
          uploads={uploads}
          moments={moments}
          onUpload={(u) => (setOwn({ url: u.url, reuseId: u.id }), setFront("own"), buzz("tap"))}
          onMoment={(m) => (setOwn({ url: m.full, momentId: m.id }), setFront("own"), buzz("tap"))}
          photos={photos}
          photosLabel={photosLabel}
          fit={fit}
          onFit={chooseFit}
          size={photoSize}
          onSize={setPhotoSize}
        />
      );
    if (t === "look") return <LookPanel look={look} setLook={setLook} src={lookSrc} front={front} />;
    if (t === "words") return <WordsPanel words={words} setWords={setWords} custom={custom} setCustom={setCustom} options={wordOptions} wordsAt={wordsAt} setWordsAt={setWordsAt} wordsSize={wordsSize} setWordsSize={setWordsSize} />;
    if (t === "lettering") return <LetteringPanel lettering={lettering} setLettering={setLettering} />;
    if (t === "colour") return <ColourPanel tone={tone} setTone={setTone} />;
    if (t === "message")
      return <MessagePanel format={format} message={message} setMessage={onMessage} over={fitInfo.over} nudge={nudge} signoff={signoff} setSignoff={setSignoff} myFirst={firstOf(myName)} hand={hand} ink={ink} addr={address} setAddr={setAddr} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} />;
    if (t === "pen") return <PenPanel hand={hand} setHand={setHand} ink={ink} setInk={setInk} />;
    if (t === "paper") return <PaperPanel paper={paper} setPaper={setPaper} />;
    if (t === "stamp") return <StampPanel stamp={stamp} setStamp={setStamp} list={stampList} rare={rare} />;
    if (t === "seal") return <SealPanel on={sealOn} setOn={setSealOn} seal={seal} setSeal={setSeal} name={firstOf(myName)} />;
    // touches
    if (oneSide) return <TouchesPanel side="back" touches={touches} toggle={toggleTouch} ids={ONE_TOUCHES} />;
    return <TouchesPanel side={tab === "back" ? "back" : "front"} touches={touches} toggle={toggleTouch} />;
  })();

  return (
    <form action={sendPostcardAction} data-allow-repeat="1">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="front" value={front} />
      <input type="hidden" name="format" value={format} />
      <input type="hidden" name="fit" value={fit} />
      <input type="hidden" name="photoSize" value={photoSize} />
      {front === "own" && own?.data && <input type="hidden" name="photo" value={own.data} />}
      {front === "own" && own?.reuseId && !own.data && <input type="hidden" name="reusePhoto" value={own.reuseId} />}
      {front === "own" && own?.momentId && !own.data && <input type="hidden" name="momentPhoto" value={own.momentId} />}
      {defaults.from && <input type="hidden" name="from" value={defaults.from} />}
      <input type="hidden" name="look" value={look} />
      <input type="hidden" name="wordsAt" value={wordsAt} />
      <input type="hidden" name="wordsSize" value={wordsSize} />
      <input type="hidden" name="touches" value={touchList} />
      <input type="hidden" name="seal" value={seal} />
      <input type="hidden" name="signoff" value={signoff.trim()} />
      <input type="hidden" name="opensOn" value={opensOn} />
      <input type="hidden" name="words" value={words} />
      <input type="hidden" name="lettering" value={lettering} />
      <input type="hidden" name="tone" value={tone} />
      <input type="hidden" name="hand" value={hand} />
      <input type="hidden" name="stamp" value={stamp} />
      <input type="hidden" name="paper" value={paper} />
      <input type="hidden" name="ink" value={ink} />
      <input type="hidden" name="place" value={defaults.place} />
      <input type="hidden" name="message" value={message} />
      {address.map((a, i) => (
        <input key={i} type="hidden" name={`addr${i}`} value={a} />
      ))}
      {to.map((id) => (
        <input key={id} type="hidden" name="to" value={id} />
      ))}

      {tab === "send" ? (
        <div>
          <TopBar title={title} steps={steps} step={tab} onStep={goStep} onBack={() => goStep(order[Math.max(0, order.indexOf(tab) - 1)])} backHref={backHref} visibleTitle error={error} />
          <SendStep groups={groups} to={to} setTo={setTo} opensOn={opensOn} setOpensOn={setOpensOn} hasMessage={Boolean(message.trim())} onWrite={() => (messageTool(), goStep(oneSide ? "front" : "back"))} front={frontProps} back={backProps} one={oneSide ? oneProps : null} />
        </div>
      ) : (
        // The edit steps are one fixed screen (this gets around the page's bottom padding). A long list scrolls inside its own panel.
        <div className="fixed inset-0 z-30 mx-auto flex max-w-md flex-col gap-2.5 bg-canvas px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))] max-[359px]:px-4" data-composer data-step-now={tab}>
          <TopBar title={title} steps={steps} step={tab} onStep={goStep} onBack={() => goStep(order[Math.max(0, order.indexOf(tab) - 1)])} backHref={backHref} error={error} />
          {tab === "front" && <FormatSwitch format={format} onChange={changeFormat} />}
          <div className="flex min-h-0 flex-1 items-center justify-center [container-type:size]" data-composer-preview data-typing={typing ? "" : undefined}>
            {preview}
          </div>
          {panel}
          <ToolRow label={oneSide ? "Card tools" : tab === "back" ? "Note tools" : "Front tools"} tools={toolDefs} active={tool} onPick={pickTool} />
          <div className={`flex flex-none items-center ${oneSide ? "justify-end" : "justify-between"}`}>
            {!oneSide && (
              <button type="button" onClick={flip} className="flex h-12 items-center gap-2 rounded-full border border-fg/25 px-[18px] text-[15px] font-semibold active:scale-[0.97] motion-reduce:transition-none">
                {Icons.flip}
                Flip
              </button>
            )}
            <button type="button" onClick={next} data-next className="flex h-[52px] w-[150px] items-center justify-center rounded-full bg-fg text-[17px] font-semibold text-canvas active:scale-[0.97] motion-reduce:transition-none">
              Next
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
