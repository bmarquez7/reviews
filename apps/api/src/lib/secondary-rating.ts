type SecondaryMeta = {
  accessibility_notes?: string | null;
  wifi_speed?: number | null;
  place_size?: 'small' | 'medium' | 'large' | 'extra_large' | null;
  kid_friendly?: boolean | null;
  pet_friendly?: boolean | null;
  vegan_friendly?: boolean | null;
  vegetarian_friendly?: boolean | null;
  halal?: boolean | null;
  sugar_free_options?: boolean | null;
  gluten_free_options?: boolean | null;
  accommodates_allergies?: boolean | null;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const parseSecondaryMeta = (raw: string | null | undefined): SecondaryMeta => {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return { accessibility_notes: raw };
    return {
      accessibility_notes:
        typeof parsed.accessibility_notes === 'string' ? parsed.accessibility_notes : null,
      wifi_speed: typeof parsed.wifi_speed === 'number' ? parsed.wifi_speed : null,
      place_size:
        parsed.place_size === 'small' ||
        parsed.place_size === 'medium' ||
        parsed.place_size === 'large' ||
        parsed.place_size === 'extra_large'
          ? parsed.place_size
          : null,
      kid_friendly: typeof parsed.kid_friendly === 'boolean' ? parsed.kid_friendly : null,
      pet_friendly: typeof parsed.pet_friendly === 'boolean' ? parsed.pet_friendly : null,
      vegan_friendly: typeof parsed.vegan_friendly === 'boolean' ? parsed.vegan_friendly : null,
      vegetarian_friendly: typeof parsed.vegetarian_friendly === 'boolean' ? parsed.vegetarian_friendly : null,
      halal: typeof parsed.halal === 'boolean' ? parsed.halal : null,
      sugar_free_options: typeof parsed.sugar_free_options === 'boolean' ? parsed.sugar_free_options : null,
      gluten_free_options: typeof parsed.gluten_free_options === 'boolean' ? parsed.gluten_free_options : null,
      accommodates_allergies:
        typeof parsed.accommodates_allergies === 'boolean' ? parsed.accommodates_allergies : null
    };
  } catch {
    return { accessibility_notes: raw };
  }
};

export const stringifySecondaryMeta = (input: SecondaryMeta): string | null => {
  const payload: SecondaryMeta = {
    accessibility_notes: input.accessibility_notes ?? null,
    wifi_speed: input.wifi_speed ?? null,
    place_size: input.place_size ?? null,
    kid_friendly: input.kid_friendly ?? null,
    pet_friendly: input.pet_friendly ?? null,
    vegan_friendly: input.vegan_friendly ?? null,
    vegetarian_friendly: input.vegetarian_friendly ?? null,
    halal: input.halal ?? null,
    sugar_free_options: input.sugar_free_options ?? null,
    gluten_free_options: input.gluten_free_options ?? null,
    accommodates_allergies: input.accommodates_allergies ?? null
  };

  const hasValue = Object.values(payload).some((value) => value !== null && value !== undefined && value !== '');
  if (!hasValue) return null;
  return JSON.stringify(payload);
};
