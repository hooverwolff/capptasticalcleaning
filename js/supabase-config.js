/* ===========================================================
   Supabase configuration
   -----------------------------------------------------------
   1. Create a project at https://supabase.com
   2. Go to Project Settings → API
   3. Copy your "Project URL" and "anon public" key below.

   The anon key is meant to be public / shipped in client code —
   it's safe BECAUSE every table is locked down with Row Level
   Security policies (see supabase/schema.sql). Never put your
   "service_role" key anywhere in this front-end code.
   =========================================================== */

const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';

if (SUPABASE_URL.includes('YOUR-PROJECT-REF') || SUPABASE_ANON_KEY.includes('YOUR-ANON')) {
  console.warn(
    '[Capptastical Cleaning] Supabase isn\u2019t configured yet — ' +
    'edit js/supabase-config.js with your project URL and anon key. ' +
    'See README.md for setup steps.'
  );
}

// Named `supabaseClient` (not `supabase`) on purpose — the Supabase
// library itself defines a global called `supabase` (that's what
// `window.supabase.createClient` comes from below), so reusing that
// name for our client would collide with it in the page's shared
// global scope.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
