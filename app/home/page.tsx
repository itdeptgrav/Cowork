import { Home } from "@/components/features/dashboard/Home";

export const metadata = { title: "Home — Cowork" };

/** Alias for `/`. Both are in the approved route inventory. */
export default function Page() {
  return <Home />;
}
