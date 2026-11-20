import { toMin } from './time';
import type {
  Action, Cause, CancelReason, Closure, ConnResult, CrewResult, FlightResult, Metrics,
  Network, Scenario, SimResult, CapacityRow, Flight, Crew, Spare,
} from './types';

/** Passenger-minutes charged per stranded passenger in the plan cost. */
export const STRANDED_WEIGHT = 180;
/** Standby crew for a spare aircraft reports this long before its first departure. */
export const SPARE_REPORT_LEAD = 45;
export const SPARE_MAX_DUTY = 600;

interface Index {
  flights: Map<string, Flight>;
  chains: Map<string, Flight[]>; // tail → legs in leg_order
  tails: string[];
  crewOf: Map<string, Crew>; // flight id → crew
  spares: Map<string, Spare>;
  airports: Set<string>;
  capacity: Map<string, number>;
  turnaround: number;
}

const cache = new WeakMap<Network, Index>();

export function indexNetwork(net: Network): Index {
  const hit = cache.get(net);
  if (hit) return hit;
  const flights = new Map(net.flights.map((f) => [f.flight_id, f]));
  const chains = new Map<string, Flight[]>();
  for (const f of net.flights) {
    const list = chains.get(f.tail_id) ?? [];
    list.push(f);
    chains.set(f.tail_id, list);
  }
  for (const list of chains.values()) list.sort((a, b) => a.leg_order - b.leg_order);
  const crewOf = new Map<string, Crew>();
  for (const c of net.crews) for (const id of c.flight_ids) crewOf.set(id, c);
  const idx: Index = {
    flights,
    chains,
    tails: [...chains.keys()].sort(),
    crewOf,
    spares: new Map(net.spare_aircraft.map((s) => [s.tail_id, s])),
    airports: new Set(net.airports.map((a) => a.id)),
    capacity: new Map(net.airports.map((a) => [a.id, a.capacity_per_hour])),
    turnaround: net.meta.min_turnaround_minutes,
  };
  cache.set(net, idx);
  return idx;
}

/** Keep only closures that are well formed and name a real airport. */
export function cleanClosures(net: Network, closures: Closure[]): Closure[] {
  const idx = indexNetwork(net);
  return closures.filter((c) => idx.airports.has(c.airport) && c.end > c.start);
}

interface Leg {
  dep: number;
  arr: number;
  cause?: Cause;
}

