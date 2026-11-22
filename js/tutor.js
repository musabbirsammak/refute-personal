// Labels and small helpers for the interface. The debate itself (prompts,
// judging, scoring) runs on the server: supabase/functions/refute-ai.
// cleanCriteria, requiredIndices and characterName mirror the server's
// versions so the interface shows points the same way.

export const STUBBORNNESS = {
  gentle: { label: 'Gentle', hint: 'Warmly accepts good partial points. Good for first-year students.' },
  firm: { label: 'Firm', hint: 'Pushes back on every point with a counter-argument.' },
  tough: { label: 'Tough', hint: 'Demands precise reasoning and challenges loose terms.' },
};

export const LANGUAGES = {
  en: { label: 'English' },
  bn: { label: 'বাংলা (Bangla)' },
  match: { label: 'Match the student' },
};

export const STATUS_TEXT = {
  in_progress: 'In progress',
  conceded: 'Convinced the AI',
  gave_up: 'Gave up',
  max_turns: 'Ran out of messages',
};

export function characterName(persona) {
  const name = String(persona || '').split(/[,(–—]/)[0].trim();
  return name && name.length <= 40 ? name : 'The AI';
}

export function cleanCriteria(criteria) {
  return (Array.isArray(criteria) ? criteria : [])
    .map((c) => ({
      text: String(c?.text || '').trim(),
      required: c?.required !== false,
      weight: Math.max(1, Math.round(Number(c?.weight) || 10)),
    }))
    .filter((c) => c.text);
}

export function requiredIndices(criteria) {
  const req = criteria.map((c, i) => (c.required ? i : -1)).filter((i) => i >= 0);
  return req.length ? req : criteria.map((_, i) => i);
}
