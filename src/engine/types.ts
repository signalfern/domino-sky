/** Raw dataset shapes (as provided by the organisers). */
export type Tier = 'mega_hub' | 'regional_hub' | 'spoke';

export interface Airport {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  tier: Tier;
  capacity_per_hour: number;
}

export interface Flight {
  flight_id: string;
  tail_id: string;
  leg_order: number;
  origin: string;
  destination: string;
  dep: string;
  arr: string;
  block_minutes: number;
  pax: number;
  turnaround_before_min: number | null;
}

export interface Connection {
  connection_id: string;
  airport: string;
  from_flight: string;
  to_flight: string;
  passengers: number;
  min_connect_minutes: number;
}

export interface Crew {
  crew_id: string;
  tail_id: string;
  base: string;
  duty_start: string;
  max_duty_mins: number;
  flight_ids: string[];
}

export interface Spare {
  tail_id: string;
  base: string;
  available_from: string;
  seats: number;
}

export interface Network {
  meta: { min_turnaround_minutes: number; seats_per_aircraft: number; [k: string]: unknown };
  airports: Airport[];
  flights: Flight[];
  connections: Connection[];
  crews: Crew[];
  spare_aircraft: Spare[];
}

/** Scenario inputs. Times are minutes from 00:00 IST. */
export interface Closure {
  id: string;
  airport: string;
  start: number;
  end: number;
}

export type Action =
  | { kind: 'cancel'; flightId: string }
  | { kind: 'swap'; spareId: string; flightId: string }
  | { kind: 'hold'; connectionId: string };

export interface Scenario {
  closures: Closure[];
  actions: Action[];
}

/** Why a flight departs later than scheduled (the binding constraint). */
export type Cause =
  | { kind: 'origin_closed'; airport: string; until: number; closureId: string }
  | { kind: 'dest_closed'; airport: string; until: number; closureId: string }
  | { kind: 'late_aircraft'; prevFlightId: string; readyAt: number }
  | { kind: 'held_for_connection'; connectionId: string; readyAt: number }
  | { kind: 'spare_ready'; spareId: string; readyAt: number };

export type CancelReason = 'user' | 'aircraft_out_of_position' | 'crew_timeout';

export interface FlightResult {
  id: string;
  tail: string; // aircraft that operates (or would operate) the flight
  plannedTail: string;
  crewId: string;
  origin: string;
  destination: string;
  pax: number;
  block: number;
  schedDep: number;
  schedArr: number;
  dep: number; // simulated (for cancelled flights: the time it would have left)
  arr: number;
  delay: number;
  cancelled: boolean;
  cancelReason?: CancelReason;
  cause?: Cause;
  parentId?: string; // previous domino in the chain
  rootClosureId?: string;
  depth: number; // domino generation: 1 = hit directly by a closure
}

export type ConnStatus = 'ok' | 'missed' | 'cancelled';

export interface ConnResult {
  id: string;
  airport: string;
  from: string;
  to: string;
  pax: number;
  gap: number | null;
  min: number;
  schedGap: number;
  status: ConnStatus;
}

export interface CrewResult {
  id: string;
  tail: string;
  base: string;
  dutyStart: number;
  dutyEnd: number;
  duty: number;
  max: number;
  timedOut: string[];
  standby: boolean;
}

export interface Metrics {
  lateFlights: number;
  delayedPax: number;
  totalDelayMin: number;
  paxDelayMin: number;
  maxDelay: number;
  cancelledFlights: number;
  strandedPax: number;
  strandedFromCancel: number;
  strandedFromConnections: number;
  brokenConnections: number;
  crewTimeouts: number;
  affectedAircraft: number;
  sparesUsed: number;
  cost: number;
}

export interface CapacityRow {
  airport: string;
  hour: number;
  movements: number;
  cap: number;
}

export interface SimResult {
  flights: Record<string, FlightResult>;
  flightOrder: string[];
  connections: ConnResult[];
  crews: CrewResult[];
  metrics: Metrics;
  overCapacity: CapacityRow[];
  peakMovements: Record<string, number>;
  closures: Closure[];
  warnings: string[];
}
