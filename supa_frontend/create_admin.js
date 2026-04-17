const { createClient } = require("@supabase/supabase-js");


// Prefer env vars if present, otherwise fallback (paste your backend service key here if needed)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://jporltouxpoletzziqgf.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impwb3JsdG91eHBvbGV0enppcWdmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjI2ODg0NSwiZXhwIjoyMDkxODQ0ODQ1fQ.yN3WkVkcm5nHQaT_k-m-T-1FUX9rkVA6gJwiY_9jA2Q";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function setupAdmin() {
  const email = "alphaadmin@gmail.com";
  const password = "admin@43214";

  console.log(`Setting up admin user: ${email}...`);

  // 1. Create or get auth user
  let userId;
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) {
    if (authError.message.includes("already registered") || authError.message.includes("already exists")) {
      console.log("User already exists in auth.users. Looking up... ");
      // Try to find the user ID to update their profile
      const { data: existingUser } = await supabase.auth.admin.listUsers();
      const user = existingUser?.users.find((u) => u.email === email);
      if (user) {
        userId = user.id;
        console.log(`Found existing user ID: ${userId}`);
      } else {
        console.error("Could not find the existing user's ID.");
        return;
      }
    } else {
      console.error("Error creating user:", authError);
      return;
    }
  } else {
    userId = authData.user.id;
    console.log(`User created successfully with ID: ${userId}`);
  }

  // 2. Upsert admin profile into public.profiles
  console.log("Upserting user into public.profiles with 'admin' role...");
  
  // Note: Since Supabase sometimes fires auth triggers, wait a moment to avoid race conditions with the trigger
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const { data: profileCheck } = await supabase
    .from("profiles")
    .select("id")
    .eq("auth_user_id", userId)
    .single();

  const profilePayload = {
    auth_user_id: userId,
    display_name: "Admin",
    email: email,
    role: "admin",
    is_active: true,
  };

  // If a profile exists (e.g., from an auth trigger), update it. Otherwise, insert.
  if (profileCheck?.id) {
    const { error: updateError } = await supabase
      .from("profiles")
      .update(profilePayload)
      .eq("id", profileCheck.id);
      
    if (updateError) {
      console.error("Error updating profile:", updateError);
    } else {
        console.log("Admin account successfully given 'admin' role!");
    }
  } else {
    const { error: insertError } = await supabase
      .from("profiles")
      .insert(profilePayload);
      
    if (insertError) {
      console.error("Error creating profile:", insertError);
    } else {
      console.log("Admin account successfully created and granted 'admin' role!");
    }
  }

}

setupAdmin().catch(console.error);
