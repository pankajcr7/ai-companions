import { redirect } from "next/navigation";

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const query = new URLSearchParams({ tab: "ai" });
  for (const [k, v] of Object.entries(await searchParams)) for (const x of [v].flat()) if (x !== undefined && k !== "tab") query.append(k, x);
  redirect(`/w/${slug}/settings?${query}`);
}