/** Push a departure out of every closure window it touches (origin departures and destination arrivals). */
function applyClosures(f: Flight, start: number, startCause: Cause | undefined, closures: Closure[]): Leg {
  let dep = start;
  let cause = startCause;
  const block = f.block_minutes;
  for (let guard = 0; guard < 50; guard++) {
    let moved = false;
    for (const c of closures) {
      if (c.airport === f.origin && dep >= c.start && dep < c.end) {
        dep = c.end;
        cause = { kind: 'origin_closed', airport: c.airport, until: c.end, closureId: c.id };
        moved = true;
      }
      const arr = dep + block;
      if (c.airport === f.destination && arr >= c.start && arr < c.end) {
        dep = c.end - block;
        cause = { kind: 'dest_closed', airport: c.airport, until: c.end, closureId: c.id };
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { dep, arr: dep + block, cause };
}

interface ActionSets {
  cancels: Set<string>;
  swaps: Map<string, string>; // flight id → spare id
  holds: Map<string, string[]>; // to-flight id → connection ids
  warnings: string[];
}

function resolveActions(net: Network, idx: Index, actions: Action[]): ActionSets {
  const cancels = new Set<string>();
  const swaps = new Map<string, string>();
  const holds = new Map<string, string[]>();
  const warnings: string[] = [];
  const usedSpares = new Set<string>();
  const conns = new Map(net.connections.map((c) => [c.connection_id, c]));
  for (const a of actions) {
    if (a.kind === 'cancel') {
      if (idx.flights.has(a.flightId)) cancels.add(a.flightId);
      else warnings.push(`Unknown flight ${a.flightId}`);
    }
  }
  for (const a of actions) {
    if (a.kind === 'swap') {
      const s = idx.spares.get(a.spareId);
      const f = idx.flights.get(a.flightId);
      if (!s || !f) warnings.push(`Invalid swap ${a.spareId} → ${a.flightId}`);
      else if (usedSpares.has(s.tail_id)) warnings.push(`${s.tail_id} is already used`);
      else if (f.origin !== s.base) warnings.push(`${s.tail_id} is based at ${s.base}, ${f.flight_id} leaves ${f.origin}`);
      else if (cancels.has(f.flight_id)) warnings.push(`${f.flight_id} is cancelled, spare not needed`);
      else if (swaps.has(f.flight_id)) warnings.push(`${f.flight_id} already has a spare`);
      else {
        swaps.set(f.flight_id, s.tail_id);
        usedSpares.add(s.tail_id);
      }
    } else if (a.kind === 'hold') {
      const c = conns.get(a.connectionId);
      if (!c) warnings.push(`Unknown connection ${a.connectionId}`);
      else holds.set(c.to_flight, [...(holds.get(c.to_flight) ?? []), c.connection_id]);
    }
  }
  return { cancels, swaps, holds, warnings };
}

/**
 * Deterministic network simulation.
 * Rules: closures block departures and arrivals; each aircraft flies its legs in order with the minimum
 * turnaround; a crew cannot land after its duty limit (that leg and the rest are cancelled); a cancelled
 * leg leaves the aircraft at its origin, so legs that start elsewhere are cancelled too.
 */
export function simulate(net: Network, sc: Scenario): SimResult {
  const idx = indexNetwork(net);
  const closures = cleanClosures(net, sc.closures);
  const acts = resolveActions(net, idx, sc.actions);
  const conns = net.connections;
  const connById = new Map(conns.map((c) => [c.connection_id, c]));

  let out = new Map<string, FlightResult>();
  let prevArr = new Map<string, number>();
  let prevCancelled = new Set<string>();
  const standby: CrewResult[] = [];

  for (let pass = 0; pass < 12; pass++) {
    out = new Map();
    standby.length = 0;
    for (const tail of idx.tails) {
      const legs = idx.chains.get(tail)!;
      let position = legs[0].origin;
      let lastArr: number | null = null;
      let lastId: string | null = null;
      let aircraft = tail;
      let crew = { id: idx.crewOf.get(legs[0].flight_id)!.crew_id, start: toMin(idx.crewOf.get(legs[0].flight_id)!.duty_start), max: idx.crewOf.get(legs[0].flight_id)!.max_duty_mins };
      let crewOut = false;
      let readyAt: number | null = null;
      let readyCause: Cause | undefined;
      let standbyCrew: CrewResult | null = null;

      for (const f of legs) {
        const schedDep = toMin(f.dep);
        const schedArr = toMin(f.arr);
        const base: FlightResult = {
          id: f.flight_id, tail: aircraft, plannedTail: tail, crewId: crew.id, origin: f.origin,
          destination: f.destination, pax: f.pax, block: f.block_minutes, schedDep, schedArr,
          dep: schedDep, arr: schedArr, delay: 0, cancelled: false, depth: 0,
        };

        const spareId = acts.swaps.get(f.flight_id);
        if (spareId) {
          const s = idx.spares.get(spareId)!;
          aircraft = s.tail_id;
          position = s.base;
          lastArr = null;
          lastId = null;
          crewOut = false;
          readyAt = toMin(s.available_from);
          readyCause = { kind: 'spare_ready', spareId: s.tail_id, readyAt };
          standbyCrew = {
            id: `SB-${s.tail_id}`, tail: s.tail_id, base: s.base, dutyStart: 0, dutyEnd: 0, duty: 0,
            max: SPARE_MAX_DUTY, timedOut: [], standby: true,
          };
          standby.push(standbyCrew);
          crew = { id: standbyCrew.id, start: Number.NaN, max: SPARE_MAX_DUTY };
          base.tail = aircraft;
          base.crewId = crew.id;
        }

        if (acts.cancels.has(f.flight_id)) {
          out.set(f.flight_id, { ...base, cancelled: true, cancelReason: 'user' });
          lastId = f.flight_id;
          continue;
        }
        if (crewOut) {
          out.set(f.flight_id, { ...base, cancelled: true, cancelReason: 'crew_timeout', parentId: lastId ?? undefined });
          lastId = f.flight_id;
          continue;
        }
        if (position !== f.origin) {
          out.set(f.flight_id, { ...base, cancelled: true, cancelReason: 'aircraft_out_of_position', parentId: lastId ?? undefined });
          lastId = f.flight_id;
          continue;
        }

        // Earliest departure from aircraft readiness and passenger holds.
        let dep = schedDep;
        let cause: Cause | undefined;
        if (lastArr !== null && lastArr + idx.turnaround > dep) {
          dep = lastArr + idx.turnaround;
          cause = { kind: 'late_aircraft', prevFlightId: lastId!, readyAt: dep };
        }
        if (readyAt !== null && readyAt > dep) {
          dep = readyAt;
          cause = readyCause;
        }
        for (const cid of acts.holds.get(f.flight_id) ?? []) {
          const c = connById.get(cid)!;
          if (prevCancelled.has(c.from_flight)) continue;
          const fromArr = prevArr.get(c.from_flight) ?? toMin(idx.flights.get(c.from_flight)!.arr);
          const need = fromArr + c.min_connect_minutes;
          if (need > dep) {
            dep = need;
            cause = { kind: 'held_for_connection', connectionId: cid, readyAt: need };
          }
        }
        const leg = applyClosures(f, dep, cause, closures);
        readyAt = null;

        if (Number.isNaN(crew.start)) crew.start = leg.dep - SPARE_REPORT_LEAD;
        const legal = leg.arr - crew.start <= crew.max;
        const parentId = leg.cause?.kind === 'late_aircraft' ? leg.cause.prevFlightId : undefined;
        const res: FlightResult = {
          ...base, dep: leg.dep, arr: leg.arr, delay: leg.dep - schedDep, cause: leg.dep > schedDep ? leg.cause : undefined,
          parentId,
        };
        if (!legal) {
          out.set(f.flight_id, { ...res, cancelled: true, cancelReason: 'crew_timeout' });
          crewOut = true;
          lastId = f.flight_id;
          continue;
        }
        out.set(f.flight_id, res);
        position = f.destination;
        lastArr = leg.arr;
        lastId = f.flight_id;
        if (standbyCrew) {
          standbyCrew.dutyStart = crew.start;
          standbyCrew.dutyEnd = leg.arr;
          standbyCrew.duty = leg.arr - crew.start;
        }
      }
    }
    // Holds couple aircraft chains; repeat until every arrival is stable.
    const arrNow = new Map([...out.values()].map((r) => [r.id, r.arr]));
    const cancNow = new Set([...out.values()].filter((r) => r.cancelled).map((r) => r.id));
    const stable = acts.holds.size === 0 || (pass > 0 && [...arrNow].every(([k, v]) => prevArr.get(k) === v) && cancNow.size === prevCancelled.size);
    prevArr = arrNow;
    prevCancelled = cancNow;
    if (stable) break;
  }

  // Held-for-connection parent = the feeding flight.
  for (const r of out.values()) {
    if (r.cause?.kind === 'held_for_connection') r.parentId = connById.get(r.cause.connectionId)!.from_flight;
  }
  // Domino depth and root closure.
  const seen = new Set<string>();
  const resolve = (r: FlightResult): void => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    if (r.cause && (r.cause.kind === 'origin_closed' || r.cause.kind === 'dest_closed')) {
      r.rootClosureId = r.cause.closureId;
      r.depth = 1;
      return;
    }
    const p = r.parentId ? out.get(r.parentId) : undefined;
    if (p && (r.delay > 0 || r.cancelled)) {
      resolve(p);
      r.rootClosureId = p.rootClosureId;
      r.depth = p.depth > 0 ? p.depth + 1 : 0;
    }
  };
  for (const r of out.values()) resolve(r);

  const flightOrder = [...out.values()].sort((a, b) => a.schedDep - b.schedDep || a.id.localeCompare(b.id)).map((r) => r.id);
  const flights = Object.fromEntries(out);

  const connections: ConnResult[] = conns.map((c) => {
    const a = out.get(c.from_flight)!;
    const b = out.get(c.to_flight)!;
    const schedGap = b.schedDep - a.schedArr;
    if (a.cancelled || b.cancelled) {
      return { id: c.connection_id, airport: c.airport, from: a.id, to: b.id, pax: c.passengers, gap: null, min: c.min_connect_minutes, schedGap, status: 'cancelled' };
    }
    const gap = b.dep - a.arr;
    return {
      id: c.connection_id, airport: c.airport, from: a.id, to: b.id, pax: c.passengers, gap, min: c.min_connect_minutes,
      schedGap, status: gap >= c.min_connect_minutes ? 'ok' : 'missed',
    };
  });

  const crews: CrewResult[] = net.crews.map((c) => {
    const own = c.flight_ids.map((id) => out.get(id)!).filter((r) => r.crewId === c.crew_id);
    const flown = own.filter((r) => !r.cancelled);
    const start = toMin(c.duty_start);
    const end = flown.length ? flown[flown.length - 1].arr : start;
    return {
      id: c.crew_id, tail: c.tail_id, base: c.base, dutyStart: start, dutyEnd: end, duty: end - start,
      max: c.max_duty_mins, standby: false,
      timedOut: own.filter((r) => r.cancelReason === 'crew_timeout').map((r) => r.id),
    };
  });
  for (const s of standby) {
    s.timedOut = [...out.values()].filter((r) => r.crewId === s.id && r.cancelReason === 'crew_timeout').map((r) => r.id);
    crews.push(s);
  }

  // Hourly movements per airport (operated flights only).
  const mov = new Map<string, number>();
  for (const r of out.values()) {
    if (r.cancelled) continue;
    const k1 = `${r.origin}|${Math.floor(r.dep / 60)}`;
    const k2 = `${r.destination}|${Math.floor(r.arr / 60)}`;
    mov.set(k1, (mov.get(k1) ?? 0) + 1);
    mov.set(k2, (mov.get(k2) ?? 0) + 1);
  }
  const overCapacity: CapacityRow[] = [];
  const peakMovements: Record<string, number> = {};
  for (const [k, n] of mov) {
    const [airport, hour] = k.split('|');
    peakMovements[airport] = Math.max(peakMovements[airport] ?? 0, n);
    const cap = idx.capacity.get(airport)!;
    if (n > cap) overCapacity.push({ airport, hour: Number(hour), movements: n, cap });
  }

  const metrics = computeMetrics([...out.values()], connections, crews, acts.swaps.size);
  return { flights, flightOrder, connections, crews, metrics, overCapacity, peakMovements, closures, warnings: acts.warnings };
}

export function computeMetrics(rs: FlightResult[], connections: ConnResult[], crews: CrewResult[], sparesUsed: number): Metrics {
  let lateFlights = 0, delayedPax = 0, totalDelayMin = 0, paxDelayMin = 0, maxDelay = 0, cancelledFlights = 0, strandedFromCancel = 0;
  const affected = new Set<string>();
  for (const r of rs) {
    if (r.cancelled) {
      cancelledFlights++;
      strandedFromCancel += r.pax;
      affected.add(r.plannedTail);
    } else if (r.delay > 0) {
      lateFlights++;
      delayedPax += r.pax;
      totalDelayMin += r.delay;
      paxDelayMin += r.delay * r.pax;
      maxDelay = Math.max(maxDelay, r.delay);
      affected.add(r.plannedTail);
    }
  }
  const strandedFromConnections = connections.filter((c) => c.status === 'missed').reduce((s, c) => s + c.pax, 0);
  const strandedPax = strandedFromCancel + strandedFromConnections;
  return {
    lateFlights, delayedPax, totalDelayMin, paxDelayMin, maxDelay, cancelledFlights, strandedPax, strandedFromCancel,
    strandedFromConnections, brokenConnections: connections.filter((c) => c.status !== 'ok').length,
    crewTimeouts: crews.filter((c) => c.timedOut.length > 0).length, affectedAircraft: affected.size, sparesUsed,
    cost: paxDelayMin + STRANDED_WEIGHT * strandedPax,
  };
}

/** Walk the domino chain from a flight back to its root cause. */
export function dominoChain(sim: SimResult, flightId: string): FlightResult[] {
  const chain: FlightResult[] = [];
  let cur: FlightResult | undefined = sim.flights[flightId];
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? sim.flights[cur.parentId] : undefined;
  }
  return chain;
}

export const cancelReasonText: Record<CancelReason, string> = {
  user: 'Cancelled by dispatcher',
  aircraft_out_of_position: 'Aircraft not at origin (earlier leg cancelled)',
  crew_timeout: 'Crew would exceed legal duty limit',
};
