import { AuthForm } from "@/components/app/AuthForm";

export const metadata = { title: "Create account | Agent Company" };
export default function SignUp() {
  return <AuthForm mode="sign-up" />;
}
