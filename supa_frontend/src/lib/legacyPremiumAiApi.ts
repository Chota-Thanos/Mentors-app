import axios from "axios";

import { premiumApiRoot } from "@/lib/premiumApi";
import { createClient } from "@/lib/supabase/client";

export const legacyPremiumAiApi = axios.create({
  baseURL: `${premiumApiRoot}/api/v1`,
});

legacyPremiumAiApi.interceptors.request.use(async (config) => {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  return config;
});
