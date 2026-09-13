import { Suspense } from "react";
import { DemoLogin } from "@/components/shared/demo-login";
import { InspectorWordmark } from "@/components/shared/logo";
import styles from "./login.module.css";

export const metadata = { title: "Inspector · Sign in" };

export default function LoginPage() {
  return (
    <Suspense fallback={<div className={styles.loading}><InspectorWordmark className={styles.brand} /><p role="status">Loading sign-in…</p></div>}>
      <DemoLogin />
    </Suspense>
  );
}
