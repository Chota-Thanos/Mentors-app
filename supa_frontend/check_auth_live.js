const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://jporltouxpoletzziqgf.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impwb3JsdG91eHBvbGV0enppcWdmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjI2ODg0NSwiZXhwIjoyMDkxODQ0ODQ1fQ.yN3WkVkcm5nHQaT_k-m-T-1FUX9rkVA6gJwiY_9jA2Q";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  const email = "alphaadmin@gmail.com";
  
  const { data: usersData, error: err } = await supabase.auth.admin.listUsers();
  if (err) {
     console.error("List users err:", err);
     return;
  }
  
  const user = usersData?.users.find((u) => u.email === email);
  console.log("Admin user:", JSON.stringify(user, null, 2));

  // Query profiles to see what it says
  if (user) {
      const { data: profile } = await supabase.from('profiles').select('*').eq('auth_user_id', user.id).single();
      console.log("\nProfile in DB:", profile);
  } else {
      console.log("\nWARNING: user not found!");
  }
}

run();
