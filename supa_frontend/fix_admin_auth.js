const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://jporltouxpoletzziqgf.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impwb3JsdG91eHBvbGV0enppcWdmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjI2ODg0NSwiZXhwIjoyMDkxODQ0ODQ1fQ.yN3WkVkcm5nHQaT_k-m-T-1FUX9rkVA6gJwiY_9jA2Q";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function fixUser() {
  const email = "alphaadmin@gmail.com";
  
  // Find the exact user ID
  const { data: usersData } = await supabase.auth.admin.listUsers();
  const user = usersData?.users.find((u) => u.email === email);
  
  if (!user) {
    console.log("Could not find user.");
    return;
  }
  
  console.log("Found user ID:", user.id);
  
  // We need to update user_metadata or app_metadata with role: "admin"
  // so that the legacy frontend permissions like `extractRole` work!
  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, role: "admin" },
    user_metadata: { ...user.user_metadata, role: "admin" }
  });
  
  if (error) {
    console.error("Error updating user auth meta:", error);
  } else {
    console.log("Successfully attached 'role: admin' to the auth JWT user object! Let the frontend see it.");
  }
}

fixUser().catch(console.error);
