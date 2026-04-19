const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://jporltouxpoletzziqgf.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impwb3JsdG91eHBvbGV0enppcWdmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjI2ODg0NSwiZXhwIjoyMDkxODQ0ODQ1fQ.yN3WkVkcm5nHQaT_k-m-T-1FUX9rkVA6gJwiY_9jA2Q";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  const email = "alphaadmin@gmail.com";
  const newPassword = "AlphaPassword123!";
  
  const { data: usersData } = await supabase.auth.admin.listUsers();
  const user = usersData?.users.find((u) => u.email === email);
  if (!user) {
     console.error("Admin user not found.");
     return;
  }
  
  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    password: newPassword,
    email_confirm: true
  });
  
  if (error) {
     console.error("Failed to reset password:", error);
  } else {
     console.log("SUCCESS! Admin password reset to:", newPassword);
  }
}
run();
