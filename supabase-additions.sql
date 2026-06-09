-- Tabela de pacientes cadastrados
create table patients (
  id bigint generated always as identity primary key,
  name text not null,
  phone text,
  email text,
  birth_date date,
  condition text,
  notes text,
  created_at timestamptz default now()
);

-- Tabela de agendamentos
create table appointments (
  id bigint generated always as identity primary key,
  patient_id bigint references patients(id) on delete set null,
  patient_name text not null,
  appointment_date date not null,
  appointment_time time not null,
  type text not null,
  duration_minutes int default 60,
  status text default 'agendado',
  notes text,
  created_at timestamptz default now()
);

-- Índices para performance
create index idx_appointments_date    on appointments(appointment_date);
create index idx_appointments_patient on appointments(patient_id);
create index idx_patients_name        on patients(name);
