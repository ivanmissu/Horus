import { LoginForm } from "@/components/login-form";
export const dynamic = "force-dynamic";
export default function LoginPage() {
  return <LoginForm demoAllowed={process.env.HORUS_REQUIRE_LOGIN !== "true"} />;
}
