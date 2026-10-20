// Wraps every screen so it fades in as it arrives (see .lp-page in globals.css).
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="lp-page">{children}</div>;
}
