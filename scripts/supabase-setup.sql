-- PeoplePulse Supabase Setup Script
-- This script enables Row Level Security (RLS) and sets up isolation policies.

-- 1. Enable RLS on all core tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplinary ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;

-- 2. Create Isolation Policies (Multi-Tenancy)
-- We use a custom JWT claim 'org_id' (set via Clerk sync) for tenant isolation.

CREATE POLICY org_isolation ON organizations
  FOR ALL USING (id = (auth.jwt() ->> 'org_id')::text);

CREATE POLICY branch_isolation ON branches
  FOR ALL USING (org_id = (auth.jwt() ->> 'org_id')::text);

CREATE POLICY employee_isolation ON employees
  FOR ALL USING (org_id = (auth.jwt() ->> 'org_id')::text);

CREATE POLICY pay_component_isolation ON pay_components
  FOR ALL USING (org_id = (auth.jwt() ->> 'org_id')::text);

CREATE POLICY payroll_run_isolation ON payroll_runs
  FOR ALL USING (org_id = (auth.jwt() ->> 'org_id')::text);

CREATE POLICY payroll_line_isolation ON payroll_lines
  FOR ALL USING (
    employee_id IN (
      SELECT id FROM employees WHERE org_id = (auth.jwt() ->> 'org_id')::text
    )
  );

CREATE POLICY leave_policy_isolation ON leave_policies
  FOR ALL USING (org_id = (auth.jwt() ->> 'org_id')::text);

CREATE POLICY leave_request_isolation ON leave_requests
  FOR ALL USING (
    employee_id IN (
      SELECT id FROM employees WHERE org_id = (auth.jwt() ->> 'org_id')::text
    )
  );

CREATE POLICY disciplinary_isolation ON disciplinary
  FOR ALL USING (
    employee_id IN (
      SELECT id FROM employees WHERE org_id = (auth.jwt() ->> 'org_id')::text
    )
  );

CREATE POLICY ai_conversation_isolation ON ai_conversations
  FOR ALL USING (org_id = (auth.jwt() ->> 'org_id')::text);

-- 3. Global Data (Countries & Tax Bands) - Read-only for authenticated users
ALTER TABLE countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_bands ENABLE ROW LEVEL SECURITY;

CREATE POLICY countries_read_policy ON countries
  FOR SELECT TO authenticated USING (true);

CREATE POLICY tax_bands_read_policy ON tax_bands
  FOR SELECT TO authenticated USING (true);

-- 4. Initial Seed Data (Botswana)
INSERT INTO countries (id, name, currency_code, paye_table, financial_year_start, min_wage, leave_defaults)
VALUES (
  'bw-id', 
  'Botswana', 
  'BWP', 
  '{}', 
  '07-01', 
  7.34, 
  '{"annual": 15, "sick": 14, "maternity": 98, "paternity": 3}'
) ON CONFLICT DO NOTHING;
