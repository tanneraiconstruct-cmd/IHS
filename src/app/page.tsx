import { redirect } from "next/navigation";

const HARDCODED_PROJECT_ID = "70000000-0000-0000-0000-000000000000";

export default function Home() {
  redirect(`/projects/${HARDCODED_PROJECT_ID}`);
}
