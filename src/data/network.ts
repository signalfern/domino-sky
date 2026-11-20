import raw from './flight_network.json';
import type { Network } from '../engine/types';

export const network = raw as unknown as Network;
