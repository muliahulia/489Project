async function insertUserActivityLog(supabase, entry) {
  if (!supabase || !entry || !entry.userId) {
    return false;
  }

  const payload = {
    user_id: entry.userId,
    action_type: entry.actionType || 'unknown',
    target_type: entry.targetType || null,
    target_id: Number.isInteger(entry.targetId) ? entry.targetId : null,
    metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : null,
  };

  const { error } = await supabase
    .from('user_activity_logs')
    .insert(payload);

  if (error) {
    console.error('USER ACTIVITY LOG INSERT ERROR:', {
      code: error.code || null,
      message: error.message || null,
      details: error.details || null,
      hint: error.hint || null,
      actionType: payload.action_type,
      userId: payload.user_id,
    });
    return false;
  }

  return true;
}

module.exports = {
  insertUserActivityLog,
};
