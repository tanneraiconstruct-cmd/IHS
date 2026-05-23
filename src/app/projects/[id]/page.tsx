import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchBootstrap } from "@/lib/schedule/bootstrap";
import { ScheduleApp } from "@/components/schedule/ScheduleApp";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectSchedulePage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/projects/${id}`);
  }

  const bootstrap = await fetchBootstrap(id, supabase);
  return <ScheduleApp projectId={id} bootstrap={bootstrap} />;
}
