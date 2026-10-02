import { AuthForm } from "@/components/app/AuthForm";

export const metadata = { title: "Sign in | Agent Company" };
export default function SignIn() {
  return <AuthForm mode="sign-in" />;
}
