// Shared app state.
export const state = {
  session: null,
  // From get_site(): { teacher_name, institution, has_owner, is_owner, ai_ready }
  site: { teacher_name: '', institution: '', has_owner: false, is_owner: false, ai_ready: false },
  get uid() { return this.session?.user?.id || null; },
  get isTeacher() { return Boolean(this.session && this.site.is_owner); },
};
