import { connection } from "next/server";
import { adminCodeEnabled } from "@/lib/auth/admin-code";
import { LoginForm } from "./login-form";

export const runtime = "nodejs";

export default async function LoginPage() {
  // ADMIN_CODE читаем в момент запроса, а не на сборке: страница тогда
  // рендерится динамически, и включение секретного кода сразу меняет форму.
  await connection();
  return <LoginForm adminCode={adminCodeEnabled()} />;
}
