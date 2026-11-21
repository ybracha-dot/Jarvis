import { probe } from "@/lib/probe";
export const dynamic = "force-dynamic";
export default function P() { return <p>{JSON.stringify(probe())}</p>; }
