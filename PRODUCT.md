# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Confirmed by the user: Svelte 5 + Vite on the frontend, Bun (`Bun.serve`) on the backend with Supabase (Postgres) as the database, accessed only by the server, GSAP for motion. Deployed on Vercel (static frontend plus a Bun function for `/api`).

## Users

- **Equipes de campo** (utility crews) and their supervisors. They are the subjects of the blitz; the blitz is registered by an inspector who stands in front of the crew, on a phone.
- **Gestão de segurança do trabalho** (SESMT and management). They consult the required material list per team type and read the monthly dashboard, usually on a desktop.

## Product Purpose

Give one reference for safety equipment (EPI and EPC) required by each type of crew, and let anyone record a static blitz: check each required item as OK, Não OK or Faltante. The monthly dashboard turns those records into a list of adequacy needs: blitz count, share of conforming teams, participation ranking and the items that most often fail.

Success means: a blitz can be completed in the field without ambiguity, and the adequacy list reflects what was actually found on site.

## Positioning

The material list is the official reference sheet (`Estrutura de referencia cgb 2026`), with quantities per team type. The blitz checklist is generated from that same list, so the inspection and the requirement never diverge.

## Operating Context

- Blitzes happen in the field, on a phone, standing next to the crew.
- The material reference lives in a spreadsheet and is validated internally before general release.
- Monthly review happens on a desktop, by management.
- Processes that run blitzes: GSTC, GOMAN, GERE (the full list is still open; see Capabilities and Constraints).

## Capabilities and Constraints

- Admin panel areas: Dashboard (monthly summary and rankings), Blitzes (history and detail per collaborator; read-only plus delete), Controle (open Troca/Faltante until resolved), Materiais (EPI/EPC per team type), Equipes (team registry). A blitz is registered only in the field app (`/campo/`), which also runs in a desktop browser.
- Each team type has its own list of applicable items, taken from the reference quantities; items with quantity zero are not part of that team's blitz.
- A blitz must answer every applicable item before it can be saved. The inspector may limit a blitz to EPI only or EPC only; then only that group is required and recorded, and the admin panel labels the blitz as partial.
- Data is stored in Supabase (Postgres), reached only by the server with the service key. Access requires a login; users are created by the team through the terminal (`bun run usuario:criar`). Three profiles, enforced by the server: Proprietário (everything, including the Usuários page; only the owner), Administrador (everything except Usuários) and Usuário (read-only).
- Terminology to keep: EPI, EPC, blitz estática, equipe, prefixo, processo, adequação.
- Undecided: the full list of processes (only GSTC, GOMAN and GERE are known); whether there will be access control.

## Brand Commitments

None beyond the name. "PAES" stands for **Programa de Acompanhamento de Equipamento de Segurança** (renamed from "CEM · Consulta de Equipamentos e Materiais" at the user's request) and is shown in the header as that full name. The user chose to create the visual identity itself.

## Evidence on Hand

- Material reference: `C:\Users\Italo\Downloads\Estrutura de referencia cgb 2026.xlsx` (224 items, 11 team types).
- Requirements summary from the team's chat: material list per team type, blitz with process/prefix/crew/date, monthly dashboard with rankings.
- Absent: logo files, brand manual, real blitz records, photos of field use. Do not invent any of them.

## Product Principles

- Every item in a blitz has an explicit situation. Nothing is assumed OK by omission.
- The dashboard only counts what was registered; a number must be traceable to a blitz.
- The material list starts as the reference spreadsheet (`Estrutura de referencia cgb 2026`) and is edited by administrators in the Materiais area (add, edit, remove). Removing only deactivates an item, so past blitzes and pendências keep their history.
- Field registration comes first: fewer steps and fewer decisions per item than any reading or reporting task.
