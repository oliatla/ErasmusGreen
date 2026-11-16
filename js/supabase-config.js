/* GREEN translations — Supabase connection.
   Both values are public by design: the publishable key only allows what
   the row-level-security rules in supabase/migrations/ allow. The secret
   (service_role) key never goes into the website or into git. */
window.GREEN_SUPABASE = {
  url: 'https://towcilpglemxxqhjqppn.supabase.co',
  key: 'sb_publishable_F954DkLOzQehYj6MaCCiGg_W-rTI16p',
  lib: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'
};

/* load supabase-js once and return a client (shared by /translations and the worksheet editor) */
window.greenSupabase = (function () {
  let client = null;
  return function () {
    if (client) return client;
    client = new Promise((resolve, reject) => {
      const done = () => resolve(window.supabase.createClient(window.GREEN_SUPABASE.url, window.GREEN_SUPABASE.key, {
        auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
      }));
      if (window.supabase && window.supabase.createClient) return done();
      const s = document.createElement('script');
      s.src = window.GREEN_SUPABASE.lib;
      s.onload = done;
      s.onerror = () => reject(new Error('supabase-js could not be loaded'));
      document.head.appendChild(s);
    });
    return client;
  };
})();
