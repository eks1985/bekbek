import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";


export const runtime = "nodejs";

export default async function Home() {
  const user = await getSession();
  redirect(user ? "/dashboard" : "/login");
}
