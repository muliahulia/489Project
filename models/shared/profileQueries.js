async function fetchProfileById(supabase, userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

async function fetchProfilesByIds(supabase, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .in('id', ids);

  if (error || !Array.isArray(data)) {
    return [];
  }

  return data;
}

module.exports = {
  fetchProfileById,
  fetchProfilesByIds,
};
