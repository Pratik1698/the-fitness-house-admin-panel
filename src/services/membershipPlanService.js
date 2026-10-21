import { supabase, isSupabaseConfigured } from './supabaseClient';

/**
 * Membership Plan Service
 * The Fitness House Gym Management Admin Panel
 *
 * Provides typed, structured methods for querying active membership plans
 * from PostgreSQL (public.membership_plans) via Supabase client.
 */

/**
 * Fetches all active membership plans from public.membership_plans, ordered by duration_days ascending.
 * Normalizes database column names (duration_days -> duration, duration_days) and ensures numeric price.
 *
 * @returns {Promise<{ data: Array<{ id: string, name: string, duration: number, duration_days: number, price: number, description: string, is_active: boolean }> | null, error: Error | null }>}
 */
export async function getActiveMembershipPlans() {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
    };
  }

  try {
    const { data, error } = await supabase
      .from('membership_plans')
      .select('id, name, duration_days, price, description, is_active, created_at, updated_at')
      .eq('is_active', true)
      .order('duration_days', { ascending: true });

    if (error) {
      console.error('[membershipPlanService] Database error fetching plans:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to fetch membership plans from database.'),
      };
    }

    if (!data) {
      return { data: [], error: null };
    }

    // Normalize records for frontend consumption
    // Preserves database UUIDs and provides both duration and duration_days for full backward-compatibility
    const normalized = data.map((plan) => ({
      id: plan.id,
      name: plan.name,
      duration: Number(plan.duration_days) || 0,
      duration_days: Number(plan.duration_days) || 0,
      price: Number(plan.price) || 0,
      description: plan.description || '',
      is_active: Boolean(plan.is_active),
      created_at: plan.created_at,
      updated_at: plan.updated_at,
    }));

    return { data: normalized, error: null };
  } catch (err) {
    console.error('[membershipPlanService] Unexpected error:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
