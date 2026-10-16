import { LoginForm } from "@/components/login-form";
import { isPreviewMode } from "@/lib/preview";
export const dynamic = "force-dynamic";
export default function LoginPage() {
  return <LoginForm demoAllowed={process.env.HORUS_DEMO_MODE === "true"} previewOnly={isPreviewMode()} embeddedPreview={process.env.HORUS_EMBEDDED_PREVIEW === "true"} />;
}
