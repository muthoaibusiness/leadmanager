// Seed data — intentionally EMPTY. No dummy users, teams, companies or
// properties ship with the app. A fresh/empty database is bootstrapped with a
// single Master Admin account by migrateTenancy() in db.js
// (master@wepro.com / 1234) — log in as master to create the first company and
// its admin. Real data lives in Supabase.
//
// These exports are kept (as empty arrays) so existing imports keep working.

export const SEED_COMPANIES = [];
export const SEED_TEAMS = [];
export const SEED_USERS = [];
export const SEED_PROPERTIES = [];
export const DEMO_PROPERTIES = [];

export function seedDB() {
  return {
    companies: [],
    users: [],
    teams: [],
    leads: [],
    targets: [],
    activities: {},
    notifications: {},
    properties: [],
    bookings: [],
  };
}
