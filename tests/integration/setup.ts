import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const ORG_ID     = "00000000-0000-0000-0000-0000000000aa";
export const CO_INT     = "00000000-0000-0000-0000-0000000000bb";
export const PROJECT_ID = "33333333-3333-3333-3333-333333333333";
export const CAL_ID     = "44444444-4444-4444-4444-444444444444";
export const WBS_ID     = "55555555-5555-5555-5555-555555555555";
// These constants double as the *email-local-part* for each test user. The
// actual auth.users.id is assigned by Supabase and surfaced via idByEmail.
export const SCHED_ID   = "11111111-1111-1111-1111-111111111111";
export const PM_ID      = "66666666-6666-6666-6666-666666666666";
export const VIEWER_ID  = "22222222-2222-2222-2222-222222222222";

const TEST_PASSWORD = "test-pw-1234";

export function service(): SupabaseClient {
  return createClient(URL, SERVICE,
    { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function asUser(userId: string): Promise<SupabaseClient> {
  const email = `${userId}@test.local`;
  const c = createClient(URL, ANON,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`asUser(${userId}) sign-in failed: ${error.message}`);
  return c;
}

export interface Fixture {
  PROJECT_ID: string;
  CAL_ID: string;
  WBS_ID: string;
  idByEmail: Record<string, string>;
}

export async function seedFixture(): Promise<Fixture> {
  const s = service();

  // 1. Wipe prior project rows.
  await s.from("applied_edit_requests").delete().eq("project_id", PROJECT_ID);
  await s.from("activity_history").delete().eq("project_id", PROJECT_ID);
  await s.from("dependencies").delete().eq("project_id", PROJECT_ID);
  await s.from("activities").delete().eq("project_id", PROJECT_ID);
  await s.from("wbs_nodes").delete().eq("project_id", PROJECT_ID);
  await s.from("memberships").delete().eq("project_id", PROJECT_ID);
  await s.from("calendars").delete().eq("project_id", PROJECT_ID);
  await s.from("projects").delete().eq("id", PROJECT_ID);

  // 2. Wipe prior test users by email (auth.admin.listUsers + deleteUser).
  const testEmails = new Set(
    [SCHED_ID, PM_ID, VIEWER_ID].map(uid => `${uid}@test.local`),
  );
  const existing = await s.auth.admin.listUsers({ perPage: 200 });
  for (const u of existing.data.users) {
    if (u.email && testEmails.has(u.email)) {
      await s.from("users").delete().eq("id", u.id);
      await s.auth.admin.deleteUser(u.id).catch(() => {});
    }
  }
  await s.from("companies").delete().eq("id", CO_INT);
  await s.from("organizations").delete().eq("id", ORG_ID);

  // 3. Re-seed org + company.
  await s.from("organizations").insert({ id: ORG_ID, name: "TEST org" });
  await s.from("companies").insert({
    id: CO_INT, organization_id: ORG_ID, name: "TEST internal", type: "internal",
  });

  // 4. Re-seed auth users + public.users profiles. Capture actual auth ids.
  const idByEmail: Record<string, string> = {};
  for (const [uid, fullName] of [
    [SCHED_ID,  "Test Scheduler"],
    [PM_ID,     "Test PM"],
    [VIEWER_ID, "Test Viewer"],
  ] as const) {
    const email = `${uid}@test.local`;
    const created = await s.auth.admin.createUser({
      email, password: TEST_PASSWORD, email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (created.error) throw created.error;
    const realId = created.data.user!.id;
    idByEmail[email] = realId;
    await s.from("users").insert({
      id: realId, company_id: CO_INT, full_name: fullName, email,
    });
  }

  // 5. Project + calendar + WBS root.
  await s.from("projects").insert({
    id: PROJECT_ID, organization_id: ORG_ID, name: "TEST proj",
    project_start: "2026-06-01",
  });
  await s.from("calendars").insert({
    id: CAL_ID, project_id: PROJECT_ID, name: "Default", is_default: true,
    working_weekdays: [1,2,3,4,5],
  });
  await s.from("projects").update({ default_calendar_id: CAL_ID }).eq("id", PROJECT_ID);
  await s.from("wbs_nodes").insert({ id: WBS_ID, project_id: PROJECT_ID, name: "Root" });

  // 6. Memberships using actual auth ids.
  await s.from("memberships").insert([
    { user_id: idByEmail[`${SCHED_ID}@test.local`],  project_id: PROJECT_ID, role: "scheduler" },
    { user_id: idByEmail[`${PM_ID}@test.local`],     project_id: PROJECT_ID, role: "project_manager" },
    { user_id: idByEmail[`${VIEWER_ID}@test.local`], project_id: PROJECT_ID, role: "internal_viewer" },
  ]);

  // 7. Four activities so cascade tests have something to cascade.
  await s.from("activities").insert([
    { project_id: PROJECT_ID, wbs_node_id: WBS_ID, name: "A1",
      original_duration: 5, remaining_duration: 5 },
    { project_id: PROJECT_ID, wbs_node_id: WBS_ID, name: "A2",
      original_duration: 3, remaining_duration: 3 },
    { project_id: PROJECT_ID, wbs_node_id: WBS_ID, name: "A3",
      original_duration: 2, remaining_duration: 2 },
    { project_id: PROJECT_ID, wbs_node_id: WBS_ID, name: "A4",
      original_duration: 4, remaining_duration: 4 },
  ]);

  return { PROJECT_ID, CAL_ID, WBS_ID, idByEmail };
}
