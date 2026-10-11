-- ============================================================================
-- LeadManager / WEPRO CRM — Merge Initial Agent + Meeting Agent into AGENT
-- ----------------------------------------------------------------------------
-- The two front-line roles are now one: an Agent owns a lead from New through
-- Site Visit Done, sets the client meeting on their own lead (no hand-off to a
-- second agent), then forwards to the Team Lead.
--
-- Rewrites the stored role values. The client already reads INITIAL_AGENT /
-- MEETING_AGENT as AGENT (normRole in src/lib/constants.js), so the app works
-- before and after this runs; running it makes server-side filters such as
-- `role=eq.AGENT` see every agent.
--
-- Leads sitting at Meeting Set with a former Meeting Agent stay with that
-- person — they are an Agent now and carry the lead on from there.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

begin;

update public.users
   set role = 'AGENT'
 where role in ('INITIAL_AGENT', 'MEETING_AGENT');

update public.leads
   set assigned_role = 'AGENT'
 where assigned_role in ('INITIAL_AGENT', 'MEETING_AGENT');

-- Monthly targets: an Agent's target is site visits done.
update public.targets
   set type = 'SITE_VISITS'
 where type = 'MEETINGS_SET';

commit;
