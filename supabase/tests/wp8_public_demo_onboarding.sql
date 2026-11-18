-- Run on a disposable database after WP8. All fixtures roll back.
begin;
set local plpgsql.check_asserts = on;

create or replace function public.can_upload_enterprise_policy(p_project_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1 from public.projects p
    join public.organization_employees e on e.organization_id = p.organization_id
    join auth.users u on u.id = e.user_id
    where p.id = p_project_id and e.user_id = auth.uid() and e.is_active
      and e.role in ('manager', 'cxo') and u.email = 'wp8-uploader@example.invalid'
  )
$$;

do $$
declare
  -- Public onboarding targets the seeded DeccanBridge organization ID, not a random organization.
  org uuid := 'c0000000-0000-4000-8000-000000000001'::uuid;
  foreign_org uuid := gen_random_uuid();
  eng_dept uuid := gen_random_uuid();
  hr_dept uuid := gen_random_uuid();
  pm_dept uuid := gen_random_uuid();
  proj_mgmt_dept uuid := gen_random_uuid();
  uiux_dept uuid := gen_random_uuid();
  ops_dept uuid := gen_random_uuid();
  mkt_dept uuid := gen_random_uuid();
  fin_dept uuid := gen_random_uuid();
  foreign_dept uuid := gen_random_uuid();
  eng_recruiter uuid := gen_random_uuid();
  hr_recruiter uuid := gen_random_uuid();
  existing_employee uuid := gen_random_uuid();
  uploader uuid := gen_random_uuid();
  personal_user uuid := gen_random_uuid();
  eng_project uuid := gen_random_uuid();
  hr_project uuid := gen_random_uuid();
  d12_project uuid := gen_random_uuid();
  personal_project uuid := gen_random_uuid();
  company_doc uuid := gen_random_uuid();
  eng_dept_doc uuid := gen_random_uuid();
  hr_dept_doc uuid := gen_random_uuid();
  restricted_doc uuid := gen_random_uuid();
  d12_doc uuid := gen_random_uuid();
  personal_doc uuid := gen_random_uuid();
  onboarded record;
  results uuid[];
  nearest extensions.vector := (array[1::real,0::real] || array_fill(0::real,array[1534]))::extensions.vector;
