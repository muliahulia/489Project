const supabaseDb = require('../lib/supabase');

if (data.user) {
  await supabaseDb.from('users').insert({
    id: data.user.id,
    email: data.user.email,
    first_name: firstName,
    last_name: normalizedLastName,
    role: role || 'student',
    school_name: schoolName || null,
    created_at: new Date()
  });
}