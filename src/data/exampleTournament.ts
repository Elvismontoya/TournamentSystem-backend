// Seed data: the table tennis sample tournament the frontend shows ("Open Nacional 2026").
// Loaded into the in-memory repository at startup; later it becomes a database seeder.

import { DEFAULT_GROUP_SIZE, DEFAULT_RULES } from '../domain/groupStage.ts';
import type { Player } from '../domain/players.ts';
import type { TournamentSettings } from '../models/tournament.ts';

/** Listed by ranking; `bib` is the registration number (Nr.), independent of ranking. */
export const EXAMPLE_PLAYERS: Player[] = [
  { id: 'p01', bib: 7, name: 'Carlos Silva', delegation: 'Club Universitario', ranking: 2150 },
  { id: 'p02', bib: 12, name: 'Marcos Ruiz', delegation: 'TM Los Andes', ranking: 2080 },
  { id: 'p03', bib: 3, name: 'Andrés Peña', delegation: 'Club Central', ranking: 1990 },
  { id: 'p04', bib: 15, name: 'Diego Rojas', delegation: 'Club Universitario', ranking: 1945 },
  { id: 'p05', bib: 1, name: 'Javier Morales', delegation: 'Academia Spin', ranking: 1890 },
  { id: 'p06', bib: 9, name: 'Luis Herrera', delegation: 'TM Los Andes', ranking: 1860 },
  { id: 'p07', bib: 4, name: 'Sebastián Castro', delegation: 'Club Central', ranking: 1820 },
  { id: 'p08', bib: 11, name: 'Mateo Vargas', delegation: 'Academia Spin', ranking: 1795 },
  { id: 'p09', bib: 14, name: 'Nicolás Torres', delegation: 'Liga del Valle', ranking: 1740 },
  { id: 'p10', bib: 2, name: 'Felipe Ortiz', delegation: 'Club Universitario', ranking: 1702 },
  { id: 'p11', bib: 16, name: 'Tomás Díaz', delegation: 'Liga del Valle', ranking: 1650 },
  { id: 'p12', bib: 5, name: 'Julián Mejía', delegation: 'Club Central', ranking: 1620 },
  { id: 'p13', bib: 10, name: 'Ricardo Salas', delegation: 'TM Los Andes', ranking: 1580 },
  { id: 'p14', bib: 6, name: 'Pablo Navarro', delegation: 'Academia Spin', ranking: 1540 },
  { id: 'p15', bib: 13, name: 'Esteban Ríos', delegation: 'Liga del Valle', ranking: 1500 },
  { id: 'p16', bib: 8, name: 'Gabriel Ramos', delegation: 'Academia Spin', ranking: null },
];

export const EXAMPLE_SETTINGS: TournamentSettings = {
  sport: 'Tenis de mesa',
  format: 'Grupos + eliminación',
  modalities: ['Individual'],
  categories: ['Mayores (Libre)'],
  startDate: '2026-11-15',
  endDate: '2026-11-16',
  location: 'Coliseo Central',
  defaultGroupSize: DEFAULT_GROUP_SIZE,
  qualifiersPerGroup: 2,
  seeded: true,
  groupRules: DEFAULT_RULES,
  knockoutSetsPerMatch: 5,
  thirdPlaceMatch: false,
};

export const EXAMPLE_TOURNAMENT = {
  id: 'open-nacional-2026',
  name: 'Open Nacional 2026',
} as const;
