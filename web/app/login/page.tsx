import { Suspense } from "react";
import { DemoLogin } from "@/components/shared/demo-login";

export const metadata = { title: "Forense · Acceso" };

export default function LoginPage() {
  return (
    <Suspense>
      <DemoLogin />
    </Suspense>
  );
}
