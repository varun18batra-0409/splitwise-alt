"use client";

import { Splash } from "@/components/Splash";

// While Home is on its way. Opening the app: the splash screen (it keeps going
// for as long as the connection needs). Coming back to Home from another
// screen: a quick outline of Home instead.
export default function HomeLoading() {
  const booted = typeof window !== "undefined" && (window as { __lpBooted?: boolean }).__lpBooted === true;
  if (!booted) return <Splash />;
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="lp-skel h-8 w-28 rounded-lg" />
        <div className="flex gap-2">
          <div className="lp-skel h-10 w-10 rounded-full" />
          <div className="lp-skel h-10 w-10 rounded-full" />
        </div>
      </div>
      <div className="lp-skel h-[268px] rounded-[24px]" />
      <div className="grid grid-cols-2 gap-3">
        <div className="lp-skel h-[188px] rounded-[20px]" />
        <div className="lp-skel h-[188px] rounded-[20px]" />
      </div>
    </div>
  );
}
