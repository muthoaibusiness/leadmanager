-- Which WECON office serves a project. The WhatsApp bot gives this address
-- when a customer interested in the project asks where to come / where the
-- office is, instead of a company-wide list.
alter table wa_projects add column if not exists office_address text;

update wa_projects set office_address = 'House 5A, Road 25A, Dhaka 1212'
  where region = 'Dhaka' and office_address is null;
update wa_projects set office_address = '687 Mehedibag, Chattogram 4203'
  where region = 'Chattogram' and office_address is null;
