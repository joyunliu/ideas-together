alter table public.events
  drop constraint events_title_check,
  add constraint events_title_check check (char_length(title) <= 50) not valid;