begin
  insert into auth.users(id, email) values
    (eng_recruiter, 'recruiter-eng@example.invalid'),
    (hr_recruiter, 'recruiter-hr@example.invalid'),
    (existing_employee, 'existing-employee@example.invalid'),
    (uploader, 'wp8-uploader@example.invalid'),
    (personal_user, 'personal-owner@example.invalid');

  insert into public.organizations(id, name) values
    (org, 'DeccanBridge Software'),
    (foreign_org, 'Other organization');

  insert into public.departments(organization_id, id, name) values
    (org, eng_dept, 'Engineering'),
    (org, hr_dept, 'HR'),
    (org, pm_dept, 'Product Management'),
    (org, proj_mgmt_dept, 'Project Management'),
    (org, uiux_dept, 'UI/UX'),
    (org, ops_dept, 'Operations'),
    (org, mkt_dept, 'Marketing'),
    (org, fin_dept, 'Finance'),
    (foreign_org, foreign_dept, 'Engineering');

  insert into public.organization_employees(organization_id, user_id, department_id, role, is_active) values
    (org, existing_employee, eng_dept, 'employee', true),
    (org, uploader, eng_dept, 'manager', true);

  insert into public.projects(id, organization_id, department_id, is_d12, name) values
    (eng_project, org, eng_dept, false, 'Engineering Knowledge Base'),
    (hr_project, org, hr_dept, false, 'HR Knowledge Base'),
    (d12_project, org, eng_dept, true, 'Project D12');

  insert into public.projects(id, user_id, name) values
    (personal_project, personal_user, 'Personal Workspace');

  insert into public.documents(id, project_id, storage_path, status, classification, access_scope, is_published) values
    (company_doc, eng_project, company_doc::text, 'indexed', 'standard', 'company', true),
    (eng_dept_doc, eng_project, eng_dept_doc::text, 'indexed', 'standard', 'department', true),
    (hr_dept_doc, hr_project, hr_dept_doc::text, 'indexed', 'standard', 'department', true),
    (restricted_doc, eng_project, restricted_doc::text, 'indexed', 'restricted', 'department', true),
    (d12_doc, d12_project, d12_doc::text, 'indexed', 'standard', 'department', true),
    (personal_doc, personal_project, personal_doc::text, 'indexed', 'restricted', 'department', false);

  insert into public.document_chunks(id, document_id, project_id, content, embedding) values
    (company_doc, company_doc, eng_project, 'Company-wide policy evidence', nearest),
    (eng_dept_doc, eng_dept_doc, eng_project, 'Engineering department policy evidence', nearest),
    (hr_dept_doc, hr_dept_doc, hr_project, 'HR department policy evidence', nearest),
    (restricted_doc, restricted_doc, eng_project, 'Restricted compensation policy evidence', nearest),
    (d12_doc, d12_doc, d12_project, 'D12 launch playbook evidence', nearest),
    (personal_doc, personal_doc, personal_project, 'Personal RAG evidence', nearest);

  assert not has_function_privilege('anon', 'public.onboard_demo_employee(text)', 'EXECUTE');

  -- 1. Recruiter signs up and selects Engineering.
  set local role authenticated;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', eng_recruiter)::text, true);
  select * into onboarded from public.onboard_demo_employee('Engineering');
  assert onboarded.organization_id = org and onboarded.department_id = eng_dept and onboarded.role = 'employee',
    'Engineering onboarding did not assign the expected employee scope';
  assert exists (select from public.enterprise_copilot_context(null) where organization_id = org and not can_upload_policy);

  -- Idempotent retry with the same department succeeds without duplicating records.
  select * into onboarded from public.onboard_demo_employee('Engineering');
  assert onboarded.department_id = eng_dept and onboarded.role = 'employee';

  -- 2 & 3. Engineering recruiter retrieves Engineering Standard and company-wide policies, not HR-only, Restricted or D12.
  select array_agg(id) into results from public.search_enterprise_chunks(nearest, 'policy', org);
  assert results @> array[company_doc, eng_dept_doc] and cardinality(results) = 2,
    'Engineering recruiter did not receive exact Engineering + company-wide standard access';
  assert public.enterprise_chunks_still_visible(org, array[company_doc, eng_dept_doc])
    and not public.enterprise_chunks_still_visible(org, array[hr_dept_doc])
    and not public.enterprise_chunks_still_visible(org, array[restricted_doc])
    and not public.enterprise_chunks_still_visible(org, array[d12_doc])
    and not public.enterprise_chunks_still_visible(org, array[personal_doc]);

  -- 4 & 5. HR signup receives HR Standard and company-wide access, not Engineering-only, Restricted or D12.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', hr_recruiter)::text, true);
  select * into onboarded from public.onboard_demo_employee('HR');
  assert onboarded.organization_id = org and onboarded.department_id = hr_dept and onboarded.role = 'employee';
  select array_agg(id) into results from public.search_enterprise_chunks(nearest, 'policy', org);
  assert results @> array[company_doc, hr_dept_doc] and cardinality(results) = 2,
    'HR recruiter did not receive exact HR + company-wide standard access';
  assert public.enterprise_chunks_still_visible(org, array[company_doc, hr_dept_doc])
    and not public.enterprise_chunks_still_visible(org, array[eng_dept_doc])
    and not public.enterprise_chunks_still_visible(org, array[restricted_doc])
    and not public.enterprise_chunks_still_visible(org, array[d12_doc]);

  -- 6. Public users cannot change department, promote themselves, issue grants, or obtain uploader privileges.
  begin
    perform public.onboard_demo_employee('Engineering');
    raise exception 'Department change should have been denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.onboard_demo_employee(foreign_dept::text);
    raise exception 'Foreign department should have been denied';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.organization_employees set role = 'manager' where user_id = hr_recruiter;
    raise exception 'Direct role promotion should have been denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.issue_document_grant(restricted_doc, eng_recruiter, statement_timestamp() + interval '1 hour');
    raise exception 'Employee grant issuance should have been denied';
  exception when insufficient_privilege then null;
  end;
  assert not exists (select from public.enterprise_policy_departments(org));

  -- 7. Existing employees, uploader, and Personal RAG remain unaffected.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uploader)::text, true);
  assert exists (select from public.enterprise_copilot_context(org) where can_upload_policy)
    and (select count(*) from public.enterprise_policy_departments(org)) = 8;
  begin
    perform public.onboard_demo_employee('HR');
    raise exception 'Manager onboarding override should have been denied';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', existing_employee)::text, true);
  assert exists (select from public.search_enterprise_chunks(nearest, 'policy', org) where id = eng_dept_doc);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', personal_user)::text, true);
  assert not exists (select from public.enterprise_copilot_context(null));
  assert exists (select from public.search_rag_chunks(nearest, 'Personal', personal_project) where id = personal_doc);

  reset role;
  assert not exists (select from public.document_grants where user_id in (eng_recruiter, hr_recruiter))
    and not exists (select from public.project_memberships where user_id in (eng_recruiter, hr_recruiter));
end
$$;

rollback;

