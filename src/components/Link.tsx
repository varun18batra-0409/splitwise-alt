"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";

// Every screen in Loopin is built fresh for you, so Next.js's automatic
// prefetching only fetched the outer frame and then had to fetch the screen
// again after the tap: two trips to the server in a row. Turning it off makes
// each tap one trip. (Pass prefetch explicitly to override.)
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
