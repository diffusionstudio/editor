/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isLocalOnly } from './local-only';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function initSupabase(): SupabaseClient | null {
  if (isLocalOnly()) {
    console.info('[local-only] Supabase and remote authentication are disabled.');
    return null;
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[supabase] VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set. Auth is disabled.');
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

export const supabase = initSupabase();
